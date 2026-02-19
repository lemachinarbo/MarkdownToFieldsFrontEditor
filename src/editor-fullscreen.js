/**
 * Tiptap-based Markdown Editor for MarkdownToFields
 *
 * Uses Tiptap v.3 with prosemirror-markdown for markdown serialization.
 * This editor provides WYSIWYG editing while preserving markdown integrity.
 */

import { Editor, Extension, Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Plugin, NodeSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { createToolbarButtons } from "./editor-toolbar.js";
import { renderToolbarButtons } from "./editor-toolbar-renderer.js";
import { createStatusManager } from "./editor-status.js";
import {
  inlineHtmlTags,
  shouldWarnForExtraContent,
  countNonEmptyBlocks,
  renderMarkdownToHtml,
  markdownSerializer,
  decodeMarkdownBase64,
  decodeHtmlEntitiesInFences,
  getLanguagesConfig,
  fetchTranslations,
  saveTranslation,
  getSaveUrl,
  fetchCsrfToken,
} from "./editor-core.js";
import { Marker } from "./marker-extension.js";
import {
  buildContentIndex,
  getSectionEntry,
  getSubsectionEntry,
} from "./content-index.js";
import { createImagePicker } from "./image-picker.js";
import {
  normalizeComparableMarkdown,
  parseFieldId,
  clearDraftsCoveredByChangedKeys,
} from "./draft-utils.js";
import {
  buildSemanticLookup,
  scopedHtmlKeyFromMeta,
  applyChangedHtmlByKeyStrict,
  fanOutChangedHtmlBySource,
  syncEditableMarkdownAttributesFromFieldsIndex as syncFieldsIndexToEditableAttrs,
} from "./sync-by-key.js";
import {
  openWindow,
  closeWindow,
  updateWindowById,
} from "./window-manager.js";

let activeEditor = null;
let primaryEditor = null;
let secondaryEditor = null;
let secondaryLang = "";
let translationsCache = null;
const translationsCacheByFieldId = new Map();
const originalBlockCounts = new WeakMap();
let editorShell = null;
let editorContainer = null;
let overlayEl = null;
let splitPane = null;
let saveStatusEl = null;
let primaryDirty = false;
const dirtyTranslations = new Map();
let activeTarget = null;
let activeFieldName = null;
let activeFieldType = null; // "tag" or "container"
let activeFieldScope = "field";
let activeFieldSection = "";
let activeFieldSubsection = "";
let activeFieldId = null;
let activeRawMarkdown = null;
let activeDisplayMarkdown = null;
const warnedMissingMountKeys = new Set();
let suppressNextCloseConfirm = false;
const primaryDraftsByFieldId = new Map();
const draftMarkdownByScopedKey = new Map();
let suppressDirtyTracking = 0;
let breadcrumbAnchor = null;
let navigatingViaBreadcrumb = false;

function runWithoutDirtyTracking(fn) {
  suppressDirtyTracking += 1;
  try {
    return fn();
  } finally {
    suppressDirtyTracking = Math.max(0, suppressDirtyTracking - 1);
  }
}

function hasActivePrimaryDraft() {
  if (activeFieldId && primaryDraftsByFieldId.has(activeFieldId)) return true;
  const scopedKey = getActiveScopedHtmlKey();
  if (scopedKey && draftMarkdownByScopedKey.has(scopedKey)) return true;
  return false;
}

function syncDirtyStatusForActiveField() {
  if (!activeFieldId) return;
  if (hasPendingUnsavedChanges()) {
    statusManager.markDirty(activeFieldId);
    return;
  }
  statusManager.clearDirty(activeFieldId);
}

function handlePrimarySaveResponse(data, finalMarkdown, options = {}) {
  const { updateActiveEditor = true } = options;
  const activeScopedKey = getActiveScopedHtmlKey();
  const htmlMap =
    data.fragments ||
    data.htmlMap ||
    (typeof data.html === "object" ? data.html : {});
  const changedKeys =
    Array.isArray(data.changed) && data.changed.length
      ? data.changed
      : activeScopedKey
        ? [activeScopedKey]
        : [];
  console.warn("[mfe:save-sync] fragment response", {
    activeScopedKey,
    changedKeys,
    hasFragments: Boolean(data.fragments),
    fragmentsKeys: data.fragments ? Object.keys(data.fragments).length : 0,
    htmlMapKeys: data.htmlMap ? Object.keys(data.htmlMap).length : 0,
  });
  clearDraftsCoveredByChangedKeys({
    changedKeys,
    draftMarkdownByScopedKey,
    primaryDraftsByFieldId,
    clearDirtyByFieldId: (fieldId) => statusManager.clearDirty(fieldId),
  });
  if (activeFieldId) {
    primaryDraftsByFieldId.delete(activeFieldId);
  }
  if (activeScopedKey) {
    draftMarkdownByScopedKey.delete(activeScopedKey);
  }
  primaryDirty = false;
  syncDirtyStatusForActiveField();

  const primaryHtmlRaw =
    (activeScopedKey && typeof htmlMap[activeScopedKey] === "string")
      ? htmlMap[activeScopedKey]
      : (typeof data.html === "string" ? data.html : "");
  const primaryHtml = normalizeHtmlImageSources(primaryHtmlRaw || "");
  if (data.sectionsIndex) {
    window.MarkdownFrontEditorConfig =
      window.MarkdownFrontEditorConfig || {};
    window.MarkdownFrontEditorConfig.sectionsIndex =
      data.sectionsIndex;
  }
  if (data.fieldsIndex) {
    window.MarkdownFrontEditorConfig =
      window.MarkdownFrontEditorConfig || {};
    window.MarkdownFrontEditorConfig.fieldsIndex = data.fieldsIndex;
  }
  const sections = Array.isArray(window.MarkdownFrontEditorConfig?.sectionsIndex)
    ? window.MarkdownFrontEditorConfig.sectionsIndex
    : [];
  const fields = Array.isArray(window.MarkdownFrontEditorConfig?.fieldsIndex)
    ? window.MarkdownFrontEditorConfig.fieldsIndex
    : [];
  const semanticLookup = buildSemanticLookup({ sections, fields });

  const debugSync = Boolean(window.MarkdownFrontEditorConfig?.debugLabels);
  applyChangedHtmlByKeyStrict({
    changedKeys,
    htmlMap,
    root: document,
    normalizeHtml: normalizeHtmlImageSources,
    warnedMissingMountKeys,
    debug: debugSync,
    getMetaAttr,
    semanticLookup,
    isOuterSwapKey: (key, mount) => {
      if (!key || !key.startsWith("section:")) return false;
      const rootKey = mount.getAttribute?.("data-mfe-root") || "";
      return rootKey === key;
    },
  });
  fanOutChangedHtmlBySource({
    changedKeys,
    htmlMap,
    root: document,
    normalizeHtml: normalizeHtmlImageSources,
    semanticLookup,
  });
  syncFieldsIndexToEditableAttrs({
    root: document,
    fields,
    sections,
    getMetaAttr,
    decodeMarkdownBase64,
  });
  annotateBoundImages();
  initEditors();

  if (updateActiveEditor && activeTarget && primaryHtml) {
    activeTarget.dataset.markdown = finalMarkdown;
    if (activeTarget.classList?.contains("fe-editable")) {
      activeTarget.setAttribute("data-markdown-b64", encodeMarkdownBase64(finalMarkdown));
    }
    if (primaryEditor) {
      const selection = primaryEditor.state.selection;
      runWithoutDirtyTracking(() => {
        primaryEditor.commands.setContent(primaryHtml, false);
      });
      try {
        primaryEditor.commands.setTextSelection(selection);
      } catch (e) {}
    }
  }
}

async function savePendingDrafts() {
  const entries = Array.from(primaryDraftsByFieldId.entries());
  if (!entries.length) return;
  const csrf = await fetchCsrfToken();
  const { current } = getLanguagesConfig();

  for (const [fieldId, markdown] of entries) {
    const parsed = parseFieldId(fieldId);
    if (!parsed) continue;
    const formData = new FormData();
    formData.append("markdown", markdown || "");
    formData.append("mdName", parsed.name);
    formData.append("mdScope", parsed.scope || "field");
    if (parsed.section) formData.append("mdSection", parsed.section);
    if (parsed.subsection) formData.append("mdSubsection", parsed.subsection);
    formData.append("pageId", parsed.pageId || "0");
    formData.append("fieldId", parsed.fieldId);
    if (current) formData.append("lang", current);
    if (csrf) formData.append(csrf.name, csrf.value);

    const res = await fetch(getSaveUrl(), {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.status) {
      throw new Error(data.message || "Save failed");
    }
    handlePrimarySaveResponse(data, markdown, { updateActiveEditor: false });
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

function getImageBaseUrl() {
  const fromConfig = window.MarkdownFrontEditorConfig?.imageBaseUrl;
  const base =
    typeof fromConfig === "string" && fromConfig.trim() !== ""
      ? fromConfig
      : "/";
  return base.endsWith("/") ? base : `${base}/`;
}

function buildFieldId(pageId, scope, section, subsection, name) {
  const sub = subsection || "";
  if (sub) {
    return `${pageId}:${scope}:${section}:${sub}:${name}`;
  }
  return `${pageId}:${scope}:${section}:${name}`;
}
let breadcrumbsEl = null;
let breadcrumbClickHandler = null;
const statusManager = createStatusManager();

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
let saveCallback = null;
let keydownHandler = null;

function hasPendingUnsavedChanges() {
  if (primaryDirty) return true;
  if (primaryDraftsByFieldId.size > 0) return true;
  if (draftMarkdownByScopedKey.size > 0) return true;
  for (const dirty of dirtyTranslations.values()) {
    if (dirty) return true;
  }
  return false;
}

function shouldConfirmUnsavedClose() {
  const cfg = window.MarkdownFrontEditorConfig || {};
  return cfg.confirmOnUnsavedClose !== false;
}

function confirmDiscardUnsavedChanges() {
  if (suppressNextCloseConfirm) {
    suppressNextCloseConfirm = false;
    return true;
  }
  if (!hasPendingUnsavedChanges()) return true;
  if (!shouldConfirmUnsavedClose()) return true;
  const ok = window.confirm("You have unsaved changes. Discard them and close?");
  if (ok) {
    primaryDraftsByFieldId.clear();
    draftMarkdownByScopedKey.clear();
    primaryDirty = false;
    dirtyTranslations.clear();
  }
  return ok;
}

async function keepPendingChangesBeforeSwitch() {
  if (!activeFieldId || !primaryEditor) return true;
  const currentScopedKey = getActiveScopedHtmlKey();
  const oldMarkdown = activeRawMarkdown || "";
  const markdown = getMarkdownFromEditor(primaryEditor);
  const hasActiveDraft = hasActivePrimaryDraft();
  const equivalent =
    normalizeComparableMarkdown(markdown) ===
    normalizeComparableMarkdown(oldMarkdown);

  if (!primaryDirty && !hasActiveDraft) {
    if (activeFieldId) {
      primaryDraftsByFieldId.delete(activeFieldId);
    }
    if (currentScopedKey) {
      draftMarkdownByScopedKey.delete(currentScopedKey);
    }
    syncDirtyStatusForActiveField();
    return true;
  }

  if (primaryDirty && equivalent) {
    if (activeFieldId) {
      primaryDraftsByFieldId.delete(activeFieldId);
    }
    if (currentScopedKey) {
      draftMarkdownByScopedKey.delete(currentScopedKey);
    }
    primaryDirty = false;
    syncDirtyStatusForActiveField();
    return true;
  }

  primaryDraftsByFieldId.set(activeFieldId, markdown);
  if (currentScopedKey) {
    draftMarkdownByScopedKey.set(currentScopedKey, markdown);
  }
  propagateDraftToAncestors(oldMarkdown, markdown);
  return true;
}

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

function createEditorInstance(element, fieldType, fieldName) {
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
    element,
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

                const resolvedSrc = `${getImageBaseUrl()}${attributes.src.replace(/^\/+/, "")}`;
                return { src: resolvedSrc };
              },
            },
            originalFilename: {
              default: null,
            },
          };
        },
        addNodeView() {
          return ({ node, HTMLAttributes, getPos, editor }) => {
            const resolveImageSrc = (src) => {
              if (!src) return "";
              if (src.match(/^(https?:|\/|\?|\/\/)/)) return src;
              return `${getImageBaseUrl()}${src.replace(/^\/+/, "")}`;
            };

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
                const imagePos = typeof getPos === "function" ? getPos() : null;
                window.mfeOpenImagePicker(node.attrs, imagePos);
              }
            };

            return {
              dom: container,
              update: (updatedNode) => {
                if (updatedNode.type.name !== "image") return false;
                const src = resolveImageSrc(updatedNode.attrs.src);
                if (src) {
                  img.setAttribute("src", src);
                } else {
                  img.removeAttribute("src");
                }
                img.setAttribute("alt", updatedNode.attrs.alt || "");
                if (updatedNode.attrs.title) {
                  img.setAttribute("title", updatedNode.attrs.title);
                } else {
                  img.removeAttribute("title");
                }
                return true;
              },
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
                      window.mfeOpenImagePicker(node.attrs, nodePos);
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
      // EscapeKeyExtension, - DEPRECATED: WindowManager now handles global Escape
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm focus:outline-none mfe-editor",
        spellcheck: "false",
      },
    },
  });

  applyFieldAttributes(editor, fieldType, fieldName);

  editor.on("focus", () => {
    activeEditor = editor;
  });

  editor.on("update", () => {
    if (suppressDirtyTracking > 0) return;
    highlightExtraContent(editor);
    if (shouldWarnForExtraContent(fieldType, fieldName)) {
      stripTrailingEmptyParagraph(editor);
    }
    if (editor === primaryEditor) {
      primaryDirty = true;
      if (activeFieldId) {
        primaryDraftsByFieldId.set(activeFieldId, getMarkdownFromEditor(editor));
      }
      if (activeFieldId) {
        statusManager.markDirty(activeFieldId);
      }
    }
    if (editor === secondaryEditor && secondaryLang) {
      dirtyTranslations.set(secondaryLang, true);
      translationsCache = translationsCache || {};
      translationsCache[secondaryLang] = getMarkdownFromEditor(editor);
      if (activeFieldId) {
        translationsCacheByFieldId.set(activeFieldId, translationsCache);
      }
    }
  });

  editor.view.dom.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    if (!primaryEditor || !secondaryEditor) return;
    e.preventDefault();
    if (e.shiftKey) {
      primaryEditor.view.focus();
    } else {
      secondaryEditor.view.focus();
    }
  });

  return editor;
}

function saveAllEditors() {
  const tasks = [];
  if (primaryEditor && (primaryDirty || hasActivePrimaryDraft())) {
    tasks.push(
      new Promise((resolve, reject) => {
        const markdown = getMarkdownFromEditor(primaryEditor);
        if (saveCallback) {
          try {
            saveCallback(markdown, resolve, reject);
          } catch (err) {
            reject(err);
          }
        } else {
          resolve();
        }
      }),
    );
  } else if (primaryEditor && primaryDraftsByFieldId.size > 0) {
    tasks.push(savePendingDrafts());
  }

  if (secondaryEditor) {
    for (const [lang, dirty] of dirtyTranslations.entries()) {
      if (!dirty) continue;
      const pageId = activeTarget?.getAttribute("data-page") || "";
      const mdName = activeFieldName || "";
      const markdown = translationsCache?.[lang] ?? "";
      tasks.push(
        saveTranslation(
          pageId,
          mdName,
          lang,
          markdown,
          activeFieldScope,
          activeFieldSection,
        ),
      );
      dirtyTranslations.set(lang, false);
    }
  }

  if (tasks.length === 0) {
    statusManager.setNoChanges();
    syncDirtyStatusForActiveField();
    return;
  }

  Promise.all(tasks)
    .then(() => {
      primaryDirty = false;
      syncDirtyStatusForActiveField();
      statusManager.setSaved();
    })
    .catch(() => {
      statusManager.setError();
    });
}

function toggleSplit() {
  if (secondaryEditor) {
    closeSplit();
  } else {
    openSplit();
  }
}

function toggleMarkers() {
  document.body.classList.toggle("mfe-hide-markers");
}

function openSplit() {
  if (!editorShell || secondaryEditor) return;
  const { langs, current } = getLanguagesConfig();
  const otherLangs = langs.filter((l) => l.name !== current);
  if (otherLangs.length === 0) return;

  splitPane = document.createElement("div");
  splitPane.className = "mfe-editor-pane mfe-editor-pane--secondary";

  const header = document.createElement("div");
  header.className = "mfe-editor-pane-header";
  header.innerHTML = `
    <label class="mfe-editor-pane-label">Language</label>
    <select class="mfe-editor-pane-select"></select>
  `;

  const select = header.querySelector(".mfe-editor-pane-select");
  otherLangs.forEach((lang) => {
    const opt = document.createElement("option");
    opt.value = lang.name;
    const label =
      typeof lang.title === "string" && lang.title.trim() !== ""
        ? lang.title
        : String(lang.title || lang.name);
    opt.textContent = label;
    select.appendChild(opt);
  });
  if (otherLangs[0]) {
    select.value = otherLangs[0].name;
  }

  const body = document.createElement("div");
  body.className = "mfe-editor-pane-body";

  splitPane.appendChild(header);
  splitPane.appendChild(body);
  editorShell.appendChild(splitPane);

  secondaryEditor = createEditorInstance(
    body,
    activeFieldType,
    activeFieldName,
  );
  activeEditor = secondaryEditor;

  select.addEventListener("change", () => {
    setSecondaryLanguage(select.value);
  });

  if (translationsCache === null) {
    const pageId = activeTarget?.getAttribute("data-page") || "";
    const mdName = activeFieldName || "";
    fetchTranslations(
      mdName,
      pageId,
      activeFieldScope,
      activeFieldSection,
    ).then((data) => {
      translationsCache = data || {};
      if (activeFieldId) {
        translationsCacheByFieldId.set(activeFieldId, translationsCache);
      }
      setSecondaryLanguage(select.value);
    });
  } else {
    setSecondaryLanguage(select.value);
  }
}

function closeSplit() {
  if (secondaryEditor) {
    secondaryEditor.destroy();
    secondaryEditor = null;
  }
  if (splitPane) {
    splitPane.remove();
    splitPane = null;
  }
  secondaryLang = "";
  activeEditor = primaryEditor;
}

function setSecondaryLanguage(lang) {
  if (!secondaryEditor) return;
  secondaryLang = lang;
  const markdown = translationsCache?.[lang] ?? "";
  const html = renderMarkdownToHtml(markdown || "");
  runWithoutDirtyTracking(() => {
    secondaryEditor.commands.setContent(html, false);
  });
  if (shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    stripTrailingEmptyParagraph(secondaryEditor);
  }
  setOriginalBlockCount(secondaryEditor, activeFieldType, activeFieldName);
  highlightExtraContent(secondaryEditor);
  dirtyTranslations.set(lang, false);
}

// Custom extension to handle Escape key - DEPRECATED: WindowManager now handles global Escape
// const EscapeKeyExtension = Extension.create({
//   name: "escapeKeyExtension",
//
//   addKeyboardShortcuts() {
//     return {
//       Escape: () => {
//         closeEditor();
//         return true;
//       },
//     };
//   },
// });

/**
 * Initialize the editor for a specific field
 */
function initEditor(markdownContent, onSave, fieldType = "tag") {
  activeFieldType = fieldType;
  saveCallback = onSave;

  // Create container (starts at top, centered)
  const container = document.createElement("div");
  container.setAttribute("data-editor-container", "true");
  container.setAttribute("data-field-type", fieldType);
  container.className = "mfe-container";
  container.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  editorContainer = container;

  // OLD: breadcrumbs are now handled by WindowManager
  // Don't create breadcrumbs here anymore
  // breadcrumbsEl = document.createElement("div");
  // breadcrumbsEl.className = "mfe-breadcrumbs";
  // container.appendChild(breadcrumbsEl);

  editorShell = document.createElement("div");
  editorShell.className = "mfe-editor-shell";
  container.appendChild(editorShell);

  const primaryPane = document.createElement("div");
  primaryPane.className = "mfe-editor-pane mfe-editor-pane--primary";
  const primaryHeader = document.createElement("div");
  primaryHeader.className =
    "mfe-editor-pane-header mfe-editor-pane-header--spacer";
  primaryPane.appendChild(primaryHeader);
  editorShell.appendChild(primaryPane);

  // Create primary editor
  primaryEditor = createEditorInstance(primaryPane, fieldType, activeFieldName);
  activeEditor = primaryEditor;

  // Parse markdown into editor schema and set content
  const html = renderMarkdownToHtml(markdownContent || "");
  runWithoutDirtyTracking(() => {
    primaryEditor.commands.setContent(html, false);
  });
  if (shouldWarnForExtraContent(fieldType, activeFieldName)) {
    stripTrailingEmptyParagraph(primaryEditor);
  }
  setOriginalBlockCount(primaryEditor, fieldType, activeFieldName);
  highlightExtraContent(primaryEditor);
  primaryDirty = false;
  dirtyTranslations.clear();

  // Create toolbar (will be moved to menu bar after window opens)
  const toolbar = createToolbar(); // Returns the toolbar element, not appended yet

  // Build breadcrumb hierarchy for window manager
  const breadcrumbItems = buildBreadcrumbItems();

  // Open the window
  const win = openWindow({
    id: "mfe-editor",
    content: container,
    onBeforeClose: confirmDiscardUnsavedChanges,
    onClose: cleanupEditorOnly,
    showMenuBar: true,
    menuBarDisabled: false,
    breadcrumbItems: breadcrumbItems,
    breadcrumbClickHandler: handleBreadcrumbClick,
    className: "mfe-editor-window",
    background: "white",
    onMount: (overlay, windowInstance) => {
      // Attach toolbar to the menu bar after window is created
      const menuBarInner = overlay.querySelector("[data-mfe-menubar-inner]");
      if (menuBarInner && toolbar) {
        menuBarInner.appendChild(toolbar);
      }
    },
  });
  overlayEl = win.dom;
  document.body.classList.add("mfe-view-fullscreen");

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Focus editor
  setTimeout(() => primaryEditor.view.focus(), 0);
}

function cleanupEditorOnly() {
  if (secondaryEditor) {
    secondaryEditor.destroy();
    secondaryEditor = null;
  }
  if (primaryEditor) {
    primaryEditor.destroy();
    primaryEditor = null;
  }
  activeEditor = null;

  // Remove keyboard event listener
  if (keydownHandler) {
    document.removeEventListener("keydown", keydownHandler, true);
    keydownHandler = null;
  }

  document.body.classList.remove("mfe-view-fullscreen");
  statusManager.reset();

  saveCallback = null;
  activeTarget = null;
  activeFieldName = null;
  activeFieldType = null;
  activeFieldScope = "field";
  activeFieldSection = "";
  activeFieldSubsection = "";
  activeFieldId = null;
  activeRawMarkdown = null;
  activeDisplayMarkdown = null;
  translationsCache = null;
  secondaryLang = "";
  editorShell = null;
  editorContainer = null;
  overlayEl = null;
  splitPane = null;
  breadcrumbsEl = null;
  navigatingViaBreadcrumb = false;
}

/**
 * Open image picker and insert selected image
 */
function openImagePicker(initialData = null, imagePos = null) {
  const editor = activeEditor || primaryEditor;
  if (!editor) return;

  createImagePicker({
    initialData,
    onSelect: (imageData) => {
      // imageData is { filename, url, alt }
      const editor = activeEditor || primaryEditor;
      if (!editor) return;

      let shouldReplaceSelectedImage = false;
      if (typeof imagePos === "number") {
        const imageNode = editor.state.doc.nodeAt(imagePos);
        if (imageNode && imageNode.type.name === "image") {
          const tr = editor.state.tr.setSelection(
            NodeSelection.create(editor.state.doc, imagePos),
          );
          editor.view.dispatch(tr);
          shouldReplaceSelectedImage = true;
        }
      }
      if (!shouldReplaceSelectedImage) {
        const { selection } = editor.state;
        shouldReplaceSelectedImage =
          selection.node && selection.node.type.name === "image";
      }

      if (shouldReplaceSelectedImage) {
        editor
          .chain()
          .focus()
          .updateAttributes("image", {
            src: imageData.url,
            alt: imageData.alt || "",
            originalFilename: imageData.filename,
          })
          .run();
      } else {
        editor
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
    if (editor === primaryEditor) {
      primaryDirty = true;
      const scopedKey = getActiveScopedHtmlKey();
      if (scopedKey) {
        draftMarkdownByScopedKey.set(scopedKey, getMarkdownFromEditor(editor));
      }
      if (activeFieldId) {
        statusManager.markDirty(activeFieldId);
      }
      }
      if (editor === secondaryEditor && secondaryLang) {
        dirtyTranslations.set(secondaryLang, true);
      }
    },
    onClose: () => {
      // Refocus editor after picker closes
      setTimeout(() => editor.view.focus(), 0);
    },
  });
}

// Expose globally for toolbar button and extension
window.mfeOpenImagePicker = openImagePicker;

/**
 * Create the toolbar
 */
function createToolbar() {
  const toolbar = document.createElement("div");
  toolbar.id = "editor-toolbar"; // Add ID for easy selection
  toolbar.className = "mfe-toolbar";
  toolbar.setAttribute("data-editor-toolbar", "true");

  const buttons = createToolbarButtons({
    getEditor: () => activeEditor,
    onSave: saveAllEditors,
    onToggleSplit: toggleSplit,
    onToggleMarkers: toggleMarkers,
  });

  const configButtons =
    window.MarkdownFrontEditorConfig?.toolbarButtons ||
    "bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,|,code,codeblock,clear,|,split,markers";
  const { statusEl } = renderToolbarButtons({
    toolbar,
    buttons,
    configButtons,
    getEditor: () => activeEditor,
  });
  saveStatusEl = statusEl;
  statusManager.registerStatusEl(statusEl);

  return toolbar;
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  if (keydownHandler) {
    document.removeEventListener("keydown", keydownHandler, true);
  }

  const handler = (e) => {
    if (!activeEditor) return;

    // Handle Ctrl/Cmd+S for save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      e.stopPropagation();
      saveAllEditors();
      return; // Important: return to avoid processing other cases
    }

    // Handle other Ctrl/Cmd shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "b":
          e.preventDefault();
          activeEditor.chain().focus().toggleBold().run();
          return;
        case "i":
          e.preventDefault();
          activeEditor.chain().focus().toggleItalic().run();
          return;
        case "k":
          e.preventDefault();
          // show link prompt
          const url = prompt("Enter URL:");
          if (url) {
            activeEditor.chain().focus().setLink({ href: url }).run();
          }
          return;
      }
    }
  };

  keydownHandler = handler;
  document.addEventListener("keydown", keydownHandler, true);
}

/**
 * Get markdown from editor state
 */
function getMarkdownFromEditor(editor = activeEditor) {
  if (!editor) return "";

  return markdownSerializer.serialize(editor.state.doc);
}

/**
 * Highlight extra paragraphs that won't be saved in tag fields
 */
function highlightExtraContent(editor = activeEditor) {
  if (!editor) {
    return;
  }

  if (!shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    if (editor?.view?.dom) {
      editor.view.dom.removeAttribute("data-extra-warning-active");
    }
    return;
  }

  const currentBlockCount = countNonEmptyBlocks(editor.state.doc);

  const originalBlockCount = getOriginalBlockCount(editor);

  // Only show warning if user has ADDED blocks beyond the original
  // (This applies to any field - if originalBlockCount is 1, only 1 block should be added)
  if (currentBlockCount <= originalBlockCount) {
    editor.view.dom.setAttribute("data-extra-warning-active", "false");
    return;
  }

  editor.view.dom.setAttribute("data-extra-warning-active", "true");
}

/**
 * Remove visual indicators for tag field content
 */
function clearExtraContentHighlights() {}

/**
 * Build a breadcrumb label for the window hierarchy
 */
function getActiveHierarchy() {
  const scope = activeFieldScope || "field";
  const name = activeFieldName || "";
  const type = activeFieldType || "";
  const isContainer = type === "container";
  const explicitSection = activeFieldSection || getMetaAttr(activeTarget, "section") || "";
  const explicitSubsection =
    activeFieldSubsection || getMetaAttr(activeTarget, "subsection") || "";
  const inferredSectionFromSub =
    scope === "subsection" ? findSectionNameForSubsection(name) : "";
  let subsection = explicitSubsection || (scope === "subsection" ? name : "");
  if (!subsection && scope === "field" && activeTarget?.closest) {
    const subWrap = activeTarget.closest(
      '[data-mfe-scope="subsection"], [data-md-scope="subsection"]',
    );
    subsection = getMetaAttr(subWrap, "name") || "";
  }
  const section =
    explicitSection ||
    inferredSectionFromSub ||
    (scope === "section" ? name : "") ||
    (subsection ? findSectionNameForSubsection(subsection) : "");

  return { scope, name, section, subsection, type, isContainer };
}

function deriveHierarchyFromPayload(payload) {
  const scope = payload?.fieldScope || "field";
  const type = payload?.fieldType || "tag";
  const isContainer = type === "container";
  const name = payload?.fieldName || "";
  let section = payload?.fieldSection || "";
  let subsection = payload?.fieldSubsection || "";

  if (scope === "section") {
    section = name;
    subsection = "";
  } else if (scope === "subsection") {
    subsection = name;
  }

  return { scope, name, section, subsection, type, isContainer };
}

function updateBreadcrumbAnchorFromPayload(payload) {
  if (navigatingViaBreadcrumb && breadcrumbAnchor) return;
  breadcrumbAnchor = deriveHierarchyFromPayload(payload);
}

function getBreadcrumbContentId(target, section, subsection, name) {
  if (target === "section") {
    return section ? `section:${section}` : "";
  }
  if (target === "subsection") {
    return section && subsection ? `subsection:${section}:${subsection}` : "";
  }
  if (target === "container" || target === "field") {
    if (section && subsection && name) {
      return `subsection:${section}:${subsection}:${name}`;
    }
    return name ? `field:${section ? `${section}:` : ""}${name}` : "";
  }
  return "";
}

function buildBreadcrumbParts() {
  const active = getActiveHierarchy();
  const source = breadcrumbAnchor || active;
  const { scope, name, section, subsection, type, isContainer } = source;

  const parts = [];
  if (section) {
    parts.push({
      label: `Section: ${section}`,
      target: "section",
      section,
      subsection,
      name,
      contentId: getBreadcrumbContentId("section", section, subsection, name),
    });
  }
  if (subsection) {
    parts.push({
      label: `Sub: ${subsection}`,
      target: "subsection",
      section,
      subsection,
      name,
      contentId: getBreadcrumbContentId("subsection", section, subsection, name),
    });
  }
  if (scope === "field" && isContainer && name) {
    parts.push({
      label: `Container: ${name}`,
      target: "container",
      section,
      subsection,
      name,
      contentId: getBreadcrumbContentId("container", section, subsection, name),
    });
  }
  if (!isContainer && scope === "field" && name) {
    parts.push({
      label: `Field: ${name}`,
      target: "field",
      section,
      subsection,
      name,
      contentId: getBreadcrumbContentId("field", section, subsection, name),
    });
  }

  if (!parts.length) {
    if (scope === "section") return [{ label: "Section", target: "section" }];
    if (scope === "subsection") {
      return [{ label: "Subsection", target: "subsection" }];
    }
    if (type === "container") {
      return [{ label: "Container", target: "container" }];
    }
    return [{ label: "Field", target: "field" }];
  }

  return parts;
}

function buildBreadcrumbItems() {
  const parts = buildBreadcrumbParts();
  const currentTarget = getBreadcrumbsCurrentTarget();

  return parts.map((part) => {
    if (part.target === currentTarget) {
      return {
        label: part.label,
        target: part.target,
        contentId: part.contentId || "",
        section: part.section || "",
        subsection: part.subsection || "",
        name: part.name || "",
        state: "current",
      };
    }

    return {
      label: part.label,
      target: part.target,
      contentId: part.contentId || "",
      section: part.section || "",
      subsection: part.subsection || "",
      name: part.name || "",
      state: "link",
    };
  });
}

function getBreadcrumbsCurrentTarget() {
  if (activeFieldScope === "section") return "section";
  if (activeFieldScope === "subsection") return "subsection";
  if (activeFieldType === "container") return "container";
  return "field";
}

function renderBreadcrumbs() {
  if (!breadcrumbsEl) return;
  breadcrumbsEl.innerHTML = "";

  const parts = buildBreadcrumbParts();
  const currentTarget = getBreadcrumbsCurrentTarget();
  const { section: sectionName } = getActiveHierarchy();
  const sectionEntry = sectionName ? getSectionEntry(sectionName) : null;
  const sectionHasContent =
    Boolean(sectionEntry?.markdownB64) &&
    sectionEntry.markdownB64.trim() !== "";

  parts.forEach((part, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "mfe-breadcrumb-sep";
      sep.textContent = " > ";
      breadcrumbsEl.appendChild(sep);
    }

    const sectionDisabled = part.target === "section" && !sectionHasContent;
    if (part.target === currentTarget || sectionDisabled) {
      const current = document.createElement("span");
      current.className = sectionDisabled
        ? "mfe-breadcrumb-disabled"
        : "mfe-breadcrumb-current";
      current.textContent = part.label;
      breadcrumbsEl.appendChild(current);
      return;
    }

    const link = document.createElement("button");
    link.type = "button";
    link.className = "mfe-breadcrumb-link";
    link.textContent = part.label;
    link.setAttribute("data-breadcrumb-target", part.target);
    breadcrumbsEl.appendChild(link);
  });

  if (!breadcrumbsEl.dataset.listener) {
    breadcrumbsEl.addEventListener("click", handleBreadcrumbClick);
    breadcrumbsEl.dataset.listener = "1";
  }
}

/**
 * Save editor content
 */
function saveEditorContent(editor = activeEditor) {
  if (!editor) return;

  let markdown = decodeHtmlEntitiesInFences(getMarkdownFromEditor(editor));

  // For single-line fields, strip any extra paragraphs - only save the first block
  if (shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    const blocks = markdown.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    markdown = blocks.length > 0 ? blocks[0] : markdown;
    // single-line fields save only first block
  }

  // Clear highlights when saving
  clearExtraContentHighlights();

  if (saveCallback && editor === primaryEditor) {
    saveCallback(markdown);
  }
}

function saveActiveEditor() {
  if (!activeEditor) return;
  if (activeEditor === secondaryEditor && secondaryLang) {
    const pageId = activeTarget?.getAttribute("data-page") || "";
    const mdName = activeFieldName || "";
    const markdown = decodeHtmlEntitiesInFences(
      getMarkdownFromEditor(activeEditor),
    );
    if (translationsCache) {
      translationsCache[secondaryLang] = markdown;
    }
    saveTranslation(
      pageId,
      mdName,
      secondaryLang,
      markdown,
      activeFieldScope,
      activeFieldSection,
    );
    return;
  }
  saveEditorContent(activeEditor);
}

function closeEditor() {
  closeWindow("mfe-editor");
}

/**
 * Initialize editors for all editable elements
 */
function initEditors() {
  annotateBoundImages();
  document.querySelectorAll(".fe-editable").forEach((el) => {
    if (el.dataset.mfeDblclickBound === "1") return;
    el.addEventListener("dblclick", (e) => {
      // Prevent default browser selection
      e.preventDefault();
      e.stopPropagation();

      const parentEditable = el.parentElement?.closest(".fe-editable");
      const target = e.shiftKey && parentEditable ? parentEditable : el;

      openFullscreenEditorForElement(target);
    });
    el.dataset.mfeDblclickBound = "1";
  });
}

function annotateBoundImages(root = document) {
  annotateEditableImages(root);
  annotateMfeHostImages(root);
  annotateInferredImages(root);
}

function getActiveScopedHtmlKey() {
  return scopedHtmlKeyFromMeta(
    activeFieldScope || "field",
    activeFieldSection || "",
    activeFieldSubsection || "",
    activeFieldName || "",
  );
}

function encodeMarkdownBase64(markdown) {
  const value = markdown || "";
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeMaybeB64(value) {
  if (!value) return "";
  try {
    return decodeMarkdownBase64(value);
  } catch (_e) {
    return "";
  }
}

function getDraftMarkdownForScopedKey(scopeKey) {
  if (!scopeKey) return "";
  const draft = draftMarkdownByScopedKey.get(scopeKey);
  if (typeof draft === "string") return draft;

  if (scopeKey.startsWith("section:")) {
    const sectionName = scopeKey.slice(8);
    return decodeMaybeB64(getSectionEntry(sectionName)?.markdownB64 || "");
  }
  if (scopeKey.startsWith("subsection:")) {
    const parts = scopeKey.split(":");
    const section = parts[1] || "";
    const subsection = parts[2] || "";
    return decodeMaybeB64(
      getSubsectionEntry(section, subsection)?.markdownB64 || "",
    );
  }
  if (scopeKey.startsWith("field:")) {
    const parts = scopeKey.split(":");
    const section = parts.length >= 3 ? parts[1] : "";
    const name = parts.length >= 3 ? parts[2] : parts[1] || "";
    const fields = Array.isArray(window.MarkdownFrontEditorConfig?.fieldsIndex)
      ? window.MarkdownFrontEditorConfig.fieldsIndex
      : [];
    const match = fields.find(
      (f) => (f?.section || "") === section && (f?.name || "") === name,
    );
    return decodeMaybeB64(match?.markdownB64 || "");
  }
  return "";
}

function replaceUniqueBlockInText(documentText, search, replacement) {
  if (!documentText || !search) return null;
  const firstPos = documentText.indexOf(search);
  if (firstPos === -1) return null;
  const secondPos = documentText.indexOf(search, firstPos + search.length);
  if (secondPos !== -1) return null;
  return (
    documentText.slice(0, firstPos) +
    replacement +
    documentText.slice(firstPos + search.length)
  );
}

function propagateDraftToAncestors(oldMarkdown, newMarkdown) {
  if (!oldMarkdown || oldMarkdown === newMarkdown) return;
  const scope = activeFieldScope || "field";
  const section = activeFieldSection || "";
  const subsection = activeFieldSubsection || "";

  if (scope === "field" && section) {
    if (subsection) {
      const subKey = `subsection:${section}:${subsection}`;
      const subDoc = getDraftMarkdownForScopedKey(subKey);
      const updatedSub = replaceUniqueBlockInText(subDoc, oldMarkdown, newMarkdown);
      if (updatedSub !== null) {
        draftMarkdownByScopedKey.set(subKey, updatedSub);
      }
    }
    const sectionKey = `section:${section}`;
    const sectionDoc = getDraftMarkdownForScopedKey(sectionKey);
    const updatedSection = replaceUniqueBlockInText(
      sectionDoc,
      oldMarkdown,
      newMarkdown,
    );
    if (updatedSection !== null) {
      draftMarkdownByScopedKey.set(sectionKey, updatedSection);
    }
    return;
  }

  if (scope === "subsection" && section) {
    const sectionKey = `section:${section}`;
    const sectionDoc = getDraftMarkdownForScopedKey(sectionKey);
    const updatedSection = replaceUniqueBlockInText(
      sectionDoc,
      oldMarkdown,
      newMarkdown,
    );
    if (updatedSection !== null) {
      draftMarkdownByScopedKey.set(sectionKey, updatedSection);
    }
  }
}

function annotateEditableImages(root = document) {
  root.querySelectorAll(".fe-editable").forEach((el) => {
    const scope = getMetaAttr(el, "scope") || "field";
    const section = getMetaAttr(el, "section") || "";
    const subsection = getMetaAttr(el, "subsection") || "";
    const name = getMetaAttr(el, "name") || "";
    const pageId = el.getAttribute("data-page") || "";

    el.querySelectorAll("img").forEach((img) => {
      img.setAttribute("data-mfe-image-bound", "1");
      img.setAttribute("data-mfe-image-scope", scope);
      img.setAttribute("data-mfe-image-section", section);
      img.setAttribute("data-mfe-image-subsection", subsection);
      img.setAttribute("data-mfe-image-name", name);
      img.setAttribute("data-mfe-image-page", pageId);
    });
  });
}

function annotateMfeHostImages(root = document) {
  root.querySelectorAll("[data-mfe]").forEach((host) => {
    const hostValue = host.getAttribute("data-mfe") || "";
    if (!hostValue) return;
    host.querySelectorAll("img").forEach((img) => {
      if (img.getAttribute("data-mfe-image-bound") === "1") return;
      img.setAttribute("data-mfe-image-bound", "1");
      img.setAttribute("data-mfe-image-host", hostValue);
    });
  });
}

function getImageBasename(src) {
  const value = (src || "").split("?")[0].split("#")[0];
  const parts = value.split("/");
  return parts[parts.length - 1] || "";
}

function getImageMatchKey(src) {
  const base = getImageBasename(src).toLowerCase();
  if (!base) return "";
  const extIdx = base.lastIndexOf(".");
  const stem = extIdx > 0 ? base.slice(0, extIdx) : base;
  return stem.replace(/\.\d+x\d+(?:-srcset)?$/i, "");
}

function extractMarkdownImageSrc(markdown) {
  const m = (markdown || "").match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  return m?.[1] || "";
}

function getFieldsIndex() {
  const cfg = window.MarkdownFrontEditorConfig || {};
  return Array.isArray(cfg.fieldsIndex) ? cfg.fieldsIndex : [];
}

function annotateInferredImages(root = document) {
  const fields = getFieldsIndex();
  if (!fields.length) return;

  const imageFields = fields
    .map((f) => {
      const markdown = f?.markdownB64 ? decodeMarkdownBase64(f.markdownB64) : "";
      const src = extractMarkdownImageSrc(markdown);
      const key = getImageMatchKey(src);
      if (!src || !key) return null;
      return {
        scope: "field",
        section: f?.section || "",
        subsection: f?.subsection || "",
        name: f?.name || "",
        key,
      };
    })
    .filter(Boolean);

  if (!imageFields.length) return;

  root.querySelectorAll("img").forEach((img) => {
    if (img.getAttribute("data-mfe-image-bound") === "1") return;
    const key = getImageMatchKey(img.getAttribute("src") || "");
    if (!key) return;
    const matches = imageFields.filter((f) => f.key === key);
    if (matches.length !== 1) return;
    const match = matches[0];
    img.setAttribute("data-mfe-image-bound", "1");
    img.setAttribute("data-mfe-image-scope", match.scope);
    img.setAttribute("data-mfe-image-section", match.section);
    img.setAttribute("data-mfe-image-subsection", match.subsection);
    img.setAttribute("data-mfe-image-name", match.name);
    img.setAttribute("data-mfe-image-inferred", "1");
  });
}

function normalizeHtmlImageSources(html) {
  if (!html || typeof html !== "string") return html || "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (!src) return;
      const resolved = resolveHostImageSrc(document.body, src);
      img.setAttribute("src", resolved);
    });
    return doc.body.innerHTML || html;
  } catch (e) {
    return html;
  }
}

function findSectionNameForSubsection(subName) {
  const sections = window.MarkdownFrontEditorConfig?.sectionsIndex || [];
  for (const section of sections) {
    const subs = Array.isArray(section.subsections) ? section.subsections : [];
    for (const sub of subs) {
      if (sub?.name === subName) return section.name || "";
    }
  }
  return "";
}

async function handleBreadcrumbClick(e) {
  // Find the breadcrumb link element
  const target = e.target?.closest(".mfe-breadcrumb-link");

  if (!target) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  const type = target.getAttribute("data-breadcrumb-target");
  if (!type || !activeTarget) {
    return;
  }

  const index = buildContentIndex();
  const hierarchy = getActiveHierarchy();
  const sectionName =
    target.getAttribute("data-breadcrumb-section") || hierarchy.section || "";
  const subsectionName =
    target.getAttribute("data-breadcrumb-subsection") ||
    hierarchy.subsection ||
    "";
  const fieldName =
    target.getAttribute("data-breadcrumb-name") || hierarchy.name || "";
  let id = target.getAttribute("data-breadcrumb-id") || "";
  if (!id) {
    id = getBreadcrumbContentId(type, sectionName, subsectionName, fieldName);
  }
  const openFromBreadcrumb = (nextTarget) => {
    navigatingViaBreadcrumb = true;
    try {
      openFullscreenEditorForElement(nextTarget);
    } finally {
      navigatingViaBreadcrumb = false;
    }
  };

  const indexed = id ? index.byId.get(id) : null;
  if (indexed?.element) {
    const ok = await keepPendingChangesBeforeSwitch();
    if (!ok) return;
    openFromBreadcrumb(indexed.element);
    return;
  }

  if (indexed?.markdownB64) {
    const virtual = document.createElement("div");
    virtual.className = "fe-editable md-edit mfe-virtual";
    virtual.setAttribute(
      "data-page",
      activeTarget.getAttribute("data-page") || "0",
    );
    virtual.setAttribute("data-md-scope", indexed.scope || type);
    virtual.setAttribute("data-mfe-scope", indexed.scope || type);
    virtual.setAttribute("data-md-name", indexed.name || fieldName);
    virtual.setAttribute("data-mfe-name", indexed.name || fieldName);
    if (indexed.scope === "section") {
      virtual.setAttribute("data-field-type", "container");
    }
    if (indexed.section) {
      virtual.setAttribute("data-md-section", indexed.section);
      virtual.setAttribute("data-mfe-section", indexed.section);
    }
    if (indexed.subsection) {
      virtual.setAttribute("data-md-subsection", indexed.subsection);
      virtual.setAttribute("data-mfe-subsection", indexed.subsection);
    }
    virtual.setAttribute("data-markdown-b64", indexed.markdownB64);
    const ok = await keepPendingChangesBeforeSwitch();
    if (!ok) return;
    openFromBreadcrumb(virtual);
    return;
  }

  if (type === "section") {
    const entry = sectionName ? getSectionEntry(sectionName) : null;
    if (entry) {
      const virtual = document.createElement("div");
      virtual.className = "fe-editable md-edit mfe-virtual";
      virtual.setAttribute(
        "data-page",
        activeTarget.getAttribute("data-page") || "0",
      );
      virtual.setAttribute("data-md-scope", "section");
      virtual.setAttribute("data-mfe-scope", "section");
      virtual.setAttribute("data-md-name", sectionName);
      virtual.setAttribute("data-mfe-name", sectionName);
      virtual.setAttribute("data-field-type", "container");
      virtual.setAttribute("data-markdown-b64", entry.markdownB64 || "");
      const ok = await keepPendingChangesBeforeSwitch();
      if (!ok) return;
      openFromBreadcrumb(virtual);
      return;
    }
  }

  if (type === "subsection") {
    const entry =
      sectionName && subsectionName
        ? getSubsectionEntry(sectionName, subsectionName)
        : null;
    if (entry) {
      const virtual = document.createElement("div");
      virtual.className = "fe-editable md-edit mfe-virtual";
      virtual.setAttribute(
        "data-page",
        activeTarget.getAttribute("data-page") || "0",
      );
      virtual.setAttribute("data-md-scope", "subsection");
      virtual.setAttribute("data-mfe-scope", "subsection");
      virtual.setAttribute("data-md-name", subsectionName);
      virtual.setAttribute("data-mfe-name", subsectionName);
      virtual.setAttribute("data-field-type", "container");
      virtual.setAttribute("data-md-section", sectionName);
      virtual.setAttribute("data-mfe-section", sectionName);
      virtual.setAttribute("data-markdown-b64", entry.markdownB64 || "");
      const ok = await keepPendingChangesBeforeSwitch();
      if (!ok) return;
      openFromBreadcrumb(virtual);
      return;
    }
  }
}

function openFullscreenEditorFromPayload(payload) {
  if (!payload || !payload.element) return;
  const target = payload.element;
  if (activeEditor) {
    suppressNextCloseConfirm = true;
    closeEditor();
  }

  const {
    markdownContent,
    fieldName,
    fieldType,
    fieldScope,
    fieldSection,
    fieldSubsection,
    pageId,
  } = payload;

  const nextFieldId = buildFieldId(
    pageId,
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  const nextScopedKey = scopedHtmlKeyFromMeta(
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  const draftMarkdown = primaryDraftsByFieldId.get(nextFieldId) || null;
  const scopedDraftMarkdown = nextScopedKey
    ? draftMarkdownByScopedKey.get(nextScopedKey) || null
    : null;
  const effectiveMarkdown = scopedDraftMarkdown ?? draftMarkdown ?? markdownContent;
  activeRawMarkdown = effectiveMarkdown;
  activeDisplayMarkdown = effectiveMarkdown;

  activeTarget = target;
  activeFieldName = fieldName;
  activeFieldType = fieldType;
  activeFieldScope = fieldScope;
  activeFieldSection = fieldSection;
  activeFieldSubsection = fieldSubsection;
  activeFieldId = buildFieldId(
    pageId,
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  translationsCache = translationsCacheByFieldId.get(activeFieldId) || null;
  secondaryLang = "";

  const saveCallback = (markdown, resolve, reject) => {
    const finalMarkdown = markdown;
    const currentFieldName = activeFieldName || fieldName;
    const currentFieldScope = activeFieldScope || fieldScope || "field";
    const currentFieldSection = activeFieldSection || fieldSection || "";
    const currentFieldSubsection =
      activeFieldSubsection || fieldSubsection || "";
    const currentPageId =
      activeTarget?.getAttribute("data-page") || pageId || "0";
    fetchCsrfToken().then((csrf) => {
      const { current } = getLanguagesConfig();
      const formData = new FormData();
      formData.append("markdown", finalMarkdown);
      formData.append("mdName", currentFieldName);
      formData.append("mdScope", currentFieldScope);
      if (currentFieldSection) {
        formData.append("mdSection", currentFieldSection);
      }
      if (currentFieldSubsection) {
        formData.append("mdSubsection", currentFieldSubsection);
      }
      formData.append("pageId", currentPageId);
      formData.append("fieldId", activeFieldId);
      if (current) {
        formData.append("lang", current);
      }

      if (csrf) {
        formData.append(csrf.name, csrf.value);
      }

      fetch(getSaveUrl(), {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (data.status) {
            handlePrimarySaveResponse(data, finalMarkdown, {
              updateActiveEditor: true,
            });

            if (resolve) resolve();
          } else {
            alert(`Save failed: ${data.message || "Unknown error"}`);
            if (reject) reject(new Error(data.message || "Save failed"));
          }
        })
        .catch((err) => {
          // save errors are handled by caller
          alert(`Save error: ${err.message}`);
          if (reject) reject(err);
        });
    });
  };

  if (document.body.classList.contains("mfe-view-inline")) {
    const overlay = document.querySelector(".mfe-hover-overlay");
    if (overlay) overlay.style.display = "none";
  }
  try {
    initEditor(activeDisplayMarkdown, saveCallback, fieldType);
  } catch (err) {
    console.error("[mfe] initEditor failed", err);
    return;
  }
  const loadedFromDraft = Boolean(scopedDraftMarkdown || draftMarkdown);
  primaryDirty = loadedFromDraft;
  syncDirtyStatusForActiveField();
  breadcrumbClickHandler = handleBreadcrumbClick;
}

function getPayloadFromElement(target) {
  if (!target) return null;
  const markdownB64 = target.getAttribute("data-markdown-b64");
  const markdownContent = markdownB64 ? decodeMarkdownBase64(markdownB64) : "";
  return {
    element: target,
    markdownContent,
    fieldName: getMetaAttr(target, "name") || "unknown",
    fieldType: target.getAttribute("data-field-type") || "tag",
    fieldScope: getMetaAttr(target, "scope") || "field",
    fieldSection: getMetaAttr(target, "section") || "",
    fieldSubsection: getMetaAttr(target, "subsection") || "",
    pageId: target.getAttribute("data-page") || "0",
  };
}

function replaceActiveEditor(payload) {
  if (!payload || !primaryEditor) return false;

  const {
    markdownContent,
    fieldName,
    fieldType,
    fieldScope,
    fieldSection,
    fieldSubsection,
    pageId,
  } = payload;

  const nextFieldId = buildFieldId(
    pageId,
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  const nextScopedKey = scopedHtmlKeyFromMeta(
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  const draftMarkdown = primaryDraftsByFieldId.get(nextFieldId) || null;
  const scopedDraftMarkdown = nextScopedKey
    ? draftMarkdownByScopedKey.get(nextScopedKey) || null
    : null;
  const effectiveMarkdown = scopedDraftMarkdown ?? draftMarkdown ?? markdownContent;
  activeEditor = primaryEditor;
  activeTarget = payload.element;
  activeFieldName = fieldName;
  activeFieldType = fieldType;
  activeFieldScope = fieldScope;
  activeFieldSection = fieldSection;
  activeFieldSubsection = fieldSubsection;
  activeFieldId = buildFieldId(
    pageId,
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  activeRawMarkdown = effectiveMarkdown;
  activeDisplayMarkdown = effectiveMarkdown;
  translationsCache = translationsCacheByFieldId.get(activeFieldId) || null;
  secondaryLang = "";

  const html = renderMarkdownToHtml(effectiveMarkdown || "");
  runWithoutDirtyTracking(() => {
    primaryEditor.commands.setContent(html, false);
  });
  if (shouldWarnForExtraContent(fieldType, fieldName)) {
    stripTrailingEmptyParagraph(primaryEditor);
  }
  setOriginalBlockCount(primaryEditor, fieldType, fieldName);
  highlightExtraContent(primaryEditor);
  const loadedFromDraft = Boolean(scopedDraftMarkdown || draftMarkdown);
  primaryDirty = loadedFromDraft;
  syncDirtyStatusForActiveField();

  if (secondaryEditor && secondaryLang) {
    setSecondaryLanguage(secondaryLang);
  }

  updateWindowById("mfe-editor", {
    breadcrumbItems: buildBreadcrumbItems(),
    breadcrumbClickHandler: handleBreadcrumbClick,
  });

  setTimeout(() => primaryEditor?.view?.focus(), 0);
  return true;
}

function resolveHostImageSrc(host, src) {
  const value = (src || "").trim();
  if (!value) return value;
  if (value.match(/^(https?:|\/|\?|\/\/)/)) {
    return value;
  }

  const cleanName = value.split("?")[0].split("#")[0].split("/").pop() || value;

  const firstHostImage = host.querySelector("img");
  const currentSrc = firstHostImage?.getAttribute("src") || "";
  const currentPath = currentSrc.split("?")[0].split("#")[0];
  const slashIndex = currentPath.lastIndexOf("/");
  if (slashIndex > -1) {
    const currentDir = currentPath.slice(0, slashIndex + 1);
    if (currentDir) {
      return `${currentDir}${cleanName}`;
    }
  }

  const filesBaseFromConfig = window.MarkdownFrontEditorConfig?.pageFilesBaseUrl;
  const filesBase =
    typeof filesBaseFromConfig === "string" && filesBaseFromConfig.trim() !== ""
      ? (filesBaseFromConfig.endsWith("/") ? filesBaseFromConfig : `${filesBaseFromConfig}/`)
      : "";
  if (filesBase) {
    return `${filesBase}${cleanName}`;
  }

  const fromConfig = window.MarkdownFrontEditorConfig?.imageBaseUrl;
  const base = typeof fromConfig === "string" && fromConfig.trim() !== ""
    ? fromConfig
    : "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${value.replace(/^\/+/, "")}`;
}

export function openFullscreenEditorForElement(target) {
  const payload = getPayloadFromElement(target);
  if (!payload) return;
  updateBreadcrumbAnchorFromPayload(payload);
  const forceNewWindow =
    payload.fieldScope === "section" || payload.fieldScope === "subsection";
  if (forceNewWindow) {
    return openFullscreenEditorFromPayload(payload);
  }
  // If an editor is already open, swap content in place instead of opening a new window
  const hasOpenWindow =
    document.body.classList.contains("mfe-view-fullscreen") &&
    overlayEl &&
    overlayEl.isConnected &&
    primaryEditor;
  if (hasOpenWindow && replaceActiveEditor(payload)) {
    return;
  }
  return openFullscreenEditorFromPayload(payload);
}

/**
 * Public API for ProcessWire module
 */
window.MarkdownFrontEditor = {
  /**
   * Open editor
   * @param {string} markdownContent - Initial markdown
   * @param {function} onSave - Save callback
   * @param {string} fieldType - Field type: "tag" or "container" (default: "tag")
   */
  // Initialize new editor via initEditor (which uses WindowManager)
  edit(markdownContent, onSave, fieldType = "tag") {
    initEditor(markdownContent, onSave, fieldType);
  },

  close() {
    closeEditor();
  },

  getMarkdown() {
    return getMarkdownFromEditor();
  },

  isOpen() {
    return activeEditor !== null;
  },
};

export function initFullscreenEditor() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEditors);
  } else {
    initEditors();
  }
}
