/**
 * MarkdownFrontEditor - ProseMirror Markdown Edition
 * Inline WYSIWYG editor with detached toolbar and unsaved changes protection
 */

import { EditorState, Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema } from "prosemirror-model";
import {
  schema as baseSchema,
  defaultMarkdownParser,
} from "prosemirror-markdown";

// Extend the base schema with a strikethrough mark so the UI can toggle it
const strikeSpec = {
  parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
  toDOM: () => ["s", 0],
};

// Build marks object by copying base marks (supports OrderedMap or plain object)
const _marks = {};
if (
  baseSchema.spec.marks &&
  typeof baseSchema.spec.marks.forEach === "function"
) {
  baseSchema.spec.marks.forEach((v, k) => (_marks[k] = v));
} else if (baseSchema.spec.marks) {
  Object.keys(baseSchema.spec.marks).forEach(
    (k) => (_marks[k] = baseSchema.spec.marks[k]),
  );
}
_marks.strikethrough = strikeSpec;
const editorSchema = new Schema({
  nodes: baseSchema.spec.nodes,
  marks: _marks,
});
import { exampleSetup } from "prosemirror-example-setup";
import { keymap } from "prosemirror-keymap";
import { toggleMark, setBlockType, wrapIn, lift } from "prosemirror-commands";
import { wrapInList, liftListItem } from "prosemirror-schema-list";

const EDITABLE_CLASS = "fe-editable";

let activeEditor = null;
let activeHost = null;
let activeTarget = null;
let activeMarkdown = null;
let activeFieldName = null;
let activeFullMarkdown = null;
let isSaving = false;
let hasUnsavedChanges = false;
let outsideClickHandler = null;
let formatBarEl = null;
let formatBarInitialized = false;
let repositionHandler = null;
let keydownHandler = null;

function ensureEditorStyles() {
  if (document.getElementById("fe-editor-styles")) return;
  const style = document.createElement("style");
  style.id = "fe-editor-styles";
  style.textContent = `
    .fe-editor-host {
      padding: 0 !important;
      margin: 0 !important;
    }
    .fe-editor-host .ProseMirror {
      outline: none !important;
      border: none !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    .fe-editor-host .ProseMirror:focus {
      outline: none !important;
      border: none !important;
    }
    .fe-editor-host .ProseMirror h1,
    .fe-editor-host .ProseMirror h2,
    .fe-editor-host .ProseMirror h3,
    .fe-editor-host .ProseMirror h4,
    .fe-editor-host .ProseMirror h5,
    .fe-editor-host .ProseMirror h6,
    .fe-editor-host .ProseMirror p {
      margin: 0;
      font-size: 1em !important;
      font-weight: normal !important;
      line-height: 1.5 !important;
    }
    .fe-editor-host .ProseMirror h1 {
      font-weight: bold !important;
      font-size: 1.5em !important;
    }
    .fe-editor-host .ProseMirror h2 {
      font-weight: bold !important;
      font-size: 1.4em !important;
    }
    .fe-editor-host .ProseMirror h3 {
      font-weight: bold !important;
      font-size: 1.3em !important;
    }
    .fe-editor-host .ProseMirror h4 {
      font-weight: bold !important;
      font-size: 1.2em !important;
    }
    .fe-editor-host .ProseMirror h5 {
      font-weight: bold !important;
      font-size: 1.1em !important;
    }
    .fe-editor-host .ProseMirror h6 {
      font-weight: bold !important;
      font-size: 1em !important;
    }
    .fe-editor-host .ProseMirror ul,
    .fe-editor-host .ProseMirror ol {
      margin: 0;
      padding-left: 1.2em;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Check if field allows multi-block content
 */
function allowMultiBlockFor(el) {
  if (!el || !el.dataset) return false;
  const value = el.dataset.allowMultiBlock;
  return value === "true" || value === "1";
}

/**
 * Get field metadata from element
 */
function getFieldMeta(el) {
  if (!el || !el.dataset) return null;
  return {
    name: el.dataset.mdName || "",
    type: (el.dataset.fieldType || "block").toLowerCase(),
    allowMultiBlock: allowMultiBlockFor(el),
    pageId: el.dataset.page || "",
  };
}

/**
 * Create ProseMirror editor inline
 */
function createEditor(element, markdownContent, meta, savedRect) {
  ensureEditorStyles();

  const host = document.createElement("div");
  host.className = "fe-editor-host";
  if (meta.type) {
    host.classList.add(`fe-type-${meta.type}`);
  }

  const rect = savedRect || element.getBoundingClientRect();
  const minHeight = Math.max(48, Math.round(rect.height));
  const isSingleBlock = !meta.allowMultiBlock;

  // Use exact width from original element to prevent layout jumps
  const width = Math.round(rect.width);

  // Get styles from the actual content element (H1, P, etc.), not the wrapper
  const contentElement =
    element.querySelector("h1, h2, h3, h4, h5, h6, p, div") || element;
  const computed = window.getComputedStyle(contentElement);

  // Also get wrapper's computed styles for margins
  const wrapperComputed = window.getComputedStyle(element);

  // Overlay editor on top of original element - invisible, feels like editing the original
  host.style.position = "absolute";
  host.style.top = "0";
  host.style.left = "0";
  host.style.width = "100%";
  host.style.boxSizing = "border-box";
  host.style.minHeight = "100%";
  host.style.height = "100%";
  host.style.border = "none";
  host.style.background = "#fff";
  host.style.padding = "0";
  host.style.margin = "0";
  host.style.zIndex = "1000";

  // Inherit ALL typography from the actual content element for perfect WYSIWYG
  host.style.fontFamily =
    computed.fontFamily ||
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  host.style.fontSize = computed.fontSize || "14px";
  host.style.fontWeight = computed.fontWeight || "400";
  host.style.lineHeight = computed.lineHeight || "1.6";
  host.style.letterSpacing = computed.letterSpacing || "normal";
  host.style.textTransform = computed.textTransform || "none";
  host.style.color = computed.color || "#111";

  // No padding on host - ProseMirror and content handle their own spacing
  host.style.padding = "0";

  // Make element position:relative so it becomes the positioning context for the overlaid editor
  element.style.position = "relative";

  // Append editor as child of element (overlays it) to preserve document flow
  element.appendChild(host);

  // Don't hide original content - the editor's white background will cover it
  // This ensures the original content maintains layout and the editor overlays perfectly

  const doc = defaultMarkdownParser.parse(markdownContent || "");

  const customKeymap = {};
  if (!meta.allowMultiBlock) {
    customKeymap["Enter"] = () => true;
    customKeymap["Shift-Enter"] = () => true;
    customKeymap["Ctrl-Enter"] = () => true;
  }

  const singleBlockGuard = new Plugin({
    filterTransaction(tr, state) {
      if (meta.allowMultiBlock) return true;

      const doc = tr.doc || state.doc;
      if (doc.childCount > 1) return false;

      let hasHardBreak = false;
      doc.descendants((node) => {
        if (node.type && node.type.name === "hard_break") {
          hasHardBreak = true;
          return false;
        }
        return true;
      });
      if (hasHardBreak) return false;

      return true;
    },
  });

  const changePlugin = new Plugin({
    state: {
      init() {
        return false;
      },
      apply(tr) {
        if (tr.getMeta("addToHistory") !== false) {
          hasUnsavedChanges = true;
          return true;
        }
        return false;
      },
    },
  });

  const formatBarPlugin = new Plugin({
    view(editorView) {
      return {
        update(view, prevState) {
          if (
            view.state.selection.from !== prevState.selection.from ||
            view.state.selection.to !== prevState.selection.to
          ) {
            updateFormatBar(view);
          }
        },
      };
    },
  });

  const state = EditorState.create({
    doc,
    schema: editorSchema,
    plugins: [
      ...exampleSetup({ schema: editorSchema }),
      keymap(customKeymap),
      singleBlockGuard,
      changePlugin,
      formatBarPlugin,
    ],
  });

  const view = new EditorView(host, {
    state,
    handlePaste(view, event) {
      if (!meta.allowMultiBlock) {
        const text = event.clipboardData?.getData("text/plain") || "";
        if (text.includes("\n")) {
          event.preventDefault();
          return true;
        }
      }
      return false;
    },
  });

  const pmMenubar = host.querySelector(".ProseMirror-menubar");
  if (pmMenubar) {
    pmMenubar.remove();
  }

  const pmEditor = host.querySelector(".ProseMirror");
  if (pmEditor) {
    pmEditor.style.outline = "none";
    pmEditor.style.overflow = "visible";
    if (isSingleBlock) {
      pmEditor.style.height = "100%";
      pmEditor.style.minHeight = "100%";
      pmEditor.style.display = "flex";
      pmEditor.style.alignItems = "center";
    } else {
      pmEditor.style.minHeight = `${minHeight - 16}px`;
    }
  }

  return { view, host };
}

/**
 * Check if two nodes have the same inline marks
 */
function nodesHaveSameMarks(node1, node2) {
  let marksMatch = true;

  // Walk through both nodes' children to compare marks
  if (node1.childCount !== node2.childCount) return false;

  node1.forEach((child1, offset, index) => {
    if (!marksMatch) return;
    const child2 = node2.maybeChild(index);
    if (!child2) {
      marksMatch = false;
      return;
    }

    if (child1.isText && child2.isText) {
      if (child1.text !== child2.text) {
        marksMatch = false;
        return;
      }
      // Compare marks
      const marks1 = child1.marks || [];
      const marks2 = child2.marks || [];
      if (marks1.length !== marks2.length) {
        marksMatch = false;
        return;
      }
      for (let i = 0; i < marks1.length; i++) {
        if (marks1[i].type.name !== marks2[i].type.name) {
          marksMatch = false;
          return;
        }
      }
    } else if (child1.type.name !== child2.type.name) {
      marksMatch = false;
      return;
    }
  });

  return marksMatch;
}

/**
 * Get markdown content from active editor
 */
function getMarkdownContent() {
  if (!activeEditor) return null;

  // If content hasn't changed, return original markdown to preserve formatting
  const currentDoc = activeEditor.view.state.doc;
  const originalDoc = defaultMarkdownParser.parse(activeMarkdown || "");

  console.log("getMarkdownContent: Comparing docs...");
  console.log("  Original markdown:", activeMarkdown);
  console.log("  Current doc childCount:", currentDoc.childCount);
  console.log("  Original doc childCount:", originalDoc.childCount);

  // Deep check: compare doc structure and inline marks
  if (currentDoc.childCount === originalDoc.childCount) {
    let docsMatch = true;
    currentDoc.forEach((node, offset, index) => {
      if (docsMatch) {
        const origNode = originalDoc.maybeChild(index);
        if (
          !origNode ||
          node.type !== origNode.type ||
          node.textContent !== origNode.textContent
        ) {
          console.log(`  Mismatch at index ${index}:`, {
            currentType: node.type.name,
            origType: origNode?.type.name,
            currentText: node.textContent,
            origText: origNode?.textContent,
          });
          docsMatch = false;
        } else {
          // For headings, also check if level changed
          if (
            node.type.name === "heading" &&
            node.attrs.level !== origNode.attrs.level
          ) {
            console.log(
              `  Heading level difference at index ${index}: ${node.attrs.level} vs ${origNode.attrs.level}`,
            );
            docsMatch = false;
          }
          // Text content matches, but check if inline marks differ
          else if (!nodesHaveSameMarks(node, origNode)) {
            console.log(`  Mark difference at index ${index}`);
            docsMatch = false;
          }
        }
      }
    });

    if (docsMatch) {
      console.log(
        "✓ Content unchanged - returning original markdown (preserves HTML)",
      );
      return activeMarkdown; // Return original to preserve HTML and formatting
    }
  }

  console.log("✗ Content changed - serializing to markdown");

  // Content has changed, serialize to markdown
  const doc = activeEditor.view.state.doc;
  const lines = [];

  doc.forEach((node) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level || 1;
      const hashes = "#".repeat(level);
      const text = serializeInlineContent(node);
      lines.push(`${hashes} ${text}`);
    } else if (node.type.name === "paragraph") {
      const text = serializeInlineContent(node);
      lines.push(text);
    } else if (
      node.type.name === "bullet_list" ||
      node.type.name === "ordered_list"
    ) {
      node.forEach((item) => {
        const indent = node.type.name === "ordered_list" ? "1. " : "- ";
        const text = serializeInlineContent(item);
        lines.push(indent + text);
      });
    } else if (node.type.name === "blockquote") {
      node.textContent.split("\n").forEach((line) => {
        lines.push("> " + line);
      });
    } else if (node.type.name === "code_block") {
      lines.push("```");
      lines.push(node.textContent);
      lines.push("```");
    } else if (node.type.name === "horizontal_rule") {
      lines.push("---");
    } else if (node.textContent) {
      const text = serializeInlineContent(node);
      lines.push(text);
    }
  });

  const result = lines.join("\n\n");
  console.log("  Serialized result:", result);
  return result;
}

/**
 * Serialize inline content with marks (bold, italic, strikethrough)
 */
function serializeInlineContent(node) {
  let result = "";

  node.forEach((child) => {
    if (child.isText) {
      let text = child.text;
      const marks = child.marks;

      // Apply marks in a consistent order: strikethrough, bold, italic
      const hasStrike = marks.some((m) => m.type.name === "strikethrough");
      const hasBold = marks.some((m) => m.type.name === "strong");
      const hasItalic = marks.some((m) => m.type.name === "em");
      const hasCode = marks.some((m) => m.type.name === "code");

      if (hasCode) {
        text = "`" + text + "`";
      }
      if (hasItalic) {
        text = "*" + text + "*";
      }
      if (hasBold) {
        text = "**" + text + "**";
      }
      if (hasStrike) {
        text = "~~" + text + "~~";
      }

      result += text;
    } else if (child.type.name === "hard_break") {
      result += " <br> ";
    }
  });

  return result;
}

function isMarkActive(state, markType) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!markType.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, markType);
}

import { TextSelection } from "prosemirror-state";

function isNodeActive(state, nodeType) {
  const { $from } = state.selection;
  for (let i = $from.depth; i > 0; i--) {
    if ($from.node(i).type === nodeType) return true;
  }
  return false;
}

function selectWordUnderCursor(view) {
  if (!view) return false;
  const { state, dispatch } = view;
  if (!state.selection.empty) return true;

  const { $from } = state.selection;
  const parent = $from.parent;
  if (!parent || !parent.textContent) return false;

  const offsetInParent = $from.parentOffset;
  const text = parent.textContent;
  // Find word boundaries using simple regex (letters, numbers, underscore)
  const left = text.slice(0, offsetInParent).search(/[^A-Za-z0-9_]*$/);
  const rightRel = text.slice(offsetInParent).search(/[^A-Za-z0-9_]/);
  const wordStart = left === -1 ? 0 : left;
  const wordEnd = rightRel === -1 ? text.length : offsetInParent + rightRel;

  const start = $from.start() + wordStart;
  const end = $from.start() + wordEnd;

  if (start >= end) return false;

  const tr = state.tr.setSelection(TextSelection.create(state.doc, start, end));
  dispatch(tr);
  return true;
}

function runCommand(view, command) {
  if (!command) return false;
  const result = command(view.state, view.dispatch, view);
  if (result) view.focus();
  return result;
}

function createFormatBar() {
  // Only create once globally
  if (formatBarInitialized) return;
  formatBarInitialized = true;

  const bar = document.createElement("div");
  bar.className = "fe-format-bar";
  bar.style.position = "fixed";
  bar.style.zIndex = "10001";
  bar.style.background = "#fff";
  bar.style.border = "1px solid #e5e7eb";
  bar.style.borderRadius = "10px";
  bar.style.padding = "8px 6px";
  bar.style.display = "flex";
  bar.style.top = "20px";
  bar.style.left = "50%";
  bar.style.transform = "translateX(-50%)";
  bar.style.alignItems = "center";
  bar.style.gap = "2px";
  bar.style.boxShadow = "0 10px 40px rgba(0,0,0,0.16), 0 0 1px rgba(0,0,0,0.1)";
  bar.style.opacity = "0";
  bar.style.pointerEvents = "none";
  bar.style.transition = "opacity 0.15s ease-out";
  bar.style.willChange = "opacity";
  bar.style.visibility = "hidden";

  const makeButton = (label, title, onClick) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("type", "button");
    btn.style.border = "none";
    btn.style.background = "transparent";
    btn.style.padding = "6px 8px";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    btn.style.fontSize = "13px";
    btn.style.lineHeight = "1";
    btn.style.transition = "background-color 0.15s ease, color 0.15s ease";
    btn.style.userSelect = "none";
    btn.style.WebkitUserSelect = "none";
    // Run the command on mousedown to avoid losing the editor selection on click
    btn.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        // Ensure editor keeps focus so its selection is available
        if (
          activeEditor &&
          activeEditor.view &&
          typeof activeEditor.view.focus === "function"
        ) {
          activeEditor.view.focus();
        }
        onClick(e);
      } catch (err) {
        console.error("FormatBar button error:", err);
      }
    };
    // Prevent default click behavior (we handle actions on mousedown)
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Hover effect
    btn.addEventListener("mouseenter", () => {
      if (!btn.classList.contains("active")) {
        btn.style.background = "rgba(0,0,0,0.05)";
      }
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.classList.contains("active")) {
        btn.style.background = "transparent";
      }
    });

    return btn;
  };

  const blockSelect = document.createElement("select");
  blockSelect.className = "fe-block-select";
  blockSelect.setAttribute("type", "button");
  blockSelect.style.fontSize = "12px";
  blockSelect.style.border = "1px solid #e5e7eb";
  blockSelect.style.borderRadius = "6px";
  blockSelect.style.padding = "5px 8px";
  blockSelect.style.background = "#fff";
  blockSelect.style.cursor = "pointer";
  blockSelect.style.transition =
    "border-color 0.15s ease, background-color 0.15s ease";
  blockSelect.style.height = "32px";
  blockSelect.style.outline = "none";
  blockSelect.onmousedown = (e) => {
    e.stopPropagation();
  };

  blockSelect.addEventListener("mouseenter", () => {
    blockSelect.style.borderColor = "#d1d5db";
  });
  blockSelect.addEventListener("mouseleave", () => {
    blockSelect.style.borderColor = "#e5e7eb";
  });

  [
    { value: "paragraph", label: "Paragraph" },
    { value: "h1", label: "Heading 1" },
    { value: "h2", label: "Heading 2" },
    { value: "h3", label: "Heading 3" },
    { value: "h4", label: "Heading 4" },
    { value: "h5", label: "Heading 5" },
    { value: "h6", label: "Heading 6" },
  ].forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    blockSelect.appendChild(option);
  });

  blockSelect.onchange = () => {
    if (!activeEditor) return;
    const view = activeEditor.view;
    const nodes = view.state.schema.nodes;
    const value = blockSelect.value;
    const { $from } = view.state.selection;

    // Get parent node to check if we're in blockquote or list
    let parentNode = null;
    let parentDepth = null;
    for (let i = $from.depth; i > 0; i--) {
      const node = $from.node(i);
      if (
        node.type.name === "blockquote" ||
        node.type.name === "bullet_list" ||
        node.type.name === "ordered_list"
      ) {
        parentNode = node;
        parentDepth = i;
        break;
      }
    }

    if (value === "paragraph") {
      // If inside blockquote or list, lift first, then set to paragraph
      if (parentNode) {
        if (parentNode.type.name === "blockquote") {
          runCommand(view, lift);
        } else if (
          parentNode.type.name === "bullet_list" ||
          parentNode.type.name === "ordered_list"
        ) {
          runCommand(view, liftListItem(nodes.list_item));
        }
      }
      runCommand(view, setBlockType(nodes.paragraph));
    } else if (value.startsWith("h")) {
      const level = parseInt(value.replace("h", ""), 10);
      // If inside blockquote or list, lift first
      if (parentNode) {
        if (parentNode.type.name === "blockquote") {
          runCommand(view, lift);
        } else if (
          parentNode.type.name === "bullet_list" ||
          parentNode.type.name === "ordered_list"
        ) {
          runCommand(view, liftListItem(nodes.list_item));
        }
      }
      runCommand(view, setBlockType(nodes.heading, { level }));
    }
    // Ensure the format bar reflects the new state
    updateFormatBar(view);
    // Persist changes to frontend
    persistChangesToFrontend();
  };

  const boldBtn = makeButton("B", "Bold (Ctrl+B)", () => {
    if (!activeEditor) return;
    const view = activeEditor.view;
    const markType = view.state.schema.marks.strong;
    console.log("FormatBar: Bold clicked", { markType: !!markType });
    if (!markType) return;
    // If there's no selection, select the current word first so the mark applies
    if (view.state.selection.empty) selectWordUnderCursor(view);
    runCommand(view, toggleMark(markType));
    updateFormatBar(view);
  });
  boldBtn.style.fontWeight = "700";

  const italicBtn = makeButton("I", "Italic (Ctrl+I)", () => {
    if (!activeEditor) return;
    const view = activeEditor.view;
    const markType = view.state.schema.marks.em;
    console.log("FormatBar: Italic clicked", { markType: !!markType });
    if (!markType) return;
    if (view.state.selection.empty) selectWordUnderCursor(view);
    runCommand(view, toggleMark(markType));
    updateFormatBar(view);
  });
  italicBtn.style.fontStyle = "italic";

  const strikeBtn = makeButton("S", "Strikethrough", () => {
    if (!activeEditor) return;
    const view = activeEditor.view;
    const markType = view.state.schema.marks.strikethrough;
    console.log("FormatBar: Strike clicked", { markType: !!markType });
    if (!markType) return;
    if (view.state.selection.empty) selectWordUnderCursor(view);
    runCommand(view, toggleMark(markType));
    updateFormatBar(view);
  });
  strikeBtn.style.textDecoration = "line-through";
  // Hide if not available in the runtime schema
  // (show/hide will be handled in updateFormatBar)

  const ulBtn = makeButton("•", "Bullet list", () => {
    if (!activeEditor) return;
    const view = activeEditor.view;
    const nodes = view.state.schema.nodes;
    const isActive = isNodeActive(view.state, nodes.bullet_list);
    console.log("FormatBar: Bullet list clicked", { isActive });
    if (isActive) {
      runCommand(view, liftListItem(nodes.list_item));
    } else {
      runCommand(view, wrapInList(nodes.bullet_list));
    }
    updateFormatBar(view);
  });

  const olBtn = makeButton("1.", "Numbered list", () => {
    if (!activeEditor) return;
    const view = activeEditor.view;
    const nodes = view.state.schema.nodes;
    const isActive = isNodeActive(view.state, nodes.ordered_list);
    console.log("FormatBar: Ordered list clicked", { isActive });
    if (isActive) {
      runCommand(view, liftListItem(nodes.list_item));
    } else {
      runCommand(view, wrapInList(nodes.ordered_list));
    }
    updateFormatBar(view);
  });

  const quoteBtn = makeButton("❝", "Blockquote", () => {
    if (!activeEditor) return;
    const nodes = activeEditor.view.state.schema.nodes;
    console.log("FormatBar: Quote clicked");
    runCommand(activeEditor.view, wrapIn(nodes.blockquote));
    updateFormatBar(activeEditor.view);
  });

  const clearBtn = makeButton("⊗", "Clear formatting", () => {
    if (!activeEditor) return;
    const view = activeEditor.view;
    const schema = view.state.schema;
    let { from, to } = view.state.selection;

    if (from === to) {
      // No selection, select current word
      selectWordUnderCursor(view);
      from = view.state.selection.from;
      to = view.state.selection.to;
    }

    // Remove all marks using a transaction
    let tr = view.state.tr;

    // Remove all marks from the selection
    schema.marks.strong && tr.removeMark(from, to, schema.marks.strong);
    schema.marks.em && tr.removeMark(from, to, schema.marks.em);
    schema.marks.strikethrough &&
      tr.removeMark(from, to, schema.marks.strikethrough);
    schema.marks.code && tr.removeMark(from, to, schema.marks.code);
    schema.marks.link && tr.removeMark(from, to, schema.marks.link);

    // Set block to paragraph and lift from blockquote/list
    const nodes = schema.nodes;
    const { $from } = view.state.selection;

    // Check if we're inside a blockquote or list
    let parentNode = null;
    for (let i = $from.depth; i > 0; i--) {
      const node = $from.node(i);
      if (
        node.type.name === "blockquote" ||
        node.type.name === "bullet_list" ||
        node.type.name === "ordered_list"
      ) {
        parentNode = node;
        break;
      }
    }

    // Dispatch the transaction with mark removal
    view.dispatch(tr);

    // Lift out of blockquote/list and set to paragraph
    if (parentNode) {
      if (parentNode.type.name === "blockquote") {
        runCommand(view, lift);
      } else if (
        parentNode.type.name === "bullet_list" ||
        parentNode.type.name === "ordered_list"
      ) {
        runCommand(view, liftListItem(nodes.list_item));
      }
    }
    runCommand(view, setBlockType(nodes.paragraph));

    updateFormatBar(view);
  });
  clearBtn.title = "Clear formatting";

  // Add separator line
  const separator = document.createElement("div");
  separator.style.width = "1px";
  separator.style.height = "20px";
  separator.style.background = "#e5e7eb";
  separator.style.margin = "0 4px";

  const saveBtn = makeButton("💾", "Save changes (Ctrl+S)", () => {
    if (!activeEditor) return;
    saveContent();
  });
  saveBtn.style.border = "1px solid #3b82f6";
  saveBtn.style.background = "#3b82f6";
  saveBtn.style.color = "#fff";
  saveBtn.style.fontWeight = "500";
  saveBtn.style.fontSize = "14px";
  saveBtn.addEventListener("mouseenter", () => {
    saveBtn.style.background = "#2563eb";
    saveBtn.style.borderColor = "#2563eb";
  });
  saveBtn.addEventListener("mouseleave", () => {
    saveBtn.style.background = "#3b82f6";
    saveBtn.style.borderColor = "#3b82f6";
  });

  bar.appendChild(blockSelect);
  bar.appendChild(boldBtn);
  bar.appendChild(italicBtn);
  bar.appendChild(strikeBtn);
  bar.appendChild(ulBtn);
  bar.appendChild(olBtn);
  bar.appendChild(quoteBtn);
  bar.appendChild(clearBtn);
  bar.appendChild(separator);
  bar.appendChild(saveBtn);

  document.body.appendChild(bar);
  formatBarEl = bar;

  // Add styles for active state
  if (!document.getElementById("fe-format-bar-styles")) {
    const style = document.createElement("style");
    style.id = "fe-format-bar-styles";
    style.textContent = `
        .fe-format-bar button.active {
          background: #dbeafe !important;
          color: #1e40af;
        }
        .fe-format-bar button.active:hover {
          background: #bfdbfe !important;
        }
      `;
    document.head.appendChild(style);
  }
}

function updateFormatBar(view) {
  if (!formatBarEl || !view) return;

  const state = view.state;
  const schema = state.schema;
  const boldActive =
    schema.marks.strong && isMarkActive(state, schema.marks.strong);
  const italicActive = schema.marks.em && isMarkActive(state, schema.marks.em);
  const strikeActive =
    schema.marks.strikethrough &&
    isMarkActive(state, schema.marks.strikethrough);

  const buttons = formatBarEl.querySelectorAll("button");
  buttons.forEach((btn) => {
    btn.classList.remove("active");
    if (btn.textContent === "💾") return; // Skip save button
    btn.style.background = "transparent";
    btn.style.color = "inherit";
  });

  if (boldActive) {
    if (buttons[0]) buttons[0].classList.add("active");
  }
  if (italicActive) {
    if (buttons[1]) buttons[1].classList.add("active");
  }
  if (strikeActive) {
    if (buttons[2]) buttons[2].classList.add("active");
  }

  // Show/hide strikethrough button depending on runtime schema
  const strikeBtnEl = formatBarEl.querySelector(
    'button[title="Strikethrough"]',
  );
  if (strikeBtnEl) {
    if (
      state.schema &&
      state.schema.marks &&
      state.schema.marks.strikethrough
    ) {
      strikeBtnEl.style.display = "";
    } else {
      strikeBtnEl.style.display = "none";
    }
  }

  const select = formatBarEl.querySelector(".fe-block-select");
  if (select) {
    const nodes = state.schema.nodes;
    const { $from } = state.selection;

    // Walk up the tree to find the actual block type (heading, paragraph, list_item, etc.)
    let blockType = "paragraph";
    for (let i = $from.depth; i > 0; i--) {
      const node = $from.node(i);
      if (node.type === nodes.heading) {
        const level = node.attrs.level || 1;
        blockType = `h${level}`;
        break;
      } else if (node.type === nodes.paragraph) {
        blockType = "paragraph";
        break;
      } else if (node.type === nodes.list_item) {
        // For list items, check what's inside
        const firstChild = node.firstChild;
        if (firstChild && firstChild.type === nodes.heading) {
          const level = firstChild.attrs.level || 1;
          blockType = `h${level}`;
        } else {
          blockType = "paragraph";
        }
        break;
      }
    }

    select.value = blockType;
  }

  showFormatBar();
}

function showFormatBar() {
  if (!formatBarEl) return;
  formatBarEl.style.visibility = "visible";
  formatBarEl.style.opacity = "1";
  formatBarEl.style.pointerEvents = "auto";
}

function hideFormatBar() {
  if (!formatBarEl) return;
  formatBarEl.style.opacity = "0";
  formatBarEl.style.pointerEvents = "none";
  setTimeout(() => {
    formatBarEl.style.visibility = "hidden";
  }, 150);
}

function getSaveUrl() {
  return `?markdownFrontEditorSave=1`;
}

/**
 * Persist unsaved changes to the frontend DOM
 * Updates the original element with current editor content
 * Does NOT save to backend - just updates the display
 */
function persistChangesToFrontend() {
  if (!activeEditor || !activeTarget) return;

  const markdown = getMarkdownContent();
  if (!markdown) return;

  // Update the original element's data attribute
  activeTarget.dataset.markdown = markdown;
  activeMarkdown = markdown;

  // Prefer using the editor's actual DOM output (preserves marks like <s>, <strong>, <em>)
  const pmEditor = activeHost && activeHost.querySelector(".ProseMirror");
  if (pmEditor) {
    activeTarget.innerHTML = pmEditor.innerHTML;
  } else {
    // Fallback to markdown-based conversion
    const displayHtml = markdownToHtml(markdown);
    activeTarget.innerHTML = displayHtml;
  }

  // Mark as unsaved
  activeTarget.dataset.unsavedChanges = "true";
}

function markdownToHtml(markdown) {
  // Simple conversion - just for display purposes
  // This is a basic implementation; ideally use a markdown parser
  let html = markdown
    .replace(/^### (.*?)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*?)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*?)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/~~(.*?)~~/g, "<del>$1</del>")
    .replace(/\n/g, "<br>");

  return html;
}

async function fetchCsrfToken() {
  try {
    const response = await fetch("?markdownFrontEditorToken=1", {
      method: "GET",
      credentials: "same-origin",
    });
    const html = await response.text();
    // Extract the CSRF field from the hidden input
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

function saveContent() {
  if (!activeEditor || isSaving) return;

  const markdown = getMarkdownContent();
  if (!markdown) {
    alert("No content to save");
    return;
  }

  console.log("saveContent: Saving...", { markdown, field: activeFieldName });

  isSaving = true;

  // First fetch CSRF token, then save
  fetchCsrfToken().then((csrf) => {
    const formData = new FormData();
    formData.append("markdown", markdown);
    formData.append("mdName", activeFieldName);
    formData.append("pageId", activeEditor.meta.pageId);

    if (csrf) {
      formData.append(csrf.name, csrf.value);
    }

    console.log("saveContent: Posting to backend...");

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
        console.log("saveContent: Response:", data);
        if (data.status) {
          if (activeTarget) {
            activeTarget.dataset.markdown = markdown;
          }
          activeMarkdown = markdown;
          hasUnsavedChanges = false;
          if (activeTarget && data.html) {
            activeTarget.innerHTML = data.html;
          }
        } else {
          alert(`Save failed: ${data.message || "Unknown error"}`);
        }
      })
      .catch((err) => {
        console.error("Save error:", err);
        alert(`Save error: ${err.message}`);
      })
      .finally(() => {
        isSaving = false;
      });
  });
}

function destroyEditor(force = false) {
  if (activeEditor) {
    activeEditor.view.destroy();
    activeEditor = null;
  }
  if (activeHost) {
    activeHost.remove();
    activeHost = null;
  }
  if (activeTarget) {
    // Restore position (we didn't hide anything, just set position:relative)
    activeTarget.style.position = "";
    activeTarget = null;
  }
  // Hide format bar instead of removing it (it's global now)
  hideFormatBar();
  if (outsideClickHandler) {
    document.removeEventListener("mousedown", outsideClickHandler, true);
    outsideClickHandler = null;
  }
  if (repositionHandler) {
    window.removeEventListener("scroll", repositionHandler, true);
    window.removeEventListener("resize", repositionHandler, true);
    repositionHandler = null;
  }
  if (keydownHandler) {
    document.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  }
  hasUnsavedChanges = false;
  activeMarkdown = null;
}

function attachTo(element) {
  if (activeEditor) {
    // If editor already open, close it first
    if (activeHost) {
      activeHost.style.display = "none";
    }
    if (formatBarEl) {
      formatBarEl.style.display = "none";
    }
    activeEditor = null;
    activeHost = null;
  }

  const meta = getFieldMeta(element);
  if (!meta || !meta.name) return;

  // Ensure format bar exists globally (create once on first edit)
  if (!formatBarEl) {
    createFormatBar();
  }

  // Don't hide the element - keep it in DOM for layout flow
  // The editor will overlay it via absolute positioning
  activeTarget = element;
  activeFieldName = meta.name;

  let markdown = element.dataset.markdown || "";
  markdown = markdown.replace(/\\n/g, "\n");
  markdown = markdown.replace(/\\r/g, "\r");
  markdown = markdown.replace(/\\t/g, "\t");

  activeMarkdown = markdown;
  activeFullMarkdown = element.dataset.fullMarkdown || markdown;

  const { view, host } = createEditor(element, markdown, meta);
  activeEditor = { view, meta };
  activeHost = host;

  // Show the editor and format bar
  if (activeHost) {
    activeHost.style.display = "block";
  }
  if (formatBarEl) {
    formatBarEl.style.display = "flex";
  }

  updateFormatBar(view);
  view.focus();

  repositionHandler = () => {
    if (activeEditor && activeEditor.view) {
      updateFormatBar(activeEditor.view);
    }
  };
  window.addEventListener("scroll", repositionHandler, true);
  window.addEventListener("resize", repositionHandler, true);

  outsideClickHandler = (event) => {
    if (!activeHost) return;
    const inEditor = activeHost.contains(event.target);
    const inFormat = formatBarEl && formatBarEl.contains(event.target);
    if (!inEditor && !inFormat) {
      // On blur: persist changes and hide editor, but don't destroy
      // This preserves the changes on screen (WYSIWYG behavior)
      persistChangesToFrontend();

      // Hide the editor overlay but keep it in the DOM
      if (activeHost) {
        activeHost.style.display = "none";
      }

      // Hide format bar
      if (formatBarEl) {
        formatBarEl.style.display = "none";
      }

      // Clear active references so a new edit can start
      activeEditor = null;
      activeHost = null;
    }
  };
  document.addEventListener("mousedown", outsideClickHandler, true);

  keydownHandler = (e) => {
    if (e.key === "Escape") {
      // On Escape: persist changes and hide editor, but keep data
      if (activeEditor) {
        persistChangesToFrontend();

        // Hide the editor overlay
        if (activeHost) {
          activeHost.style.display = "none";
        }

        // Hide format bar
        if (formatBarEl) {
          formatBarEl.style.display = "none";
        }

        // Clear active references
        activeEditor = null;
        activeHost = null;
      }
    }
  };
  document.addEventListener("keydown", keydownHandler);
}

function init() {
  document.querySelectorAll(`.${EDITABLE_CLASS}`).forEach((el) => {
    el.addEventListener("dblclick", (e) => {
      // If we're already editing this element, don't reattach (prevents losing a selection on double-click)
      if (activeEditor && activeTarget === el) {
        // If the editor host contains the event target, focus the editor and allow native selection
        if (activeHost && activeHost.contains(e.target)) {
          if (activeEditor.view) activeEditor.view.focus();
          return;
        }
      }
      attachTo(el);
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
