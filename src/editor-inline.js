import { Editor, Extension, Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  inlineHtmlTags,
  shouldWarnForExtraContent,
  countNonEmptyBlocks,
  renderMarkdownToHtml,
  markdownSerializer,
  decodeMarkdownBase64,
  decodeHtmlEntitiesInFences,
  getLanguagesConfig,
  getSaveUrl,
  fetchCsrfToken,
  syncComments,
} from "./editor-core.js";
import { Marker } from "./marker-extension.js";
import { createToolbarButtons } from "./editor-toolbar.js";
import { renderToolbarButtons } from "./editor-toolbar-renderer.js";
import { openFullscreenEditorForElement } from "./editor-fullscreen.js";
import { createOverlayEngine } from "./overlay-engine.js";
import { resolveDblclickAction } from "./scope-resolver.js";
import { getSectionEntry, getSubsectionEntry } from "./content-index.js";
import { createImagePicker } from "./image-picker.js";
import {
  registerStatusEl,
  markDirty,
  clearDirty,
  setSaved,
  setNoChanges,
  setError,
} from "./editor-status.js";

let activeEditor = null;
let activeTarget = null;
let activeFieldName = null;
let activeFieldType = null;
let activeFieldScope = "field";
let activeFieldSection = "";
let toolbarEl = null;
let toolbarStatusEl = null;
let toolbarCloseBtn = null;
let keydownHandler = null;
let pointerHandler = null;
let dblclickHandler = null;
let hoverHandler = null;
let clickBlockHandler = null;
let hoverRaf = null;
let lastHoverKey = "";
let lastHoverRect = null;
let pendingLinkNavigation = null;
let debugLabels =
  window.MarkdownFrontEditorConfig?.debugLabels ||
  window.localStorage?.getItem("mfeDebugLabels") === "1";
const debugClicks = window.localStorage?.getItem("mfeDebugClicks") === "1";
const overlayEngine = createOverlayEngine({ debugLabels });

let dirty = false;
const originalBlockCounts = new WeakMap();
const originalHtml = new WeakMap();
let activeFieldId = null;
const draftByField = new Map();
const draftMarkdownByField = new Map();
let suppressUpdates = false;
const fieldElements = new Map();

function parseDataMfe(value) {
  const raw = (value || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const splitPath = (path) =>
    (path || "")
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);

  if (lower.startsWith("field:")) {
    const parts = splitPath(raw.slice(6));
    if (parts.length === 1) {
      return { scope: "field", name: parts[0], section: "", subsection: "" };
    }
    if (parts.length === 2) {
      return {
        scope: "field",
        section: parts[0],
        name: parts[1],
        subsection: "",
      };
    }
    if (parts.length >= 3) {
      return {
        scope: "field",
        section: parts[0],
        subsection: parts[1],
        name: parts[2],
      };
    }
    return null;
  }

  if (lower.startsWith("section:")) {
    const parts = splitPath(raw.slice(8));
    if (!parts.length) return null;
    return { scope: "section", name: parts[0], section: "" };
  }

  if (lower.startsWith("sub:") || lower.startsWith("subsection:")) {
    const path = lower.startsWith("sub:") ? raw.slice(4) : raw.slice(11);
    const parts = splitPath(path.replace(/:/g, "/"));
    if (parts.length < 2) return null;
    return { scope: "subsection", section: parts[0], name: parts[1] };
  }

  // New shorthand for field-within-section
  // "topics" => auto resolve (field first, then section)
  // "foo/topics" => auto resolve (field in section first, then subsection)
  const pathParts = splitPath(raw);
  if (pathParts.length === 2) {
    return {
      scope: "auto",
      section: pathParts[0],
      name: pathParts[1],
      subsection: "",
    };
  }
  if (pathParts.length >= 3) {
    return {
      scope: "field",
      section: pathParts[0],
      subsection: pathParts[1],
      name: pathParts[2],
    };
  }

  // Backward compatibility with previous syntax:
  // "hero" => section, "hero:chirology" => subsection
  const legacy = raw.split(":").map((p) => p.trim()).filter(Boolean);
  if (legacy.length === 1) {
    return { scope: "auto", name: legacy[0], section: "", subsection: "" };
  }
  if (legacy.length >= 2) {
    return { scope: "subsection", section: legacy[0], name: legacy[1] };
  }
  return null;
}

function getSectionEntryByName(name) {
  const cfg = window.MarkdownFrontEditorConfig || {};
  const sections = Array.isArray(cfg.sectionsIndex) ? cfg.sectionsIndex : [];
  return sections.find((s) => s?.name === name) || null;
}

function getSubsectionEntryByName(sectionName, subName) {
  const section = getSectionEntryByName(sectionName);
  const subs = Array.isArray(section?.subsections) ? section.subsections : [];
  return subs.find((s) => s?.name === subName) || null;
}

function getFieldsIndex() {
  const cfg = window.MarkdownFrontEditorConfig || {};
  return Array.isArray(cfg.fieldsIndex) ? cfg.fieldsIndex : [];
}

function findFieldEntry({ name, section = "", subsection = "" }) {
  const fields = getFieldsIndex().filter((f) => (f?.name || "") === (name || ""));
  if (!fields.length) return null;

  let matches = fields;
  if (section) {
    matches = matches.filter((f) => (f?.section || "") === section);
  }
  if (subsection) {
    matches = matches.filter((f) => (f?.subsection || "") === subsection);
  }
  if (matches.length) return matches[0];

  if (!section && !subsection) {
    const topLevel = fields.find((f) => !(f?.section || ""));
    if (topLevel) return topLevel;
  }
  return fields[0];
}

function resolveDataMfe(parsed) {
  if (!parsed) return null;

  if (parsed.scope === "section") {
    const entry = getSectionEntryByName(parsed.name);
    return {
      scope: "section",
      name: parsed.name,
      section: "",
      subsection: "",
      b64: entry?.markdownB64 || "",
    };
  }

  if (parsed.scope === "subsection") {
    const subEntry = getSubsectionEntryByName(parsed.section, parsed.name);
    return {
      scope: "subsection",
      name: parsed.name,
      section: parsed.section || "",
      subsection: "",
      b64: subEntry?.markdownB64 || "",
    };
  }

  if (parsed.scope === "field") {
    const fieldEntry = findFieldEntry({
      name: parsed.name,
      section: parsed.section || "",
      subsection: parsed.subsection || "",
    });
    if (!fieldEntry) return null;
    return {
      scope: "field",
      name: fieldEntry.name || "",
      section: fieldEntry.section || "",
      subsection: fieldEntry.subsection || "",
      b64: fieldEntry.markdownB64 || "",
      fieldType:
        fieldEntry.kind === "container" || fieldEntry.type === "container"
          ? "container"
          : "tag",
    };
  }

  if (parsed.scope === "auto") {
    const fieldEntry = findFieldEntry({
      name: parsed.name,
      section: parsed.section || "",
      subsection: parsed.subsection || "",
    });
    if (fieldEntry) {
      return {
        scope: "field",
        name: fieldEntry.name || "",
        section: fieldEntry.section || "",
        subsection: fieldEntry.subsection || "",
        b64: fieldEntry.markdownB64 || "",
        fieldType:
          fieldEntry.kind === "container" || fieldEntry.type === "container"
            ? "container"
            : "tag",
      };
    }

    if (parsed.section) {
      const subEntry = getSubsectionEntryByName(parsed.section, parsed.name);
      if (subEntry) {
        return {
          scope: "subsection",
          name: parsed.name,
          section: parsed.section || "",
          subsection: "",
          b64: subEntry.markdownB64 || "",
        };
      }
    }

    const secEntry = getSectionEntryByName(parsed.name);
    if (secEntry) {
      return {
        scope: "section",
        name: parsed.name,
        section: "",
        subsection: "",
        b64: secEntry.markdownB64 || "",
      };
    }
  }

  return null;
}

function findDataMfeTargetFromPoint(x, y) {
  const stack =
    typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(x, y)
      : [];
  const hit = stack.find((el) => el?.closest?.("[data-mfe]"));
  const host = hit?.closest ? hit.closest("[data-mfe]") : null;
  if (!host) return null;
  const parsed = parseDataMfe(host.getAttribute("data-mfe"));
  const resolved = resolveDataMfe(parsed);
  if (!resolved) return null;
  const rect = host.getBoundingClientRect();
  return {
    scope: resolved.scope,
    name: resolved.name,
    section: resolved.section || "",
    subsection: resolved.subsection || "",
    b64: resolved.b64 || "",
    fieldType: resolved.fieldType || "",
    rect,
  };
}

function findTargetFromPoint(x, y) {
  const dataMfeTarget = findDataMfeTargetFromPoint(x, y);
  if (dataMfeTarget) return dataMfeTarget;
  return null;
}


function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function createVirtualTarget({
  pageId,
  scope,
  name,
  section = "",
  subsection = "",
  fieldType = "",
  markdown,
}) {
  const el = document.createElement("div");
  el.className = "fe-editable md-edit mfe-virtual";
  el.setAttribute("data-page", pageId);
  el.setAttribute("data-md-scope", scope);
  el.setAttribute("data-mfe-scope", scope);
  el.setAttribute("data-md-name", name);
  el.setAttribute("data-mfe-name", name);
  if (fieldType) {
    el.setAttribute("data-field-type", fieldType);
  }
  if (section) {
    el.setAttribute("data-md-section", section);
    el.setAttribute("data-mfe-section", section);
  }
  if (subsection) {
    el.setAttribute("data-md-subsection", subsection);
    el.setAttribute("data-mfe-subsection", subsection);
  }
  if (markdown !== undefined) {
    el.setAttribute(
      "data-markdown-b64",
      btoa(unescape(encodeURIComponent(markdown))),
    );
  }
  return el;
}

function getEditLabel(scope, name, section, subsection = "") {
  if (!debugLabels) return "Double click to edit";
  if (scope === "subsection") {
    return `subsection:${section}:${name}`;
  }
  if (scope === "section") {
    return `section:${name}`;
  }
  if (scope === "field" && section && subsection) {
    return `field:${section}:${subsection}:${name}`;
  }
  if (section) {
    return `${scope}:${section}:${name}`;
  }
  if (name) {
    return `${scope}:${name}`;
  }
  return `${scope}`;
}

function applyEditLabelAttributes(el) {
  if (!el) return;
  const scope = getMetaAttr(el, "scope") || "field";
  const name = getMetaAttr(el, "name") || "";
  const section = getMetaAttr(el, "section") || "";
  const subsection = getMetaAttr(el, "subsection") || "";
  const label = getEditLabel(scope, name, section, subsection);
  el.setAttribute("data-mfe-label", label);
  el.setAttribute("data-mfe-label-debug", debugLabels ? "1" : "0");

  const fieldType = el.getAttribute("data-field-type") || "";
  const isSectionLike = scope === "section" || scope === "subsection";
  const host = el.firstElementChild;
  if (isSectionLike || fieldType === "container") {
    if (host) {
      host.classList.add("mfe-label-host");
      host.setAttribute("data-mfe-label", label);
    }
  }
}

function getMetaAttr(el, name) {
  if (!el) return "";
  return (
    el.getAttribute(`data-mfe-${name}`) ||
    el.getAttribute(`data-md-${name}`) ||
    ""
  );
}

function applyDataMfeLabelAttributes(el) {
  if (!el) return;
  const parsed = parseDataMfe(el.getAttribute("data-mfe"));
  const resolved = resolveDataMfe(parsed);
  if (!resolved) return;
  const label = getEditLabel(
    resolved.scope,
    resolved.name,
    resolved.section || "",
    resolved.subsection || "",
  );
  el.setAttribute("data-mfe-label", label);
  el.setAttribute("data-mfe-label-debug", debugLabels ? "1" : "0");
}

function getRectFromChildren(el) {
  const children = Array.from(el.children);
  if (!children.length) return null;
  const rects = children.map((c) => c.getBoundingClientRect());
  return rects.reduce(
    (acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

function inflateRect(rect, padding = 48) {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding,
  };
}

function isPointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isInEditableZone(node) {
  if (!node?.closest) return false;
  return Boolean(node.closest(".fe-editable") || node.closest("[data-mfe]"));
}

function clearPendingLinkNavigation() {
  if (!pendingLinkNavigation) return;
  window.clearTimeout(pendingLinkNavigation.timer);
  pendingLinkNavigation = null;
}

function navigateFromLink(link, clickEvent) {
  const href = link.getAttribute("href");
  if (!href || href === "#") return;
  const target = (link.getAttribute("target") || "").toLowerCase();
  if (target === "_blank") {
    window.open(href, "_blank", "noopener");
    return;
  }
  if (clickEvent?.metaKey || clickEvent?.ctrlKey) {
    window.open(href, "_blank");
    return;
  }
  window.location.assign(href);
}

function buildFieldId({ pageId, scope, section, name }) {
  const parts = [
    String(pageId || ""),
    scope || "field",
    section || "",
    name || "",
  ];
  return parts.map((part) => encodeURIComponent(part)).join("|");
}

function parseFieldId(fieldId) {
  const [pageId, scope, section, name] = fieldId
    .split("|")
    .map((part) => decodeURIComponent(part || ""));
  return {
    pageId,
    scope: scope || "field",
    section: section || "",
    name: name || "",
  };
}

function renderDraftHtml(editor) {
  if (!editor) return "";
  const html = editor.getHTML();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const replacements = [
    { re: /<br\s*\/?>/gi, tag: "br" },
    { re: /<\/br>/gi, tag: "br" },
  ];

  const shouldSkip = (node) => {
    const parent = node.parentElement;
    if (!parent) return false;
    return parent.closest("code, pre");
  };

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  nodes.forEach((textNode) => {
    if (shouldSkip(textNode)) return;
    const text = textNode.nodeValue || "";
    let parts = [{ text }];

    replacements.forEach(({ re, tag }) => {
      const nextParts = [];
      parts.forEach((part) => {
        if (!part.text) {
          nextParts.push(part);
          return;
        }
        const segments = part.text.split(re);
        segments.forEach((seg, idx) => {
          if (seg) nextParts.push({ text: seg });
          if (idx < segments.length - 1) nextParts.push({ tag });
        });
      });
      parts = nextParts;
    });

    if (parts.length === 1 && parts[0].text === text) return;

    const frag = doc.createDocumentFragment();
    parts.forEach((part) => {
      if (part.tag) {
        frag.appendChild(doc.createElement(part.tag));
      } else if (part.text) {
        frag.appendChild(doc.createTextNode(part.text));
      }
    });
    textNode.parentNode.replaceChild(frag, textNode);
  });

  return doc.body.innerHTML;
}
let beforeUnloadHandler = null;

function confirmDiscardChanges() {
  if (!dirty) return true;
  return window.confirm("You have unsaved changes. Discard them and close?");
}

const EscapeKeyExtension = Extension.create({
  name: "escapeKeyExtension",
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        closeInlineEditor({ saveOnClose: false, promptOnClose: true });
        return true;
      },
    };
  },
});

function setOriginalBlockCount(editor, fieldType, fieldName) {
  const count = shouldWarnForExtraContent(fieldType, fieldName)
    ? 1
    : countNonEmptyBlocks(editor.state.doc);
  originalBlockCounts.set(editor, count);
}

function getOriginalBlockCount(editor) {
  return originalBlockCounts.get(editor) || 0;
}

function applyFieldAttributes(editor, fieldType, fieldName) {
  const dom = editor.view.dom;
  dom.setAttribute("data-field-type", fieldType);
  dom.setAttribute("data-field-name", fieldName || "");
  if (shouldWarnForExtraContent(fieldType, fieldName)) {
    dom.setAttribute("data-extra-warning", "true");
    dom.setAttribute("data-extra-warning-active", "false");
  } else {
    dom.removeAttribute("data-extra-warning");
    dom.removeAttribute("data-extra-warning-active");
  }
}

function stripTrailingEmptyParagraph(editor) {
  if (!editor) return;
  const { state, view } = editor;
  const { doc } = state;
  if (doc.childCount <= 1) return;

  const last = doc.child(doc.childCount - 1);
  if (last.type.name !== "paragraph") return;
  if (last.textContent.trim() !== "") return;

  const from = doc.content.size - last.nodeSize;
  const to = doc.content.size;
  const tr = state.tr.delete(from, to);
  view.dispatch(tr);
}

function highlightExtraContent(editor = activeEditor) {
  if (!editor) return;

  if (!shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    if (editor?.view?.dom) {
      editor.view.dom.removeAttribute("data-extra-warning-active");
    }
    return;
  }

  const currentBlockCount = countNonEmptyBlocks(editor.state.doc);
  const originalCount = getOriginalBlockCount(editor);

  if (currentBlockCount <= originalCount) {
    editor.view.dom.setAttribute("data-extra-warning-active", "false");
    return;
  }

  editor.view.dom.setAttribute("data-extra-warning-active", "true");
}

function createEditorInstance(host, fieldType, fieldName) {
  const lowlight = createLowlight(common);
  const InlineHtmlLabel = Extension.create({
    name: "inlineHtmlLabel",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              const decorations = [];
              state.doc.descendants((node, pos, parent) => {
                if (!node.isText) return;
                if (parent?.type?.name === "codeBlock") return;
                if (node.marks?.some((mark) => mark.type.name === "code"))
                  return;

                inlineHtmlTags.forEach((tag) => {
                  const re = new RegExp(`<\\s*\\/?\\s*${tag}\\b[^>]*>`, "gi");
                  let match;
                  while ((match = re.exec(node.text)) !== null) {
                    const from = pos + match.index;
                    const to = from + match[0].length;
                    decorations.push(
                      Decoration.inline(from, to, {
                        class: "mfe-inline-html",
                        "data-inline-html": match[0],
                      }),
                    );
                  }
                });
              });
              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
  const Underline = Mark.create({
    name: "underline",
    parseHTML() {
      return [{ tag: "u" }];
    },
    renderHTML() {
      return ["u", 0];
    },
  });
  const Superscript = Mark.create({
    name: "superscript",
    parseHTML() {
      return [{ tag: "sup" }];
    },
    renderHTML() {
      return ["sup", 0];
    },
  });
  const Subscript = Mark.create({
    name: "subscript",
    parseHTML() {
      return [{ tag: "sub" }];
    },
    renderHTML() {
      return ["sub", 0];
    },
  });

  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: false,
        underline: false,
      }),
      Underline,
      Superscript,
      Subscript,
      Marker,
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
      }),
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            src: {
              default: null,
              parseHTML: (element) => element.getAttribute("src"),
              renderHTML: (attributes) => {
                if (!attributes.src) return {};

                // If it's already an absolute URL or starts with /, use as-is
                // Supports picker URLs starting with ? or protocol-relative //
                if (attributes.src.match(/^(https?:|\/|\?|\/\/)/)) {
                  return { src: attributes.src };
                }

                // For relative URLs, try to resolve to page assets
                const pageId = document
                  .querySelector(".fe-editable")
                  ?.getAttribute("data-page");
                if (pageId) {
                  // Use ProcessWire's page assets URL pattern
                  const assetUrl = `/site/assets/files/${pageId}/${attributes.src}`;
                  return { src: assetUrl };
                }

                // Fallback to original src
                return { src: attributes.src };
              },
            },
            originalFilename: {
              default: null,
            },
          };
        },
        addNodeView() {
          return ({ node, HTMLAttributes, getPos, editor }) => {
            const container = document.createElement("span");
            container.classList.add("mfe-tiptap-image-container");

            const img = document.createElement("img");

            // Set attributes. TipTap's HTMLAttributes already contains the resolved src from renderHTML.
            Object.entries(HTMLAttributes).forEach(([key, value]) => {
              if (value !== null && value !== undefined) {
                img.setAttribute(key, value);
              }
            });

            const label = document.createElement("span");
            label.classList.add("mfe-tiptap-image-label");
            label.innerText = "edit";

            container.append(img, label);

            // Handle double click for image picker
            container.ondblclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (window.mfeOpenImagePicker) {
                window.mfeOpenImagePicker(node.attrs);
              }
            };

            return {
              dom: container,
            };
          };
        },
        addProseMirrorPlugins() {
          return [
            new Plugin({
              props: {
                handleDoubleClickOn: (
                  view,
                  pos,
                  node,
                  nodePos,
                  event,
                  direct,
                ) => {
                  if (node.type.name === "image") {
                    if (window.mfeOpenImagePicker) {
                      window.mfeOpenImagePicker(node.attrs);
                    }
                    return true;
                  }
                  return false;
                },
              },
            }),
          ];
        },
      }).configure({
        inline: true,
        allowBase64: false,
      }),
      InlineHtmlLabel,
      EscapeKeyExtension,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "mfe-inline-editor",
        spellcheck: "false",
      },
    },
  });

  applyFieldAttributes(editor, fieldType, fieldName);

  editor.on("focus", () => {
    activeEditor = editor;
  });

  editor.on("update", () => {
    if (suppressUpdates) return;
    highlightExtraContent(editor);
    if (shouldWarnForExtraContent(fieldType, fieldName)) {
      stripTrailingEmptyParagraph(editor);
    }
    dirty = true;
    if (activeFieldId) {
      markDirty(activeFieldId);
      draftByField.set(activeFieldId, editor.getJSON());
      const markdown = decodeHtmlEntitiesInFences(
        getMarkdownFromEditor(editor),
      );
      draftMarkdownByField.set(activeFieldId, markdown);
    }
  });

  return editor;
}

function getMarkdownFromEditor(editor = activeEditor) {
  if (!editor) return "";
  return markdownSerializer.serialize(editor.state.doc);
}

function saveField(fieldId, markdown) {
  const { pageId, name: fieldName, scope, section } = parseFieldId(fieldId);
  const target = fieldElements.get(fieldId);
  if (!pageId || !fieldName || !target) {
    return Promise.resolve();
  }
  const fieldType = target.getAttribute("data-field-type") || "tag";
  let finalMarkdown = markdown;
  if (shouldWarnForExtraContent(fieldType, fieldName)) {
    const blocks = finalMarkdown
      .split(/\n\s*\n/)
      .filter((p) => p.trim().length > 0);
    finalMarkdown = blocks.length > 0 ? blocks[0] : finalMarkdown;
  }

  return fetchCsrfToken()
    .then((csrf) => {
      const { current } = getLanguagesConfig();
      const formData = new FormData();
      formData.append("markdown", finalMarkdown);
      formData.append("mdName", fieldName);
      formData.append("mdScope", scope || "field");
      if (section) {
        formData.append("mdSection", section);
      }
      formData.append("pageId", pageId);
      formData.append("fieldId", fieldId);
      if (current) {
        formData.append("lang", current);
      }

      if (csrf) {
        formData.append(csrf.name, csrf.value);
      }

      return fetch(getSaveUrl(), {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });
    })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!data.status) throw new Error(data.message || "Save failed");

      if (data.sectionsIndex) {
        window.MarkdownFrontEditorConfig =
          window.MarkdownFrontEditorConfig || {};
        window.MarkdownFrontEditorConfig.sectionsIndex = data.sectionsIndex;
      }
      if (data.fieldsIndex) {
        window.MarkdownFrontEditorConfig =
          window.MarkdownFrontEditorConfig || {};
        window.MarkdownFrontEditorConfig.fieldsIndex = data.fieldsIndex;
      }

      if (data.html || data.htmlMap) {
        const htmlMap =
          data.htmlMap || (typeof data.html === "object" ? data.html : {});
        const primaryHtml =
          typeof data.html === "string"
            ? data.html
            : htmlMap[fieldId] || htmlMap[mdName];

        // 1. Update ALL .fe-editable elements on the page that match something in the map
        document.querySelectorAll(".fe-editable").forEach((el) => {
          const elName = getMetaAttr(el, "name");
          const elScope = getMetaAttr(el, "scope") || "field";
          const elSection = getMetaAttr(el, "section") || "";
          const elPageId = el.getAttribute("data-page");
          const elId = `${elPageId}:${elScope}:${elSection}:${elName}`;

          let html =
            htmlMap[elId] ||
            htmlMap[elName] ||
            htmlMap[`${elScope}:${elName}`] ||
            htmlMap[`${elScope}:${elSection}:${elName}`];

          // Fuzzy match for scoped keys
          if (!html) {
            for (const [key, value] of Object.entries(htmlMap)) {
              if (elId.endsWith(":" + key)) {
                html = value;
                break;
              }
            }
          }

          if (html) {
            originalHtml.set(el, html);

            // If this is the active editor, update TipTap state
            if (el === activeTarget && activeEditor) {
              const selection = activeEditor.state.selection;
              activeEditor.commands.setContent(html, false);
              try {
                activeEditor.commands.setTextSelection(selection);
              } catch (e) {}
            } else {
              el.innerHTML = html;
            }
          }
        });

        // 2. Sync fragments delimited by comment markers (e.g. Subsections)
        syncComments(htmlMap);
      }
      target.dataset.markdown = finalMarkdown;
      target.dataset.markdownB64 = btoa(
        unescape(encodeURIComponent(finalMarkdown)),
      );
      clearDirty(fieldId);
      draftByField.delete(fieldId);
      draftMarkdownByField.delete(fieldId);
    });
}

function saveAllDrafts({ showStatus = true } = {}) {
  if (draftMarkdownByField.size === 0 && activeEditor && activeFieldId) {
    const markdown = decodeHtmlEntitiesInFences(
      getMarkdownFromEditor(activeEditor),
    );
    draftMarkdownByField.set(activeFieldId, markdown);
  }
  if (draftMarkdownByField.size === 0) {
    if (showStatus) setNoChanges();
    return Promise.resolve();
  }

  const entries = Array.from(draftMarkdownByField.entries());
  const grouped = new Map();
  entries.forEach(([fieldId, markdown]) => {
    const { pageId, name, scope, section } = parseFieldId(fieldId);
    if (!pageId || !name) return;
    if (!grouped.has(pageId)) grouped.set(pageId, []);
    grouped.get(pageId).push({
      key: fieldId,
      name,
      scope: scope || "field",
      section: section || "",
      markdown,
    });
  });

  const batchSaves = Array.from(grouped.entries()).map(([pageId, fields]) =>
    saveBatch(pageId, fields),
  );

  return batchSaves
    .reduce((chain, task) => chain.then(() => task), Promise.resolve())
    .then(() => {
      dirty = false;
      if (showStatus) setSaved();
    })
    .catch((err) => {
      // save errors are handled by caller
      if (showStatus) setError();
    });
}

function saveBatch(pageId, fields) {
  const fieldsByKey = new Map();
  fields.forEach((field) => {
    if (!field?.key) return;
    fieldsByKey.set(field.key, field);
  });
  return fetchCsrfToken()
    .then((csrf) => {
      const { current } = getLanguagesConfig();
      const formData = new FormData();
      formData.append("batch", "1");
      formData.append("pageId", pageId);
      formData.append("fields", JSON.stringify(fields));
      if (current) {
        formData.append("lang", current);
      }

      if (csrf) {
        formData.append(csrf.name, csrf.value);
      }

      return fetch(getSaveUrl(), {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });
    })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!data.status) throw new Error(data.message || "Save failed");

      if (data.sectionsIndex) {
        window.MarkdownFrontEditorConfig =
          window.MarkdownFrontEditorConfig || {};
        window.MarkdownFrontEditorConfig.sectionsIndex = data.sectionsIndex;
      }
      if (data.fieldsIndex) {
        window.MarkdownFrontEditorConfig =
          window.MarkdownFrontEditorConfig || {};
        window.MarkdownFrontEditorConfig.fieldsIndex = data.fieldsIndex;
      }

      const htmlMap =
        data.htmlMap || (typeof data.html === "object" ? data.html : {});
      Object.entries(htmlMap).forEach(([fieldKey, html]) => {
        // Try to match by fieldId (full) or fieldKey (name)
        let fieldId = fieldKey;
        if (!fieldElements.has(fieldId)) {
          // Fuzzy match: check if any fieldId ends with :fieldKey
          for (const [id, _] of fieldElements) {
            if (
              id === fieldKey ||
              id.endsWith(":" + fieldKey) ||
              id.startsWith(fieldKey + ":")
            ) {
              fieldId = id;
              break;
            }
          }
        }

        const target = fieldElements.get(fieldId);
        if (!target) return;

        // Always update the stored original HTML and dataset
        if (html && typeof html === "string") {
          originalHtml.set(target, html);

          // Update TipTap or DOM
          if (target === activeTarget && activeEditor) {
            const selection = activeEditor.state.selection;
            activeEditor.commands.setContent(html, false);
            try {
              activeEditor.commands.setTextSelection(selection);
            } catch (e) {}
          } else {
            target.innerHTML = html;
          }
        }

        const fieldData = fieldsByKey.get(fieldId);
        if (fieldData?.markdown) {
          const markdown = fieldData.markdown;
          target.dataset.markdown = markdown;
          target.dataset.markdownB64 = btoa(
            unescape(encodeURIComponent(markdown)),
          );
        }
        clearDirty(fieldId);
        draftByField.delete(fieldId);
        draftMarkdownByField.delete(fieldId);
      });

      // Sync fragments delimited by comment markers (e.g. Subsections)
      syncComments(htmlMap);
    });
}

/**
 * Open image picker and insert selected image
 */
function openImagePickerInline(initialData = null) {
  if (!activeEditor) return;

  createImagePicker({
    initialData,
    onSelect: (imageData) => {
      // imageData is { filename, url, alt }
      if (!activeEditor) return;

      const { selection } = activeEditor.state;
      const isImageSelected =
        selection.node && selection.node.type.name === "image";

      if (isImageSelected) {
        activeEditor
          .chain()
          .focus()
          .updateAttributes("image", {
            src: imageData.url,
            alt: imageData.alt || "",
            originalFilename: imageData.filename,
          })
          .run();
      } else {
        activeEditor
          .chain()
          .focus()
          .setImage({
            src: imageData.url,
            alt: imageData.alt || "",
            originalFilename: imageData.filename,
          })
          .run();
      }

      // Mark as dirty
      dirty = true;
      if (activeFieldId) {
        markDirty(activeFieldId);
        const markdown = decodeHtmlEntitiesInFences(
          getMarkdownFromEditor(activeEditor),
        );
        draftMarkdownByField.set(activeFieldId, markdown);
      }
    },
    onClose: () => {
      // Refocus editor after picker closes
      setTimeout(() => activeEditor?.view?.focus(), 0);
    },
  });
}

// Override global check to ensure picker uses our inline context when active
if (window.mfeOpenImagePicker) {
  const originalOpen = window.mfeOpenImagePicker;
  window.mfeOpenImagePicker = (data) => {
    if (activeEditor) return openImagePickerInline(data);
    return originalOpen(data);
  };
} else {
  window.mfeOpenImagePicker = openImagePickerInline;
}

function createInlineToolbar() {
  if (toolbarEl) {
    return;
  }
  const toolbar = document.createElement("div");
  toolbar.className = "mfe-inline-toolbar";

  const buttons = createToolbarButtons({
    getEditor: () => activeEditor,
    onSave: () => saveAllDrafts({ showStatus: true }),
    onToggleSplit: null,
    onToggleMarkers: null,
  });

  const configButtons =
    window.MarkdownFrontEditorConfig?.toolbarButtons ||
    "bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,|,code,codeblock,clear,|,split";

  const { statusEl } = renderToolbarButtons({
    toolbar,
    buttons,
    configButtons,
    getEditor: () => activeEditor,
  });

  toolbarStatusEl = statusEl;
  registerStatusEl(statusEl);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "editor-toolbar-btn mfe-inline-close";
  closeBtn.title = "Close (Esc)";
  closeBtn.innerHTML = "×";
  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    closeInlineEditor({ saveOnClose: false, promptOnClose: true });
  });

  toolbar.appendChild(closeBtn);

  document.body.appendChild(toolbar);
  toolbarEl = toolbar;
  toolbarCloseBtn = closeBtn;
}

async function openInlineEditorFromPayload(payload) {
  if (!payload || !payload.element) return;
  const el = payload.element;
  if (activeTarget === el && activeEditor) return;

  if (activeEditor) {
    const closed = await closeInlineEditor({
      saveOnClose: false,
      promptOnClose: false,
      keepToolbar: true,
      persistDraft: true,
    });
    if (!closed) return;
  }

  const {
    markdownContent,
    fieldName,
    fieldType,
    fieldScope,
    fieldSection,
    pageId,
  } = payload;

  activeTarget = el;
  activeFieldName = fieldName;
  activeFieldType = fieldType;
  activeFieldScope = fieldScope;
  activeFieldSection = fieldSection;
  activeFieldId = buildFieldId({
    pageId,
    scope: fieldScope,
    section: fieldSection,
    name: fieldName,
  });
  fieldElements.set(activeFieldId, el);

  if (!originalHtml.has(el)) {
    originalHtml.set(el, el.innerHTML);
  }

  el.classList.add("mfe-inline-active");
  el.innerHTML = "";

  const host = document.createElement("div");
  host.className = "mfe-inline-host";
  el.appendChild(host);

  activeEditor = createEditorInstance(host, fieldType, fieldName);

  suppressUpdates = true;
  const draftJson = draftByField.get(activeFieldId);
  if (draftJson) {
    activeEditor.commands.setContent(draftJson, false);
    dirty = true;
    markDirty(activeFieldId);
  } else {
    const html = renderMarkdownToHtml(markdownContent || "");
    activeEditor.commands.setContent(html, false);
    dirty = false;
    clearDirty(activeFieldId);
    draftMarkdownByField.delete(activeFieldId);
  }
  suppressUpdates = false;
  if (shouldWarnForExtraContent(fieldType, fieldName)) {
    stripTrailingEmptyParagraph(activeEditor);
  }
  setOriginalBlockCount(activeEditor, fieldType, fieldName);
  highlightExtraContent(activeEditor);

  createInlineToolbar();

  const editor = activeEditor;
  setTimeout(() => editor?.view?.focus(), 0);
}

async function openInlineEditor(el) {
  if (!el) return;
  const markdownB64 = el.getAttribute("data-markdown-b64");
  const markdownContent = markdownB64 ? decodeMarkdownBase64(markdownB64) : "";
  const payload = {
    element: el,
    markdownContent,
    fieldName: getMetaAttr(el, "name") || "unknown",
    fieldType: el.getAttribute("data-field-type") || "tag",
    fieldScope: getMetaAttr(el, "scope") || "field",
    fieldSection: getMetaAttr(el, "section") || "",
    pageId: el.getAttribute("data-page") || "0",
  };
  return openInlineEditorFromPayload(payload);
}

function closeInlineEditor({
  saveOnClose = false,
  promptOnClose = false,
  keepToolbar = false,
  persistDraft = false,
} = {}) {
  if (!activeEditor || !activeTarget) return Promise.resolve(true);

  const target = activeTarget;
  const fieldId = activeFieldId;
  const editorForDraft = activeEditor;
  const hasDraft = fieldId ? draftByField.has(fieldId) : false;

  const cleanup = () => {
    if (activeEditor) {
      activeEditor.destroy();
    }
    activeEditor = null;
    activeTarget = null;
    activeFieldName = null;
    activeFieldType = null;
    activeFieldScope = "field";
    activeFieldSection = "";
    activeFieldId = null;
    dirty = false;

    if (!keepToolbar) {
      if (toolbarEl) {
        toolbarEl.remove();
      }
      toolbarEl = null;
      toolbarStatusEl = null;
      toolbarCloseBtn = null;
    }

    target.classList.remove("mfe-inline-active");
    if (persistDraft && hasDraft && editorForDraft) {
      const rendered = renderDraftHtml(editorForDraft);
      target.innerHTML = rendered;
    } else {
      const finalHtml = originalHtml.get(target) || "";
      target.innerHTML = finalHtml;
    }
  };

  if (promptOnClose && !confirmDiscardChanges()) {
    return Promise.resolve(false);
  }

  if (persistDraft && fieldId && editorForDraft) {
    const markdown = decodeHtmlEntitiesInFences(
      getMarkdownFromEditor(editorForDraft),
    );
    draftMarkdownByField.set(fieldId, markdown);
  }

  if (!saveOnClose && promptOnClose) {
    draftByField.forEach((_, key) => {
      clearDirty(key);
      const el = fieldElements.get(key);
      if (el) {
        const finalHtml = originalHtml.get(el) || "";
        el.innerHTML = finalHtml;
        el.classList.remove("mfe-inline-active");
      }
    });
    draftByField.clear();
    draftMarkdownByField.clear();
    dirty = false;
  }

  const savePromise = saveOnClose
    ? saveAllDrafts({ showStatus: false })
    : Promise.resolve();
  return Promise.resolve(savePromise).then(
    () => {
      cleanup();
      return true;
    },
    (err) => {
      cleanup();
      return Promise.reject(err);
    },
  );
}

function initInlineEditor() {
  document.body.classList.add("mfe-view-inline");
  const cfg = window.MarkdownFrontEditorConfig || {};
  if (cfg.debugShowSections) {
    document.body.classList.add("mfe-debug-sections");
    debugLabels = true;
    document.body.classList.add("mfe-debug-labels");
  }
  if (cfg.debugShowLabels) {
    document.body.classList.add("mfe-debug-labels");
    debugLabels = true;
  }
  const labelStyle = cfg.labelStyle || "outside";
  document.body.setAttribute("data-mfe-label-style", labelStyle);

  const editables = Array.from(document.querySelectorAll(".fe-editable"));
  editables.forEach((el) => {
    applyEditLabelAttributes(el);
  });
  const mfeHosts = Array.from(document.querySelectorAll("[data-mfe]"));
  mfeHosts.forEach((el) => {
    applyDataMfeLabelAttributes(el);
  });

  overlayEngine.init();

  if (!dblclickHandler) {
    dblclickHandler = (e) => {
      if (document.body.classList.contains("mfe-view-fullscreen")) {
        return;
      }
      clearPendingLinkNavigation();
      const hit = e.target?.closest?.(".fe-editable");
      if (!hit) {
        // no hit
      }

      e.preventDefault();
      e.stopPropagation();
      const action = resolveDblclickAction({
        event: e,
        hit,
        overlayEngine,
        findTargetFromPoint,
        findSectionFromText: () => null,
        decodeMarkdownBase64,
        createVirtualTarget,
        pageId:
          document.querySelector(".fe-editable")?.getAttribute("data-page") ||
          "0",
      });

      if (!action || action.action === "none") {
        return;
      }

      if (action.action === "fullscreen") {
        openFullscreenEditorForElement(action.target);
        return;
      }

      if (action.action === "inline") {
        openInlineEditor(action.target);
      }
    };

    document.addEventListener("dblclick", dblclickHandler, true);
  }

  if (!clickBlockHandler) {
    clickBlockHandler = (e) => {
      const linkHit = e.target?.closest?.("a");
      if (!linkHit) return;
      if (!isInEditableZone(e.target)) return;
      if (e.button !== 0) return;
      if (e.altKey || e.shiftKey) return;
      if (linkHit.hasAttribute("download")) return;

      // First click: delay navigation briefly so a second click can become dblclick edit.
      if (e.detail === 1) {
        clearPendingLinkNavigation();
        e.preventDefault();
        pendingLinkNavigation = {
          link: linkHit,
          timer: window.setTimeout(() => {
            const nav = pendingLinkNavigation;
            pendingLinkNavigation = null;
            if (!nav) return;
            navigateFromLink(nav.link, e);
          }, 260),
        };
        return;
      }

      // Subsequent click in a dblclick sequence: always cancel link navigation.
      clearPendingLinkNavigation();
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", clickBlockHandler, true);
  }

  if (!hoverHandler) {
    hoverHandler = (e) => {
      if (hoverRaf) return;
      hoverRaf = window.requestAnimationFrame(() => {
        hoverRaf = null;
        const containerHit = e.target?.closest?.(
          '.fe-editable[data-md-scope="field"][data-field-type="container"], .fe-editable[data-mfe-scope="field"][data-field-type="container"]',
        );
        if (containerHit) {
          overlayEngine.hide();
          lastHoverKey = "";
          lastHoverRect = null;
          return;
        }

        const markerHit = overlayEngine.findMarkerTargetFromPoint(
          e.clientX,
          e.clientY,
        );
        const fallbackSub =
          markerHit ||
          overlayEngine.findFieldSubsectionTargetFromPoint(
            e.clientX,
            e.clientY,
          );
        if (fallbackSub?.rect) {
          const key = `${fallbackSub.scope}:${fallbackSub.section || ""}:${fallbackSub.subsection || ""}:${fallbackSub.name}`;
          if (lastHoverKey !== key) {
            lastHoverKey = key;
            overlayEngine.setLabel(
              getEditLabel(
                fallbackSub.scope,
                fallbackSub.name,
                fallbackSub.section || "",
                fallbackSub.subsection || "",
              ),
            );
            const inflated = inflateRect(fallbackSub.rect, 16);
            overlayEngine.showBox(inflated);
            lastHoverRect = inflated;
          }
          return;
        }

        const dataMfeTarget = findDataMfeTargetFromPoint(
          e.clientX,
          e.clientY,
        );
        if (dataMfeTarget?.rect) {
          const key = `${dataMfeTarget.scope}:${dataMfeTarget.section || ""}:${dataMfeTarget.subsection || ""}:${dataMfeTarget.name}`;
          if (lastHoverKey !== key) {
            lastHoverKey = key;
            overlayEngine.setLabel(
              getEditLabel(
                dataMfeTarget.scope,
                dataMfeTarget.name,
                dataMfeTarget.section || "",
                dataMfeTarget.subsection || "",
              ),
            );
            const inflated = inflateRect(dataMfeTarget.rect, 16);
            overlayEngine.showBox(inflated);
            lastHoverRect = inflated;
          }
          return;
        }

        if (
          lastHoverRect &&
          isPointInRect(e.clientX, e.clientY, lastHoverRect)
        ) {
          return;
        }
        overlayEngine.hide();
        lastHoverKey = "";
      });
    };
    document.addEventListener("mousemove", hoverHandler, true);
    window.addEventListener("scroll", overlayEngine.hide, true);
    window.addEventListener(
      "scroll",
      () => {
        overlayEngine.invalidate("scroll");
      },
      true,
    );
    window.addEventListener("resize", () => {
      overlayEngine.invalidate("resize");
    });
    window.addEventListener("load", () => {
      overlayEngine.invalidate("load");
    });
    document.addEventListener(
      "load",
      (e) => {
        if (e.target && e.target.tagName === "IMG") {
          overlayEngine.invalidate("img-load");
        }
      },
      true,
    );
  }

  if (!pointerHandler) {
    pointerHandler = () => {};
  }

  if (!beforeUnloadHandler) {
    beforeUnloadHandler = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnloadHandler);
  }

  if (!keydownHandler) {
    keydownHandler = (e) => {
      if (e.key === "Escape") {
        closeInlineEditor({ saveOnClose: false, promptOnClose: true });
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveAllDrafts({ showStatus: true });
        }
      }
    };
    document.addEventListener("keydown", keydownHandler, true);
  }
}

export { initInlineEditor };
