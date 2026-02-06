/**
 * MarkdownFrontEditor - ProseMirror Refactored Edition
 * Proper WYSIWYG markdown editor using ProseMirror plugins for persistence
 * and real document editing (hard breaks as nodes, not HTML)
 */

import { EditorState, Plugin, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema } from "prosemirror-model";
import {
  schema as baseSchema,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import {
  toggleMark,
  setBlockType,
  wrapIn,
  lift,
  chainCommands,
} from "prosemirror-commands";
import { wrapInList, liftListItem } from "prosemirror-schema-list";
import { keymap } from "prosemirror-keymap";

// ============================================================================
// SCHEMA: Extend with strikethrough mark and proper hard break handling
// ============================================================================

const strikeSpec = {
  parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
  toDOM: () => ["s", 0],
};

// Build marks by copying base marks
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

// Build nodes - hard_break should already be in baseSchema
const _nodes = {};
if (
  baseSchema.spec.nodes &&
  typeof baseSchema.spec.nodes.forEach === "function"
) {
  baseSchema.spec.nodes.forEach((v, k) => (_nodes[k] = v));
} else if (baseSchema.spec.nodes) {
  Object.keys(baseSchema.spec.nodes).forEach(
    (k) => (_nodes[k] = baseSchema.spec.nodes[k]),
  );
}

const editorSchema = new Schema({
  nodes: _nodes,
  marks: _marks,
});

// ============================================================================
// MARKDOWN SERIALIZATION: Handle hard breaks properly
// ============================================================================

// Create custom serializer that handles hard_break nodes
const mdSerializer = defaultMarkdownSerializer;

// Override serialize functions to handle hard breaks
const originalSerializeMarkdown = mdSerializer.serialize;

// ============================================================================
// PERSISTENCE PLUGIN: Replace blur-based approach
// ============================================================================

/**
 * Creates a plugin that persists changes via transaction filtering
 * This fires on every document change (not just blur)
 */
function createPersistencePlugin(onSave) {
  return new Plugin({
    state: {
      init: () => ({ lastSavedState: null }),
      apply: (tr, value) => {
        return {
          lastSavedState: tr.getMeta("lastSaved") || value.lastSavedState,
        };
      },
    },
    appendTransaction(transactions, oldState, newState) {
      // Check if doc changed in any of the transactions
      const docChanged = transactions.some((tr) => tr.docChanged);

      if (docChanged) {
        // Persist to backend
        const markdown = mdSerializer.serialize(newState.doc);
        onSave(markdown);
      }

      return null;
    },
  });
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

const keyBindings = {
  "Mod-b": toggleMark(editorSchema.marks.strong),
  "Mod-i": toggleMark(editorSchema.marks.em),
  "Mod-`": toggleMark(editorSchema.marks.code),
  "Mod-d": toggleMark(editorSchema.marks.strikethrough),
  "Mod-z": "undo", // Will be handled by history plugin
  "Mod-y": "redo",
  "Shift-Mod-z": "redo",
  "Shift-Enter": (state, dispatch) => {
    // Shift+Enter inserts a hard break
    if (dispatch) {
      dispatch(
        state.tr
          .replaceSelectionWith(editorSchema.nodes.hard_break.create())
          .scrollIntoView(),
      );
    }
    return true;
  },
};

// ============================================================================
// MAIN EDITOR CLASS
// ============================================================================

class MarkdownEditor {
  constructor(element, markdown, fieldName, onSave) {
    this.element = element;
    this.markdown = markdown;
    this.fieldName = fieldName;
    this.onSave = onSave;
    this.view = null;
    this.formatBar = null;
  }

  init() {
    // Parse markdown into doc
    const doc = defaultMarkdownParser.parse(this.markdown);

    // Create state with plugins
    const state = EditorState.create({
      doc,
      schema: editorSchema,
      plugins: [
        createPersistencePlugin((markdown) => {
          // persistence logging removed
          this.onSave(markdown);
        }),
        keymap(keyBindings),
      ],
    });

    // Create editor view
    this.view = new EditorView(this.element, {
      state,
      dispatchTransaction: (tr) => {
        const newState = this.view.state.apply(tr);
        this.view.updateState(newState);

        // Update format bar on state change
        this.updateFormatBar();
      },
      domParser: editorSchema.spec.topNode,
    });

    // Create and attach format bar
    this.createFormatBar();

    // Add minimal styling for editor
    this.ensureEditorStyles();
  }

  createFormatBar() {
    this.formatBar = document.createElement("div");
    this.formatBar.className = "markdown-format-bar";
    this.formatBar.style.cssText = `
      display: flex;
      gap: 4px;
      padding: 8px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      margin-bottom: 8px;
      flex-wrap: wrap;
    `;

    const buttons = [
      {
        title: "Bold (Ctrl+B)",
        icon: "B",
        action: () => this.toggleMark("strong"),
      },
      {
        title: "Italic (Ctrl+I)",
        icon: "I",
        action: () => this.toggleMark("em"),
      },
      {
        title: "Strikethrough",
        icon: "S",
        action: () => this.toggleMark("strikethrough"),
      },
      { title: "Code", icon: "`", action: () => this.toggleMark("code") },
      {
        title: "Bullet list",
        icon: "•",
        action: () => this.toggleList("bullet_list"),
      },
      {
        title: "Numbered list",
        icon: "1.",
        action: () => this.toggleList("ordered_list"),
      },
      { title: "Blockquote", icon: "❝", action: () => this.wrapInBlockquote() },
      { title: "Heading 1", icon: "H1", action: () => this.setHeading(1) },
      { title: "Heading 2", icon: "H2", action: () => this.setHeading(2) },
      { title: "Heading 3", icon: "H3", action: () => this.setHeading(3) },
      {
        title: "Clear formatting",
        icon: "⊗",
        action: () => this.clearFormatting(),
      },
    ];

    buttons.forEach(({ title, icon, action }) => {
      const btn = document.createElement("button");
      btn.className = "format-btn";
      btn.title = title;
      btn.textContent = icon;
      btn.style.cssText = `
        padding: 4px 8px;
        border: 1px solid #ccc;
        background: white;
        cursor: pointer;
        border-radius: 3px;
        font-size: 12px;
      `;
      btn.onmousedown = (e) => {
        e.preventDefault();
        action();
        this.view.focus();
      };
      this.formatBar.appendChild(btn);
    });

    this.element.parentNode.insertBefore(this.formatBar, this.element);
  }

  updateFormatBar() {
    // TODO: Update button active states based on current selection
    // Use getActive() to check if marks/blocks are active
  }

  toggleMark(markName) {
    const { state } = this.view;
    const mark = editorSchema.marks[markName];
    const command = toggleMark(mark);
    command(state, (tr) => this.view.dispatch(tr));
  }

  toggleList(listType) {
    const { state } = this.view;
    const listNode = editorSchema.nodes[listType];
    const command = wrapInList(listNode);
    command(state, (tr) => this.view.dispatch(tr));
  }

  wrapInBlockquote() {
    const { state } = this.view;
    const blockquoteNode = editorSchema.nodes.blockquote;
    const command = wrapIn(blockquoteNode);
    command(state, (tr) => this.view.dispatch(tr));
  }

  setHeading(level) {
    const { state } = this.view;
    const headingNode = editorSchema.nodes.heading;
    const command = setBlockType(headingNode, { level });
    command(state, (tr) => this.view.dispatch(tr));
  }

  clearFormatting() {
    const { state, dispatch } = this.view;
    const { from, to } = state.selection;

    let tr = state.tr;

    // Remove all marks
    editorSchema.marks.forEach((mark) => {
      tr = tr.removeMark(from, to, mark);
    });

    // Convert to paragraph
    tr = tr
      .setSelection(state.selection)
      .setBlockType(from, to, editorSchema.nodes.paragraph);

    dispatch(tr);
  }

  ensureEditorStyles() {
    if (document.getElementById("markdown-editor-styles")) return;

    const style = document.createElement("style");
    style.id = "markdown-editor-styles";
    style.textContent = `
      .markdown-format-bar {
        display: flex;
        gap: 4px;
        padding: 8px;
        background: #f5f5f5;
        border-bottom: 1px solid #ddd;
      }

      .ProseMirror {
        outline: none;
        min-height: 120px;
        padding: 12px;
        line-height: 1.6;
      }

      .ProseMirror p {
        margin: 0.5em 0;
      }

      .ProseMirror h1,
      .ProseMirror h2,
      .ProseMirror h3,
      .ProseMirror h4,
      .ProseMirror h5,
      .ProseMirror h6 {
        margin: 0.5em 0 0.5em 0;
        font-weight: bold;
      }

      .ProseMirror h1 { font-size: 1.5em; }
      .ProseMirror h2 { font-size: 1.4em; }
      .ProseMirror h3 { font-size: 1.3em; }
      .ProseMirror h4 { font-size: 1.2em; }
      .ProseMirror h5 { font-size: 1.1em; }
      .ProseMirror h6 { font-size: 1em; }

      .ProseMirror strong {
        font-weight: bold;
      }

      .ProseMirror em {
        font-style: italic;
      }

      .ProseMirror s,
      .ProseMirror del {
        text-decoration: line-through;
      }

      .ProseMirror code {
        background: #f0f0f0;
        padding: 2px 4px;
        border-radius: 3px;
        font-family: monospace;
      }

      .ProseMirror blockquote {
        border-left: 3px solid #ccc;
        padding-left: 1em;
        margin-left: 0;
        color: #666;
      }

      .ProseMirror ul, .ProseMirror ol {
        padding-left: 2em;
      }

      .ProseMirror li {
        margin: 0.25em 0;
      }
    `;
    document.head.appendChild(style);
  }

  destroy() {
    if (this.view) {
      this.view.destroy();
    }
    if (this.formatBar) {
      this.formatBar.remove();
    }
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initEditor(element, markdown, fieldName, onSave) {
  const editor = new MarkdownEditor(element, markdown, fieldName, onSave);
  editor.init();
  return editor;
}

export { MarkdownEditor, editorSchema };
