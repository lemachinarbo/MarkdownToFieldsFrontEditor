import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  inlineHtmlTags,
  shouldWarnForExtraContent,
  countNonEmptyBlocks,
  createMarkdownParser,
  markdownSerializer,
  decodeMarkdownBase64,
  decodeHtmlEntitiesInFences,
  getSaveUrl,
  fetchCsrfToken,
} from "./editor-core.js";
import { createToolbarButtons } from "./editor-toolbar.js";
import { renderToolbarButtons } from "./editor-toolbar-renderer.js";
import { openFullscreenEditorForElement } from "./editor-fullscreen.js";
import { createOverlayEngine } from "./overlay-engine.js";
import { resolveDblclickAction } from "./scope-resolver.js";
import { getSectionEntry, getSubsectionEntry } from "./content-index.js";
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
let hoverRaf = null;
let lastHoverKey = "";
let lastHoverRect = null;
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

function collectSectionTargets() {
  const fields = Array.from(document.querySelectorAll(".fe-editable"));
  const sections = new Map();
  const subsections = new Map();

  fields.forEach((el) => {
    const sectionName = el.getAttribute("data-md-section") || "";
    const sectionB64 = el.getAttribute("data-md-section-b64") || "";
    const subsectionName = el.getAttribute("data-md-subsection") || "";
    const subsectionB64 = el.getAttribute("data-md-subsection-b64") || "";
    if (sectionName && sectionB64) {
      if (!sections.has(sectionName)) {
        sections.set(sectionName, { b64: sectionB64, rects: [] });
      }
      sections.get(sectionName).rects.push(el.getBoundingClientRect());
    }
    if (sectionName && subsectionName && subsectionB64) {
      const key = `${sectionName}::${subsectionName}`;
      if (!subsections.has(key)) {
        subsections.set(key, {
          section: sectionName,
          name: subsectionName,
          b64: subsectionB64,
          rects: [],
        });
      }
      subsections.get(key).rects.push(el.getBoundingClientRect());
    }
  });

  const collapseRects = (rects) => {
    const bounds = rects.reduce(
      (acc, r) => ({
        left: Math.min(acc.left, r.left),
        top: Math.min(acc.top, r.top),
        right: Math.max(acc.right, r.right),
        bottom: Math.max(acc.bottom, r.bottom),
      }),
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    return bounds;
  };

  const sectionTargets = Array.from(sections.entries()).map(([name, data]) => ({
    scope: "section",
    name,
    b64: data.b64,
    rect: collapseRects(data.rects),
  }));

  const subsectionTargets = Array.from(subsections.values()).map((data) => ({
    scope: "subsection",
    name: data.name,
    section: data.section,
    b64: data.b64,
    rect: collapseRects(data.rects),
  }));

  return { sectionTargets, subsectionTargets };
}

function findTargetFromPoint(x, y) {
  const { sectionTargets, subsectionTargets } = collectSectionTargets();
  const hit = (rect) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

  const sub = subsectionTargets.find((t) => hit(t.rect));
  if (sub) return sub;
  const sec = sectionTargets.find((t) => hit(t.rect));
  if (sec) return sec;
  return null;
}

function findSectionFromText(text) {
  const cfg = window.MarkdownFrontEditorConfig || {};
  const sections = Array.isArray(cfg.sectionsIndex) ? cfg.sectionsIndex : [];
  const needle = (text || "").trim();
  if (!needle) return null;

  const normalize = (value) =>
    (value || "")
      .replace(/\s+/g, " ")
      .trim();

  const findTextRect = (snippet) => {
    const search = normalize(snippet);
    if (!search) return null;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("script, style, noscript")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    let current = walker.nextNode();
    while (current) {
      const value = normalize(current.nodeValue);
      const index = value.indexOf(search);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(current, index);
        range.setEnd(current, index + search.length);
        const rect = range.getBoundingClientRect();
        if (rect && rect.width && rect.height) {
          return rect;
        }
      }
      current = walker.nextNode();
    }
    return null;
  };

  const getSectionText = (section) => {
    if (section?.text) return normalize(section.text);
    if (section?.markdownB64) {
      try {
        const decoded = decodeMarkdownBase64(section.markdownB64);
        return normalize(decoded.replace(/[`*_>#\-\[\]!\(\)]/g, " "));
      } catch (e) {
        return "";
      }
    }
    return "";
  };

  const needleNorm = normalize(needle);
  for (const section of sections) {
    const subs = Array.isArray(section.subsections)
      ? section.subsections
      : [];
    for (const sub of subs) {
      const hay = getSectionText(sub);
      if (hay && hay.includes(needleNorm)) {
        const rect = findTextRect(needle);
        return { scope: "subsection", section: section.name, ...sub, rect };
      }
    }
    const sectionText = getSectionText(section);
    if (sectionText && sectionText.includes(needleNorm)) {
      const rect = findTextRect(needle);
      return { scope: "section", ...section, rect };
    }
  }
  return null;
}

function normalizeText(value) {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function createVirtualTarget({
  pageId,
  scope,
  name,
  section = "",
  markdown,
}) {
  const el = document.createElement("div");
  el.className = "fe-editable md-edit mfe-virtual";
  el.setAttribute("data-page", pageId);
  el.setAttribute("data-md-scope", scope);
  el.setAttribute("data-md-name", name);
  if (section) {
    el.setAttribute("data-md-section", section);
  }
  if (markdown !== undefined) {
    el.setAttribute(
      "data-markdown-b64",
      btoa(unescape(encodeURIComponent(markdown))),
    );
  }
  return el;
}

function getEditLabel(scope, name, section) {
  if (!debugLabels) return "Double click to edit";
  if (section) {
    return `Double click to edit (${scope}: ${section} → ${name})`;
  }
  if (name) {
    return `Double click to edit (${scope}: ${name})`;
  }
  return `Double click to edit (${scope})`;
}

function applyEditLabelAttributes(el) {
  if (!el) return;
  const scope = el.getAttribute("data-md-scope") || "field";
  const name = el.getAttribute("data-md-name") || "";
  const section = el.getAttribute("data-md-section") || "";
  el.setAttribute("data-mfe-label", getEditLabel(scope, name, section));
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
  return window.confirm(
    "You have unsaved changes. Discard them and close?",
  );
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
                if (node.marks?.some((mark) => mark.type.name === "code")) return;

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

  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
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
      const markdown = decodeHtmlEntitiesInFences(getMarkdownFromEditor(editor));
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
      const formData = new FormData();
      formData.append("markdown", finalMarkdown);
      formData.append("mdName", fieldName);
      formData.append("mdScope", scope || "field");
      if (section) {
        formData.append("mdSection", section);
      }
      formData.append("pageId", pageId);

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
      if (data.html) {
        originalHtml.set(target, data.html);
        target.innerHTML = data.html;
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
    const markdown = decodeHtmlEntitiesInFences(getMarkdownFromEditor(activeEditor));
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

  const batchSaves = Array.from(grouped.entries()).map(
    ([pageId, fields]) => saveBatch(pageId, fields),
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
      const formData = new FormData();
      formData.append("batch", "1");
      formData.append("pageId", pageId);
      formData.append("fields", JSON.stringify(fields));

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
      const htmlMap = data.html || {};
      Object.entries(htmlMap).forEach(([fieldKey, html]) => {
        const fieldId = fieldElements.has(fieldKey) ? fieldKey : `${pageId}:${fieldKey}`;
        const target = fieldElements.get(fieldId);
        if (!target) return;
        if (html) {
          originalHtml.set(target, html);
          target.innerHTML = html;
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
    });
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
  });

  const configButtons =
    window.MarkdownFrontEditorConfig?.toolbarButtons ||
    "bold,italic,strike,paragraph,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,|,link,unlink,|,code,codeblock,clear";

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
    const parser = createMarkdownParser(activeEditor.schema);
    const doc = parser.parse(markdownContent || "");
    activeEditor.commands.setContent(doc.toJSON(), false);
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
    fieldName: el.getAttribute("data-md-name") || "unknown",
    fieldType: el.getAttribute("data-field-type") || "tag",
    fieldScope: el.getAttribute("data-md-scope") || "field",
    fieldSection: el.getAttribute("data-md-section") || "",
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
    const markdown = decodeHtmlEntitiesInFences(getMarkdownFromEditor(editorForDraft));
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

  const editables = Array.from(document.querySelectorAll(".fe-editable"));
  editables.forEach((el) => {
    applyEditLabelAttributes(el);
  });

  overlayEngine.init();

  if (!dblclickHandler) {
    dblclickHandler = (e) => {
      if (document.body.classList.contains("mfe-view-fullscreen")) {
        return;
      }
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
        findSectionFromText,
        decodeMarkdownBase64,
        createVirtualTarget,
        pageId:
          document.querySelector(".fe-editable")?.getAttribute("data-page") ||
          "0",
      });

      if (!action || action.action === "none") {
        if (debugClicks) {
          console.log("[mfe] dblclick:none", {
            targetTag: e.target?.tagName || null,
            reason: action?.reason || null,
          });
        }
        return;
      }

      if (debugClicks) {
        console.log("[mfe] dblclick:action", {
          action: action.action,
          reason: action.reason,
          targetName: action.target?.getAttribute?.("data-md-name") || null,
          targetScope: action.target?.getAttribute?.("data-md-scope") || null,
          targetType: action.target?.getAttribute?.("data-field-type") || null,
        });
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

  if (!hoverHandler) {
    hoverHandler = (e) => {
      if (hoverRaf) return;
      hoverRaf = window.requestAnimationFrame(() => {
        hoverRaf = null;
        const containerHit = e.target?.closest?.(
          '.fe-editable[data-md-scope="field"][data-field-type="container"]',
        );
        if (containerHit) {
          const rect = getRectFromChildren(containerHit);
          const name = containerHit.getAttribute("data-md-name") || "";
          const key = `container:${name}`;
          if (rect && lastHoverKey !== key) {
            lastHoverKey = key;
            overlayEngine.setLabel(getEditLabel("container", name, ""));
            const inflated = inflateRect(rect, 32);
            overlayEngine.showBox(inflated);
            lastHoverRect = inflated;
          }
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
          const key = `${fallbackSub.scope}:${fallbackSub.section || ""}:${fallbackSub.name}`;
          if (lastHoverKey !== key) {
            lastHoverKey = key;
            overlayEngine.setLabel(
              getEditLabel(
                fallbackSub.scope,
                fallbackSub.name,
                fallbackSub.section || "",
              ),
            );
            const inflated = inflateRect(fallbackSub.rect, 16);
            overlayEngine.showBox(inflated);
            lastHoverRect = inflated;
          }
          return;
        }

        if (lastHoverRect && isPointInRect(e.clientX, e.clientY, lastHoverRect)) {
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
