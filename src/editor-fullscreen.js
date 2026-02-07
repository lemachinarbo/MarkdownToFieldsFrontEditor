/**
 * Tiptap-based Markdown Editor for MarkdownToFields
 *
 * Uses Tiptap v.3 with prosemirror-markdown for markdown serialization.
 * This editor provides WYSIWYG editing while preserving markdown integrity.
 */

import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { createToolbarButtons } from "./editor-toolbar.js";
import { renderToolbarButtons } from "./editor-toolbar-renderer.js";
import { createStatusManager } from "./editor-status.js";
import {
  inlineHtmlTags,
  shouldWarnForExtraContent,
  countNonEmptyBlocks,
  createMarkdownParser,
  markdownSerializer,
  decodeMarkdownBase64,
  decodeHtmlEntitiesInFences,
  getLanguagesConfig,
  fetchTranslations,
  saveTranslation,
  getSaveUrl,
  fetchCsrfToken,
  syncComments,
} from "./editor-core.js";
import {
  buildContentIndex,
  getSectionEntry,
  getSubsectionEntry,
} from "./content-index.js";
import { createImagePicker } from "./image-picker.js";
import { openWindow, closeTopWindow, closeWindow } from "./window-manager.js";

let activeEditor = null;
let primaryEditor = null;
let secondaryEditor = null;
let secondaryLang = "";
let translationsCache = null;
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
let activeFieldId = null;
let activeRawMarkdown = null;
let activeDisplayMarkdown = null;
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
  const editor = new Editor({
    element,
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
    highlightExtraContent(editor);
    if (shouldWarnForExtraContent(fieldType, fieldName)) {
      stripTrailingEmptyParagraph(editor);
    }
    if (editor === primaryEditor) {
      primaryDirty = true;
      if (activeFieldId) {
        statusManager.markDirty(activeFieldId);
      }
    }
    if (editor === secondaryEditor && secondaryLang) {
      dirtyTranslations.set(secondaryLang, true);
      translationsCache = translationsCache || {};
      translationsCache[secondaryLang] = getMarkdownFromEditor(editor);
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
  if (primaryEditor && primaryDirty) {
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
    return;
  }

  Promise.all(tasks)
    .then(() => {
      primaryDirty = false;
      if (activeFieldId) {
        statusManager.clearDirty(activeFieldId);
      }
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
  const parser = createMarkdownParser(secondaryEditor.schema);
  const doc = parser.parse(markdown || "");
  secondaryEditor.commands.setContent(doc.toJSON(), false);
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
  const parser = createMarkdownParser(primaryEditor.schema);
  const doc = parser.parse(markdownContent || "");
  primaryEditor.commands.setContent(doc.toJSON(), false);
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
}

/**
 * Open image picker and insert selected image
 */
function openImagePicker(initialData = null) {
  const editor = activeEditor || primaryEditor;
  if (!editor) return;

  createImagePicker({
    initialData,
    onSelect: (imageData) => {
      // imageData is { filename, url, alt }
      const editor = activeEditor || primaryEditor;
      if (!editor) return;

      const { selection } = editor.state;
      const isImageSelected =
        selection.node && selection.node.type.name === "image";

      if (isImageSelected) {
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
function buildBreadcrumbLabel() {
  const scope = activeFieldScope || "field";
  const name = activeFieldName || "Untitled";
  const section =
    activeFieldSection || activeTarget?.getAttribute?.("data-md-section") || "";
  const type = activeFieldType || "tag";

  if (scope === "section") {
    return `Section: ${name}`;
  } else if (scope === "subsection") {
    return `Sub: ${name}`;
  } else if (type === "container") {
    return `Container: ${name}`;
  } else {
    return `Field: ${name}`;
  }
}

function buildBreadcrumbParts() {
  const scope = activeFieldScope || "field";
  const name = activeFieldName || "";
  const sectionFromSubsection =
    scope === "subsection" ? findSectionNameForSubsection(name) : "";
  const section =
    sectionFromSubsection ||
    activeFieldSection ||
    activeTarget?.getAttribute?.("data-md-section") ||
    "";
  const type = activeFieldType || "";
  const isContainer = type === "container";
  const sectionName =
    section || sectionFromSubsection || (scope === "section" ? name : "");

  const parts = [];
  if (sectionName) {
    parts.push({ label: `Section: ${sectionName}`, target: "section" });
  }
  if (scope === "subsection" && name) {
    parts.push({ label: `Sub: ${name}`, target: "subsection" });
  }
  if (isContainer && name) {
    parts.push({ label: `Container: ${name}`, target: "container" });
  }
  if (!isContainer && scope === "field" && name) {
    parts.push({ label: `Field: ${name}`, target: "field" });
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
  const sectionName =
    activeFieldSection ||
    activeTarget?.getAttribute?.("data-md-section") ||
    (activeFieldScope === "section" ? activeFieldName : "") ||
    (activeFieldScope === "subsection"
      ? findSectionNameForSubsection(activeFieldName)
      : "");
  const sectionEntry = sectionName ? getSectionEntry(sectionName) : null;
  const sectionHasContent =
    Boolean(sectionEntry?.markdownB64) &&
    sectionEntry.markdownB64.trim() !== "";

  return parts.map((part) => {
    const sectionDisabled = part.target === "section" && !sectionHasContent;
    if (part.target === currentTarget || sectionDisabled) {
      return {
        label: part.label,
        target: part.target,
        state: sectionDisabled ? "disabled" : "current",
      };
    }

    return {
      label: part.label,
      target: part.target,
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
  const sectionName =
    activeFieldSection ||
    activeTarget?.getAttribute?.("data-md-section") ||
    (activeFieldScope === "section" ? activeFieldName : "") ||
    (activeFieldScope === "subsection"
      ? findSectionNameForSubsection(activeFieldName)
      : "");
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

function createOverlay() {
  // Deprecated, use WindowManager
}

/**
 * Initialize editors for all editable elements
 */
function initEditors() {
  document.querySelectorAll(".fe-editable").forEach((el) => {
    el.addEventListener("dblclick", (e) => {
      // Prevent default browser selection
      e.preventDefault();
      e.stopPropagation();

      const parentEditable = el.parentElement?.closest(".fe-editable");
      const target = e.shiftKey && parentEditable ? parentEditable : el;

      openFullscreenEditorForElement(target);
    });
  });
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

function handleBreadcrumbClick(e) {
  // Find the breadcrumb link element
  const target = e.target?.closest(".mfe-breadcrumb-link");

  console.log("[mfe] breadcrumb click handler called", {
    target,
    hasTarget: !!target,
    activeTarget: !!activeTarget,
    eventTarget: e.target,
    eventTargetClass: e.target?.className,
  });

  if (!target) {
    console.log("[mfe] no target found in handleBreadcrumbClick");
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  const type = target.getAttribute("data-breadcrumb-target");
  console.log("[mfe] breadcrumb type and activeTarget", {
    type,
    activeTarget: !!activeTarget,
  });
  if (!type || !activeTarget) {
    console.log("[mfe] early return: !type or !activeTarget");
    return;
  }

  console.log("[mfe] breadcrumb click", {
    type,
    activeScope: activeFieldScope,
    activeName: activeFieldName,
    activeSection: activeFieldSection,
    activeType: activeFieldType,
  });

  const index = buildContentIndex();
  const sectionName =
    (activeFieldScope === "subsection"
      ? findSectionNameForSubsection(activeFieldName)
      : "") ||
    activeFieldSection ||
    activeTarget.getAttribute("data-md-section") ||
    (activeFieldScope === "section" ? activeFieldName : "");
  const fieldName = activeFieldName || "";
  let id = "";

  if (type === "section") {
    id = sectionName ? `section:${sectionName}` : "";
  } else if (type === "subsection") {
    id =
      sectionName && fieldName ? `subsection:${sectionName}:${fieldName}` : "";
  } else if (type === "container") {
    id = fieldName
      ? `field:${sectionName ? `${sectionName}:` : ""}${fieldName}`
      : "";
  } else if (type === "field") {
    id = fieldName
      ? `field:${sectionName ? `${sectionName}:` : ""}${fieldName}`
      : "";
  }

  const indexed = id ? index.byId.get(id) : null;
  console.log("[mfe] breadcrumb target", {
    id,
    hasElement: Boolean(indexed?.element),
    hasMarkdown: Boolean(indexed?.markdownB64),
    sectionName,
    fieldName,
  });
  if (indexed?.element) {
    openFullscreenEditorForElement(indexed.element);
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
    virtual.setAttribute("data-md-name", indexed.name || fieldName);
    if (indexed.section) {
      virtual.setAttribute("data-md-section", indexed.section);
    }
    virtual.setAttribute("data-markdown-b64", indexed.markdownB64);
    openFullscreenEditorForElement(virtual);
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
      virtual.setAttribute("data-md-name", sectionName);
      virtual.setAttribute("data-markdown-b64", entry.markdownB64 || "");
      openFullscreenEditorForElement(virtual);
      return;
    }
  }

  if (type === "subsection") {
    const entry =
      sectionName && fieldName
        ? getSubsectionEntry(sectionName, fieldName)
        : null;
    if (entry) {
      const virtual = document.createElement("div");
      virtual.className = "fe-editable md-edit mfe-virtual";
      virtual.setAttribute(
        "data-page",
        activeTarget.getAttribute("data-page") || "0",
      );
      virtual.setAttribute("data-md-scope", "subsection");
      virtual.setAttribute("data-md-name", fieldName);
      virtual.setAttribute("data-md-section", sectionName);
      virtual.setAttribute("data-markdown-b64", entry.markdownB64 || "");
      openFullscreenEditorForElement(virtual);
      return;
    }
  }
}

function openFullscreenEditorFromPayload(payload) {
  if (!payload || !payload.element) return;
  const target = payload.element;
  if (activeEditor) {
    closeEditor();
  }

  const {
    markdownContent,
    fieldName,
    fieldType,
    fieldScope,
    fieldSection,
    pageId,
  } = payload;

  activeRawMarkdown = markdownContent;
  activeDisplayMarkdown = markdownContent;
  if (markdownContent.includes("<!--")) {
    activeDisplayMarkdown = markdownContent
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
  }

  activeTarget = target;
  activeFieldName = fieldName;
  activeFieldType = fieldType;
  activeFieldScope = fieldScope;
  activeFieldSection = fieldSection;
  activeFieldId = `${pageId}:${fieldScope}:${fieldSection}:${fieldName}`;

  const saveCallback = (markdown, resolve, reject) => {
    let finalMarkdown = markdown;
    if (
      activeRawMarkdown &&
      activeDisplayMarkdown &&
      activeRawMarkdown !== activeDisplayMarkdown
    ) {
      finalMarkdown = activeRawMarkdown.replace(
        activeDisplayMarkdown,
        markdown,
      );
    }
    fetchCsrfToken().then((csrf) => {
      const formData = new FormData();
      formData.append("markdown", finalMarkdown);
      formData.append("mdName", fieldName);
      formData.append("mdScope", fieldScope || "field");
      if (fieldSection) {
        formData.append("mdSection", fieldSection);
      }
      formData.append("pageId", pageId);
      formData.append("fieldId", activeFieldId);

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
          console.log("[MFE] Save response received:", data);
          if (data.status) {
            // Priority: use htmlMap if available (full page map)
            const htmlMap =
              data.htmlMap || (typeof data.html === "object" ? data.html : {});
            // Fallback for single field update (legacy or direct)
            const primaryHtml =
              typeof data.html === "string"
                ? data.html
                : htmlMap[activeFieldId] || htmlMap[fieldName];

            const markdowns = data.markdowns || {};

            if (data.sectionsIndex) {
              console.log("[MFE] Hydrating global sectionsIndex from response");
              window.MarkdownFrontEditorConfig =
                window.MarkdownFrontEditorConfig || {};
              window.MarkdownFrontEditorConfig.sectionsIndex =
                data.sectionsIndex;
            }

            if (primaryHtml) {
              const srcMatch = primaryHtml.match(
                /<img[^>]+src=["\']([^"\']+)["\']/,
              );
              console.log(
                "[MFE] Received HTML for active field. First img src:",
                srcMatch ? srcMatch[1] : "not found",
              );
            }

            // 1. Update EVERY .fe-editable element on the page
            let matchedCount = 0;
            document.querySelectorAll(".fe-editable").forEach((el) => {
              const elPageId = el.getAttribute("data-page");
              const elName = el.getAttribute("data-md-name");
              const elScope = el.getAttribute("data-md-scope") || "field";
              const elSection = el.getAttribute("data-md-section") || "";
              const elId = `${elPageId}:${elScope}:${elSection}:${elName}`;

              let html =
                htmlMap[elId] ||
                htmlMap[elName] ||
                htmlMap[`${elScope}:${elName}`] ||
                htmlMap[`${elScope}:${elSection}:${elName}`];

              // Fuzzy suffix match
              if (!html) {
                for (const [key, value] of Object.entries(htmlMap)) {
                  if (
                    key &&
                    (elId.endsWith(":" + key) || key.endsWith(":" + elId))
                  ) {
                    console.log(
                      `[MFE] Fuzzy match found: elId='${elId}' matches mapKey='${key}'`,
                    );
                    html = value;
                    break;
                  }
                }
              }

              if (html) {
                console.log(`[MFE] Syncing element: ${elId}`);
                el.innerHTML = html;
                matchedCount++;

                if (markdowns[elId] || markdowns[elName]) {
                  el.dataset.markdown = markdowns[elId] || markdowns[elName];
                }
              }
            });

            // 2. Sync fragments delimited by comment markers (e.g. Subsections)
            const commentCount = syncComments(htmlMap);
            console.log(
              `[MFE] Full-page sync complete. Updated ${matchedCount} elements and ${commentCount} comment blocks.`,
            );

            // 3. Extra safety for active editor
            if (activeTarget && primaryHtml) {
              activeTarget.dataset.markdown = finalMarkdown;

              if (primaryEditor) {
                console.log(
                  "[MFE] Live refreshing active Tiptap editor content",
                );
                const selection = primaryEditor.state.selection;
                primaryEditor.commands.setContent(primaryHtml, false);
                try {
                  primaryEditor.commands.setTextSelection(selection);
                } catch (e) {}
              }
            }

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
  initEditor(activeDisplayMarkdown, saveCallback, fieldType);
  breadcrumbClickHandler = handleBreadcrumbClick;
}

export function openFullscreenEditorForElement(target) {
  if (!target) return;
  const markdownB64 = target.getAttribute("data-markdown-b64");
  const markdownContent = markdownB64 ? decodeMarkdownBase64(markdownB64) : "";
  const payload = {
    element: target,
    markdownContent,
    fieldName: target.getAttribute("data-md-name") || "unknown",
    fieldType: target.getAttribute("data-field-type") || "tag",
    fieldScope: target.getAttribute("data-md-scope") || "field",
    fieldSection: target.getAttribute("data-md-section") || "",
    pageId: target.getAttribute("data-page") || "0",
  };
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
