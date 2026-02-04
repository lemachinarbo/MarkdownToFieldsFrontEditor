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

let activeEditor = null;
let activeTarget = null;
let activeFieldName = null;
let activeFieldType = null;
let toolbarEl = null;
let toolbarStatusEl = null;
let toolbarCloseBtn = null;
let keydownHandler = null;
let pointerHandler = null;
let dirty = false;
const originalBlockCounts = new WeakMap();
const originalHtml = new WeakMap();

const EscapeKeyExtension = Extension.create({
  name: "escapeKeyExtension",
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        closeInlineEditor(true);
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
    highlightExtraContent(editor);
    if (shouldWarnForExtraContent(fieldType, fieldName)) {
      stripTrailingEmptyParagraph(editor);
    }
    dirty = true;
  });

  return editor;
}

function setToolbarStatus(message) {
  if (!toolbarStatusEl) return;
  toolbarStatusEl.textContent = message;
  toolbarStatusEl.classList.add("is-visible");
  window.clearTimeout(toolbarStatusEl._timer);
  toolbarStatusEl._timer = window.setTimeout(() => {
    toolbarStatusEl.classList.remove("is-visible");
  }, 2000);
}

function getMarkdownFromEditor(editor = activeEditor) {
  if (!editor) return "";
  return markdownSerializer.serialize(editor.state.doc);
}

function saveInlineEditor() {
  if (!activeEditor || !dirty) {
    return Promise.resolve();
  }

  let markdown = decodeHtmlEntitiesInFences(getMarkdownFromEditor(activeEditor));

  if (shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    const blocks = markdown.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    markdown = blocks.length > 0 ? blocks[0] : markdown;
  }

  const fieldName = activeFieldName || "";
  const pageId = activeTarget?.getAttribute("data-page") || "0";

  return fetchCsrfToken()
    .then((csrf) => {
      const formData = new FormData();
      formData.append("markdown", markdown);
      formData.append("mdName", fieldName);
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
      if (activeTarget && data.html) {
        originalHtml.set(activeTarget, data.html);
      }
      if (activeTarget) {
        activeTarget.dataset.markdown = markdown;
        activeTarget.dataset.markdownB64 = btoa(
          unescape(encodeURIComponent(markdown)),
        );
      }
      dirty = false;
      setToolbarStatus("Saved");
    })
    .catch((err) => {
      console.error("Save error:", err);
      setToolbarStatus("Save failed");
    });
}

function createInlineToolbar() {
  const toolbar = document.createElement("div");
  toolbar.className = "mfe-inline-toolbar";

  const buttons = createToolbarButtons({
    getEditor: () => activeEditor,
    onSave: () => saveInlineEditor(),
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

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "editor-toolbar-btn mfe-inline-close";
  closeBtn.title = "Close (Esc)";
  closeBtn.innerHTML = "×";
  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    closeInlineEditor(true);
  });

  toolbar.appendChild(closeBtn);

  document.body.appendChild(toolbar);
  toolbarEl = toolbar;
  toolbarCloseBtn = closeBtn;
}

async function openInlineEditor(el) {
  if (!el) return;
  if (activeTarget === el && activeEditor) return;

  if (activeEditor) {
    await closeInlineEditor(true);
  }

  const markdownB64 = el.getAttribute("data-markdown-b64");
  const markdownContent = markdownB64 ? decodeMarkdownBase64(markdownB64) : "";
  const fieldName = el.getAttribute("data-md-name") || "unknown";
  const fieldType = el.getAttribute("data-field-type") || "tag";

  activeTarget = el;
  activeFieldName = fieldName;
  activeFieldType = fieldType;

  if (!originalHtml.has(el)) {
    originalHtml.set(el, el.innerHTML);
  }

  el.classList.add("mfe-inline-active");
  el.innerHTML = "";

  const host = document.createElement("div");
  host.className = "mfe-inline-host";
  el.appendChild(host);

  activeEditor = createEditorInstance(host, fieldType, fieldName);

  const parser = createMarkdownParser(activeEditor.schema);
  const doc = parser.parse(markdownContent || "");
  activeEditor.commands.setContent(doc.toJSON(), false);
  if (shouldWarnForExtraContent(fieldType, fieldName)) {
    stripTrailingEmptyParagraph(activeEditor);
  }
  setOriginalBlockCount(activeEditor, fieldType, fieldName);
  highlightExtraContent(activeEditor);
  dirty = false;

  createInlineToolbar();

  const editor = activeEditor;
  setTimeout(() => editor?.view?.focus(), 0);
}

function closeInlineEditor(shouldSave) {
  if (!activeEditor || !activeTarget) return Promise.resolve();

  const target = activeTarget;

  const cleanup = () => {
    if (activeEditor) {
      activeEditor.destroy();
    }
    activeEditor = null;
    activeTarget = null;
    activeFieldName = null;
    activeFieldType = null;
    dirty = false;

    if (toolbarEl) {
      toolbarEl.remove();
    }
    toolbarEl = null;
    toolbarStatusEl = null;
    toolbarCloseBtn = null;

    target.classList.remove("mfe-inline-active");
    const finalHtml = originalHtml.get(target) || "";
    target.innerHTML = finalHtml;
  };

  const savePromise = shouldSave ? saveInlineEditor() : Promise.resolve();
  return savePromise.finally(cleanup);
}

function initInlineEditor() {
  document.body.classList.add("mfe-view-inline");

  document.querySelectorAll(".fe-editable").forEach((el) => {
    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      openInlineEditor(el);
    });
  });

  if (!pointerHandler) {
    pointerHandler = () => {};
  }

  if (!keydownHandler) {
    keydownHandler = (e) => {
      if (e.key === "Escape") {
        closeInlineEditor(true);
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveInlineEditor();
        }
      }
    };
    document.addEventListener("keydown", keydownHandler, true);
  }

}

export { initInlineEditor };
