/**
 * Tiptap-based Markdown Editor for MarkdownToFields
 *
 * Uses Tiptap v.3 with prosemirror-markdown for markdown serialization.
 * This editor provides WYSIWYG editing while preserving markdown integrity.
 */

import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";

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

// Configure which fields should show extra-content warnings
// Toggle by field type and/or field name (data-md-name)
const warningFieldTypes = new Set(["heading"]);
const warningFieldNames = new Set(["title", "name"]);

function shouldWarnForExtraContent(fieldType, fieldName) {
  if (fieldType === "container") return false;
  if (warningFieldTypes.size === 0 && warningFieldNames.size === 0)
    return false;
  if (warningFieldTypes.size > 0 && warningFieldNames.size > 0) {
    return warningFieldTypes.has(fieldType) && warningFieldNames.has(fieldName);
  }
  if (warningFieldTypes.size > 0) return warningFieldTypes.has(fieldType);
  return warningFieldNames.has(fieldName);
}

function countNonEmptyBlocks(doc) {
  let count = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (child.textContent.trim().length > 0) {
      count += 1;
    }
  }
  return count;
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
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
      }),
      EscapeKeyExtension,
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

function decodeMarkdownBase64(markdownB64) {
  return decodeURIComponent(
    Array.prototype.map
      .call(atob(markdownB64), (c) =>
        `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`,
      )
      .join(""),
  );
}

function getLanguagesConfig() {
  const cfg = window.MarkdownFrontEditorConfig || {};
  const langs = Array.isArray(cfg.languages) ? cfg.languages : [];
  const current = cfg.currentLanguage || "";
  return { langs, current };
}

function fetchTranslations(mdName, pageId) {
  return fetch(
    `?markdownFrontEditorTranslations=1&mdName=${encodeURIComponent(
      mdName,
    )}&pageId=${encodeURIComponent(pageId)}`,
    { credentials: "same-origin" },
  )
    .then((res) => res.json())
    .then((data) => (data?.status ? data.data : null))
    .catch(() => null);
}

function saveTranslation(pageId, mdName, lang, markdown) {
  return fetchCsrfToken().then((csrf) => {
    const formData = new FormData();
    formData.append("markdown", markdown);
    formData.append("mdName", mdName);
    formData.append("pageId", pageId);
    formData.append("lang", lang);

    if (csrf) {
      formData.append(csrf.name, csrf.value);
    }

    return fetch(getSaveUrl(), {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
  });
}

function setSaveStatus(message) {
  if (!saveStatusEl) return;
  saveStatusEl.textContent = message;
  saveStatusEl.classList.add("is-visible");
  window.clearTimeout(saveStatusEl._timer);
  saveStatusEl._timer = window.setTimeout(() => {
    saveStatusEl.classList.remove("is-visible");
  }, 2000);
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
      tasks.push(saveTranslation(pageId, mdName, lang, markdown));
      dirtyTranslations.set(lang, false);
    }
  }

  if (tasks.length === 0) {
    setSaveStatus("No changes");
    return;
  }

  Promise.all(tasks)
    .then(() => {
      primaryDirty = false;
      setSaveStatus("Saved");
    })
    .catch(() => {
      setSaveStatus("Save failed");
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
    fetchTranslations(mdName, pageId).then((data) => {
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

function createMarkdownParser(schema) {
  const markdownIt = defaultMarkdownParser.tokenizer;
  markdownIt.set({ breaks: true });
  const tokens = {
    ...defaultMarkdownParser.tokens,
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "listItem" },
    bullet_list: {
      block: "bulletList",
      getAttrs: defaultMarkdownParser.tokens.bullet_list?.getAttrs,
    },
    ordered_list: {
      block: "orderedList",
      getAttrs: defaultMarkdownParser.tokens.ordered_list?.getAttrs,
    },
    heading: {
      block: "heading",
      getAttrs: defaultMarkdownParser.tokens.heading?.getAttrs,
    },
    code_block: { block: "codeBlock", noCloseToken: true },
    fence: {
      block: "codeBlock",
      getAttrs: defaultMarkdownParser.tokens.fence?.getAttrs,
      noCloseToken: true,
    },
    hr: { node: "horizontalRule" },
    hardbreak: { node: "hardBreak" },
    softbreak: { node: "hardBreak" },
    em: { mark: "italic" },
    strong: { mark: "bold" },
    link: defaultMarkdownParser.tokens.link,
    image: defaultMarkdownParser.tokens.image,
  };

  if (!schema.nodes.codeBlock) {
    delete tokens.code_block;
    delete tokens.fence;
  }
  if (!schema.nodes.image) {
    delete tokens.image;
  }

  return new MarkdownParser(schema, markdownIt, tokens);
}

const markdownSerializer = new MarkdownSerializer(
  {
    blockquote: defaultMarkdownSerializer.nodes.blockquote,
    codeBlock: defaultMarkdownSerializer.nodes.code_block,
    heading: defaultMarkdownSerializer.nodes.heading,
    horizontalRule: defaultMarkdownSerializer.nodes.horizontal_rule,
    bulletList: defaultMarkdownSerializer.nodes.bullet_list,
    orderedList: defaultMarkdownSerializer.nodes.ordered_list,
    listItem: defaultMarkdownSerializer.nodes.list_item,
    paragraph: defaultMarkdownSerializer.nodes.paragraph,
    image: defaultMarkdownSerializer.nodes.image,
    hardBreak(state) {
      state.write("\n");
    },
    text: defaultMarkdownSerializer.nodes.text,
  },
  {
    ...defaultMarkdownSerializer.marks,
    bold: defaultMarkdownSerializer.marks.strong,
    italic: defaultMarkdownSerializer.marks.em,
    strike: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    code: defaultMarkdownSerializer.marks.code,
  },
  {
    tightLists: true,
  },
);

// Custom extension to handle Escape key
const EscapeKeyExtension = Extension.create({
  name: "escapeKeyExtension",

  addKeyboardShortcuts() {
    return {
      Escape: () => {
        closeEditor();
        return true;
      },
    };
  },
});

/**
 * Initialize the editor for a specific field
 */
function initEditor(markdownContent, onSave, fieldType = "tag") {
  activeFieldType = fieldType;
  saveCallback = onSave;

  // Create overlay (zen mode - full white screen)
  const overlay = document.createElement("div");
  overlay.setAttribute("data-editor-overlay", "true");
  overlay.className = "mfe-overlay";
  document.body.appendChild(overlay);
  document.body.classList.add("mfe-no-scroll");
  overlayEl = overlay;

  // Create container (starts at top, centered)
  const container = document.createElement("div");
  container.setAttribute("data-editor-container", "true");
  container.setAttribute("data-field-type", fieldType); // Add field type as data attribute
  container.className = "mfe-container";
  overlay.appendChild(container);
  editorContainer = container;

  editorShell = document.createElement("div");
  editorShell.className = "mfe-editor-shell";
  container.appendChild(editorShell);

  const primaryPane = document.createElement("div");
  primaryPane.className = "mfe-editor-pane mfe-editor-pane--primary";
  const primaryHeader = document.createElement("div");
  primaryHeader.className = "mfe-editor-pane-header mfe-editor-pane-header--spacer";
  primaryPane.appendChild(primaryHeader);
  editorShell.appendChild(primaryPane);

  // Create primary editor
  primaryEditor = createEditorInstance(
    primaryPane,
    fieldType,
    activeFieldName,
  );
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

  // Create toolbar
  createToolbar(container, overlay);

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Focus editor
  setTimeout(() => primaryEditor.view.focus(), 0);
}

/**
 * Create the toolbar
 */
function createToolbar(container, overlay) {
  const toolbar = document.createElement("div");
  toolbar.id = "editor-toolbar"; // Add ID for easy selection
  toolbar.className = "mfe-toolbar";
  toolbar.setAttribute("data-editor-toolbar", "true");

  const buttons = [
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon" class="size-6">
          <path fill-rule="evenodd" d="M5.246 3.744a.75.75 0 0 1 .75-.75h7.125a4.875 4.875 0 0 1 3.346 8.422 5.25 5.25 0 0 1-2.97 9.58h-7.5a.75.75 0 0 1-.75-.75V3.744Zm7.125 6.75a2.625 2.625 0 0 0 0-5.25H8.246v5.25h4.125Zm-4.125 2.251v6h4.5a3 3 0 0 0 0-6h-4.5Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: () => activeEditor.chain().focus().toggleBold().run(),
      isActive: () => activeEditor.isActive("bold"),
      title: "Bold (Ctrl+B)",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon" class="size-6">
          <path fill-rule="evenodd" d="M10.497 3.744a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-3.275l-5.357 15.002h2.632a.75.75 0 1 1 0 1.5h-7.5a.75.75 0 1 1 0-1.5h3.275l5.357-15.002h-2.632a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: () => activeEditor.chain().focus().toggleItalic().run(),
      isActive: () => activeEditor.isActive("italic"),
      title: "Italic (Ctrl+I)",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon" class="size-6">
          <path fill-rule="evenodd" d="M9.657 4.728c-1.086.385-1.766 1.057-1.979 1.85-.214.8.046 1.733.81 2.616.746.862 1.93 1.612 3.388 2.003.07.019.14.037.21.053h8.163a.75.75 0 0 1 0 1.5h-8.24a.66.66 0 0 1-.02 0H3.75a.75.75 0 0 1 0-1.5h4.78a7.108 7.108 0 0 1-1.175-1.074C6.372 9.042 5.849 7.61 6.229 6.19c.377-1.408 1.528-2.38 2.927-2.876 1.402-.497 3.127-.55 4.855-.086A8.937 8.937 0 0 1 16.94 4.6a.75.75 0 0 1-.881 1.215 7.437 7.437 0 0 0-2.436-1.14c-1.473-.394-2.885-.331-3.966.052Zm6.533 9.632a.75.75 0 0 1 1.03.25c.592.974.846 2.094.55 3.2-.378 1.408-1.529 2.38-2.927 2.876-1.402.497-3.127.55-4.855.087-1.712-.46-3.168-1.354-4.134-2.47a.75.75 0 0 1 1.134-.982c.746.862 1.93 1.612 3.388 2.003 1.473.394 2.884.331 3.966-.052 1.085-.384 1.766-1.056 1.978-1.85.169-.628.046-1.33-.381-2.032a.75.75 0 0 1 .25-1.03Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: () => activeEditor.chain().focus().toggleStrike().run(),
      isActive: () => activeEditor.isActive("strike"),
      title: "Strikethrough",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon">
          <path fill-rule="evenodd" d="M14.447 3.026a.75.75 0 0 1 .527.921l-4.5 16.5a.75.75 0 0 1-1.448-.394l4.5-16.5a.75.75 0 0 1 .921-.527ZM16.72 6.22a.75.75 0 0 1 1.06 0l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06L21.44 12l-4.72-4.72a.75.75 0 0 1 0-1.06Zm-9.44 0a.75.75 0 0 1 0 1.06L2.56 12l4.72 4.72a.75.75 0 0 1-1.06 1.06L.97 12.53a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: () => activeEditor.chain().focus().toggleCode().run(),
      isActive: () => activeEditor.isActive("code"),
      title: "Inline code",
    },
    {
      label: "```",
      action: () => activeEditor.chain().focus().toggleCodeBlock().run(),
      isActive: () => activeEditor.isActive("codeBlock"),
      title: "Code block",
    },
    {
      label: "P",
      action: () => activeEditor.chain().focus().setParagraph().run(),
      isActive: () => activeEditor.isActive("paragraph"),
      title: "Paragraph",
    },
    {
      label: "H1",
      action: () =>
        activeEditor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => activeEditor.isActive("heading", { level: 1 }),
      title: "Heading 1",
    },
    {
      label: "H2",
      action: () =>
        activeEditor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => activeEditor.isActive("heading", { level: 2 }),
      title: "Heading 2",
    },
    {
      label: "H3",
      action: () =>
        activeEditor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: () => activeEditor.isActive("heading", { level: 3 }),
      title: "Heading 3",
    },
    {
      label: "H4",
      action: () =>
        activeEditor.chain().focus().toggleHeading({ level: 4 }).run(),
      isActive: () => activeEditor.isActive("heading", { level: 4 }),
      title: "Heading 4",
    },
    {
      label: "H5",
      action: () =>
        activeEditor.chain().focus().toggleHeading({ level: 5 }).run(),
      isActive: () => activeEditor.isActive("heading", { level: 5 }),
      title: "Heading 5",
    },
    {
      label: "H6",
      action: () =>
        activeEditor.chain().focus().toggleHeading({ level: 6 }).run(),
      isActive: () => activeEditor.isActive("heading", { level: 6 }),
      title: "Heading 6",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M9 6l11 0" /><path d="M9 12l11 0" /><path d="M9 18l11 0" /><path d="M5 6l0 .01" /><path d="M5 12l0 .01" /><path d="M5 18l0 .01" /></svg>
      `,
      action: () => activeEditor.chain().focus().toggleBulletList().run(),
      isActive: () => activeEditor.isActive("bulletList"),
      title: "Bullet list",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M11 6h9" /><path d="M11 12h9" /><path d="M12 18h8" /><path d="M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4" /><path d="M6 10v-6l-2 2" /></svg>
      `,
      action: () => activeEditor.chain().focus().toggleOrderedList().run(),
      isActive: () => activeEditor.isActive("orderedList"),
      title: "Numbered list",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon">
          <path d="M3.75 3.25A.75.75 0 0 0 3 4v16a.75.75 0 0 0 .75.75.75.75 0 0 0 .75-.75V4a.75.75 0 0 0-.75-.75Zm4.5 2A.75.75 0 0 0 7.5 6a.75.75 0 0 0 .75.75h12A.75.75 0 0 0 21 6a.75.75 0 0 0-.75-.75Zm0 6a.75.75 0 0 0-.75.75.75.75 0 0 0 .75.75h12A.75.75 0 0 0 21 12a.75.75 0 0 0-.75-.75Zm0 6a.75.75 0 0 0-.75.75.75.75 0 0 0 .75.75h8.25a.75.75 0 0 0 .75-.75.75.75 0 0 0-.75-.75Z"></path>
        </svg>
      `,
      action: () => activeEditor.chain().focus().toggleBlockquote().run(),
      isActive: () => activeEditor.isActive("blockquote"),
      title: "Blockquote",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" data-slot="icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12a3 3 0 0 1 3-3h4.5a3 3 0 0 1 0 6H12a3 3 0 0 1-3-3Zm6-3a3 3 0 0 1 3-3h1.5a3 3 0 0 1 0 6H18a3 3 0 0 1-3-3Z"></path>
        </svg>
      `,
      action: () => {
        const previousUrl = activeEditor.getAttributes("link").href || "";
        const url = window.prompt("URL", previousUrl);
        if (url === null) return;
        if (url.trim() === "") {
          activeEditor.chain().focus().unsetLink().run();
          return;
        }
        activeEditor
          .chain()
          .focus()
          .extendMarkRange("link")
          .setLink({ href: url })
          .run();
      },
      isActive: () => activeEditor.isActive("link"),
      title: "Link",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" data-slot="icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 13.5 7 17a3 3 0 0 1-4.243-4.243l3.5-3.5M13.5 10.5 17 7a3 3 0 0 1 4.243 4.243l-3.5 3.5M8 8l8 8"></path>
        </svg>
      `,
      action: () => activeEditor.chain().focus().unsetLink().run(),
      isActive: () => false,
      title: "Remove link",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 15l4 4m0 -4l-4 4" /><path d="M7 6v-1h11v1" /><path d="M7 19l4 0" /><path d="M13 5l-4 14" /></svg>
      `,
      action: () =>
        activeEditor.chain().focus().clearNodes().unsetAllMarks().run(),
      isActive: () => false,
      title: "Clear formatting",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-slot="icon" class="size-6">
          <path fill-rule="evenodd" d="M9 2.25a.75.75 0 0 1 .75.75v1.506a49.384 49.384 0 0 1 5.343.371.75.75 0 1 1-.186 1.489c-.66-.083-1.323-.151-1.99-.206a18.67 18.67 0 0 1-2.97 6.323c.318.384.65.753 1 1.107a.75.75 0 0 1-1.07 1.052A18.902 18.902 0 0 1 9 13.687a18.823 18.823 0 0 1-5.656 4.482.75.75 0 0 1-.688-1.333 17.323 17.323 0 0 0 5.396-4.353A18.72 18.72 0 0 1 5.89 8.598a.75.75 0 0 1 1.388-.568A17.21 17.21 0 0 0 9 11.224a17.168 17.168 0 0 0 2.391-5.165 48.04 48.04 0 0 0-8.298.307.75.75 0 0 1-.186-1.489 49.159 49.159 0 0 1 5.343-.371V3A.75.75 0 0 1 9 2.25ZM15.75 9a.75.75 0 0 1 .68.433l5.25 11.25a.75.75 0 1 1-1.36.634l-1.198-2.567h-6.744l-1.198 2.567a.75.75 0 0 1-1.36-.634l5.25-11.25A.75.75 0 0 1 15.75 9Zm-2.672 8.25h5.344l-2.672-5.726-2.672 5.726Z" clip-rule="evenodd"></path>
        </svg>
      `,
      action: () => toggleSplit(),
      isActive: () => false,
      title: "View languages",
    },
    {
      label: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" data-slot="icon" fill="none">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 20.25h12A2.25 2.25 0 0 0 20.25 18V7.5L16.5 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25zm9.75-16.5v5h-9.5v-5zM13 5.5V7m-6.75 4.25h11.5v6.5H6.25Z"></path>
        </svg>
      `,
      action: () => saveAllEditors(),
      isActive: () => false,
      title: "Save changes (Ctrl+S)",
      className: "editor-toolbar-save",
    },
  ];

  const buttonKeys = [
    "bold",
    "italic",
    "strike",
    "code",
    "codeblock",
    "paragraph",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "blockquote",
    "link",
    "unlink",
    "clear",
    "split",
    "save",
  ];

  buttons.forEach((btnDef, index) => {
    if (!btnDef.key) btnDef.key = buttonKeys[index];
  });

  const configButtons =
    window.MarkdownFrontEditorConfig?.toolbarButtons ||
    "bold,italic,strike,paragraph,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,|,link,unlink,|,code,codeblock,clear,split";
  const configOrder = configButtons
    .split(",")
    .map((btn) => btn.trim())
    .filter((btn) => btn.length > 0);
  const buttonMap = new Map(buttons.map((btn) => [btn.key, btn]));
  const orderedItems = configOrder
    .map((key) => {
      if (key === "|") return { type: "separator" };
      if (key === "save") return null;
      const btn = buttonMap.get(key);
      return btn ? { type: "button", btn } : null;
    })
    .filter(Boolean);

  orderedItems.forEach((item) => {
    if (item.type === "separator") {
      const sep = document.createElement("span");
      sep.className = "editor-toolbar-separator";
      toolbar.appendChild(sep);
      return;
    }
    const btnDef = item.btn;
    const btn = document.createElement("button");
    if (btnDef.label.trim().startsWith("<svg")) {
      btn.innerHTML = btnDef.label;
    } else {
      btn.textContent = btnDef.label;
    }
    btn.title = btnDef.title;
    btn.type = "button";
    btn.className = `editor-toolbar-btn${btnDef.className ? ` ${btnDef.className}` : ""}`;

    const updateStyle = () => {
      if (btnDef.isActive()) {
        btn.style.background = "#eef2ff";
        btn.style.color = "#3730a3";
        btn.style.boxShadow = "inset 0 0 0 1px rgba(99, 102, 241, 0.18)";
      } else {
        btn.style.background = "transparent";
        btn.style.color = "#6b7280";
        btn.style.boxShadow = "none";
      }
    };

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      btnDef.action();
      setTimeout(updateStyle, 0);
    });

    btn.addEventListener("mouseenter", () => {
      if (!btnDef.isActive()) {
        btn.style.background = "#f3f4f6";
        btn.style.color = "#374151";
      }
    });

    btn.addEventListener("mouseleave", () => {
      updateStyle();
    });

    activeEditor.on("update", updateStyle);
    activeEditor.on("selectionUpdate", updateStyle);

    updateStyle();
    toolbar.appendChild(btn);
  });

  const spacer = document.createElement("div");
  spacer.className = "editor-toolbar-spacer";
  toolbar.appendChild(spacer);

  const status = document.createElement("div");
  status.className = "editor-toolbar-status";
  status.textContent = "";
  toolbar.appendChild(status);
  saveStatusEl = status;

  const saveBtn = buttons.find((btn) => btn.key === "save");
  if (saveBtn) {
    const btn = document.createElement("button");
    if (saveBtn.label.trim().startsWith("<svg")) {
      btn.innerHTML = saveBtn.label;
    } else {
      btn.textContent = saveBtn.label;
    }
    btn.title = saveBtn.title;
    btn.type = "button";
    btn.className = `editor-toolbar-btn${saveBtn.className ? ` ${saveBtn.className}` : ""}`;

    const updateStyle = () => {
      if (saveBtn.isActive()) {
        btn.style.background = "#eef2ff";
        btn.style.color = "#3730a3";
        btn.style.boxShadow = "inset 0 0 0 1px rgba(99, 102, 241, 0.18)";
      } else {
        btn.style.background = "transparent";
        btn.style.color = "#6b7280";
        btn.style.boxShadow = "none";
      }
    };

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      saveBtn.action();
      setTimeout(updateStyle, 0);
    });

    btn.addEventListener("mouseenter", () => {
      if (!saveBtn.isActive()) {
        btn.style.background = "#f3f4f6";
        btn.style.color = "#374151";
      }
    });

    btn.addEventListener("mouseleave", () => {
      updateStyle();
    });

    activeEditor.on("update", updateStyle);
    activeEditor.on("selectionUpdate", updateStyle);

    updateStyle();
    toolbar.appendChild(btn);
  }

  // Create close button in top right
  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></svg>
  `;
  closeBtn.title = "Close (Esc)";
  closeBtn.type = "button";
  closeBtn.className = "editor-toolbar-btn editor-toolbar-close";

  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeEditor();
  });

  closeBtn.addEventListener("mouseenter", () => {
    closeBtn.style.background = "#f3f4f6";
    closeBtn.style.color = "#374151";
  });

  closeBtn.addEventListener("mouseleave", () => {
    closeBtn.style.background = "transparent";
    closeBtn.style.color = "#6b7280";
  });

  overlay.appendChild(closeBtn);
  overlay.appendChild(toolbar);
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  if (keydownHandler) return;
  const handler = (e) => {
    // Handle Escape without checking activeEditor - always close on Escape
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeEditor();
      return;
    }

    if (!activeEditor) return;

    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "b":
          e.preventDefault();
          activeEditor.chain().focus().toggleBold().run();
          break;
        case "i":
          e.preventDefault();
          activeEditor.chain().focus().toggleItalic().run();
          break;
        case "s":
          e.preventDefault();
          saveAllEditors();
          break;
      }
    }
  };

  document.addEventListener("keydown", handler, true);
  keydownHandler = handler;
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
  console.log(
    "Found blocks:",
    currentBlockCount,
    "Original:",
    originalBlockCount,
    "Field type:",
    activeFieldType,
  );

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
 * Save editor content
 */
function saveEditorContent(editor = activeEditor) {
  if (!editor) return;

  let markdown = getMarkdownFromEditor(editor);

  // For single-line fields, strip any extra paragraphs - only save the first block
  if (shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    const blocks = markdown.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    markdown = blocks.length > 0 ? blocks[0] : markdown;
    console.log(
      "Single-line field: stripped extra paragraphs, saving only first block",
    );
  }

  // Clear highlights when saving
  clearExtraContentHighlights();

  console.log("Saving markdown:", markdown.substring(0, 100) + "...");
  if (saveCallback && editor === primaryEditor) {
    saveCallback(markdown);
  }
}

function saveActiveEditor() {
  if (!activeEditor) return;
  if (activeEditor === secondaryEditor && secondaryLang) {
    const pageId = activeTarget?.getAttribute("data-page") || "";
    const mdName = activeFieldName || "";
    const markdown = getMarkdownFromEditor(activeEditor);
    if (translationsCache) {
      translationsCache[secondaryLang] = markdown;
    }
    saveTranslation(pageId, mdName, secondaryLang, markdown);
    return;
  }
  saveEditorContent(activeEditor);
}

/**
 * Close the editor
 */
function closeEditor() {
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

  // Remove editor container
  const container = document.querySelector("[data-editor-container]");
  if (container) {
    container.remove();
  }

  // Remove overlay and all its contents
  const overlay = document.querySelector("[data-editor-overlay]");
  if (overlay) {
    overlay.remove();
  }

  // Fallback: remove any remaining editor elements
  document
    .querySelectorAll("[data-editor-overlay], [data-editor-container]")
    .forEach((el) => el.remove());

  document.body.classList.remove("mfe-no-scroll");

  saveCallback = null;
  activeTarget = null;
  activeFieldName = null;
  activeFieldType = null;
  translationsCache = null;
  secondaryLang = "";
  editorShell = null;
  editorContainer = null;
  overlayEl = null;
  splitPane = null;
}

function getSaveUrl() {
  return "?markdownFrontEditorSave=1";
}

async function fetchCsrfToken() {
  try {
    const response = await fetch("?markdownFrontEditorToken=1", {
      method: "GET",
      credentials: "same-origin",
    });
    const html = await response.text();
    const match = html.match(
      /name=["\']?([^"\'\s]+)["\']?[^>]*value=["\']?([^"\'>]+)/,
    );
    if (match && match.length > 2) {
      return { name: match[1], value: match[2] };
    }
  } catch (err) {
    console.error("Failed to fetch CSRF token:", err);
  }
  return null;
}

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-editor-overlay", "true");
  overlay.className = "mfe-backdrop";
  overlay.addEventListener("click", closeEditor);
  document.body.appendChild(overlay);
}

/**
 * Initialize editors for all editable elements
 */
function initEditors() {
  document.querySelectorAll(".fe-editable").forEach((el) => {
    el.addEventListener("dblclick", (e) => {
      // Prevent default browser selection
      e.preventDefault();

      // Get markdown from data attribute (set by backend)
      const markdownB64 = el.getAttribute("data-markdown-b64");
      const markdownContent = markdownB64 ? decodeMarkdownBase64(markdownB64) : "";
      const fieldName = el.getAttribute("data-md-name") || "unknown";
      const fieldType = el.getAttribute("data-field-type") || "tag"; // Field type from backend

      activeTarget = el;
      activeFieldName = fieldName;
      activeFieldType = fieldType;

      // Save callback
      const saveCallback = (markdown, resolve, reject) => {
        fetchCsrfToken().then((csrf) => {
          const formData = new FormData();
          formData.append("markdown", markdown);
          formData.append("mdName", fieldName);
          formData.append("pageId", el.getAttribute("data-page") || "0");

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
                if (activeTarget) {
                  activeTarget.dataset.markdown = markdown;
                  if (data.html) {
                    activeTarget.innerHTML = data.html;
                  }
                }
                if (resolve) resolve();
              } else {
                alert(`Save failed: ${data.message || "Unknown error"}`);
                if (reject) reject(new Error(data.message || "Save failed"));
              }
            })
            .catch((err) => {
              console.error("Save error:", err);
              alert(`Save error: ${err.message}`);
              if (reject) reject(err);
            });
        });
      };

      // Open editor with overlay
      if (activeEditor) {
        closeEditor();
      }
      createOverlay();
      initEditor(markdownContent, saveCallback, fieldType);
    });
  });
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
  edit(markdownContent, onSave, fieldType = "tag") {
    // Close existing editor
    if (activeEditor) {
      closeEditor();
    }

    // Initialize new editor with overlay
    createOverlay();
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

/**
 * Initialize on DOM ready
 */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initEditors);
} else {
  initEditors();
}

console.log("MarkdownFrontEditor loaded");
