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
let toolbarEl = null;
let toolbarStatusEl = null;
let toolbarCloseBtn = null;
let keydownHandler = null;
let pointerHandler = null;
let dirty = false;
const originalBlockCounts = new WeakMap();
const originalHtml = new WeakMap();
let activeFieldId = null;
const draftByField = new Map();
const draftMarkdownByField = new Map();
let suppressUpdates = false;
const fieldElements = new Map();

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
  const [pageId, fieldName] = fieldId.split(":");
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
    const [pageId, fieldName] = fieldId.split(":");
    if (!pageId || !fieldName) return;
    if (!grouped.has(pageId)) grouped.set(pageId, {});
    grouped.get(pageId)[fieldName] = markdown;
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
      console.error("Save error:", err);
      if (showStatus) setError();
    });
}

function saveBatch(pageId, fields) {
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
      Object.entries(htmlMap).forEach(([fieldName, html]) => {
        const fieldId = `${pageId}:${fieldName}`;
        const target = fieldElements.get(fieldId);
        if (!target) return;
        if (html) {
          originalHtml.set(target, html);
          target.innerHTML = html;
        }
        const markdown = fields[fieldName];
        if (markdown) {
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

async function openInlineEditor(el) {
  if (!el) return;
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

  const markdownB64 = el.getAttribute("data-markdown-b64");
  const markdownContent = markdownB64 ? decodeMarkdownBase64(markdownB64) : "";
  const fieldName = el.getAttribute("data-md-name") || "unknown";
  const fieldType = el.getAttribute("data-field-type") || "tag";
  const pageId = el.getAttribute("data-page") || "0";

  activeTarget = el;
  activeFieldName = fieldName;
  activeFieldType = fieldType;
  activeFieldId = `${pageId}:${fieldName}`;
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

  document.querySelectorAll(".fe-editable").forEach((el) => {
    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      openInlineEditor(el);
    });
  });

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
