import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

const MFE_MARKER_LINE_RE = /<!--[\t ]*([^>]+?)[\t ]*-->/g;
const MARKDOWN_IMAGE_RE = /!\[[^\]\n]*\]\([^\)\n]+\)/g;
const MARKDOWN_LINK_RE = /\[[^\]\n]+\]\([^\)\n]+\)/g;

function classifyMarker(markerName) {
  const normalized = String(markerName || "")
    .trim()
    .toLowerCase();
  if (
    normalized.startsWith("section:") ||
    normalized.startsWith("sub:") ||
    normalized.startsWith("subsection:") ||
    normalized.startsWith("container:") ||
    normalized.startsWith("mfe-gap:")
  ) {
    return "structural";
  }
  return "field";
}

function findFrontmatterRange(doc) {
  const text = doc.toString();
  if (
    !text.startsWith("---\n") &&
    text !== "---" &&
    !text.startsWith("---\r\n")
  ) {
    return null;
  }
  const lines = text.split("\n");
  if (lines.length === 0) return null;
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineEnd = offset + line.length;
    if (index > 0 && (line === "---" || line === "...")) {
      return { from: 0, to: lineEnd };
    }
    offset = lineEnd + 1;
  }
  return null;
}

function rangesOverlap(fromA, toA, fromB, toB) {
  return fromA < toB && fromB < toA;
}

function addRegexDecorations({
  builder,
  text,
  lineFrom,
  regex,
  className,
  blockedRanges = [],
}) {
  regex.lastIndex = 0;
  let match = regex.exec(text);
  while (match) {
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    const overlapsBlockedRange = blockedRanges.some((range) =>
      rangesOverlap(from, to, range.from, range.to),
    );
    if (!overlapsBlockedRange) {
      builder.add(from, to, Decoration.mark({ class: className }));
    }
    match = regex.exec(text);
  }
}

function addMarkdownTargetDecorations({
  builder,
  text,
  lineFrom,
  regex,
  className,
  blockedRanges = [],
}) {
  regex.lastIndex = 0;
  let match = regex.exec(text);
  while (match) {
    const fullMatch = String(match[0] || "");
    const openParenIndex = fullMatch.lastIndexOf("(");
    const closeParenIndex = fullMatch.endsWith(")") ? fullMatch.length - 1 : -1;
    if (
      openParenIndex !== -1 &&
      closeParenIndex !== -1 &&
      closeParenIndex > openParenIndex + 1
    ) {
      const from = lineFrom + match.index + openParenIndex + 1;
      const to = lineFrom + match.index + closeParenIndex;
      const overlapsBlockedRange = blockedRanges.some((range) =>
        rangesOverlap(from, to, range.from, range.to),
      );
      if (!overlapsBlockedRange) {
        builder.add(from, to, Decoration.mark({ class: className }));
      }
    }
    match = regex.exec(text);
  }
}

function buildHighlightDecorations(view) {
  const builder = new RangeSetBuilder();
  const frontmatterRange = findFrontmatterRange(view.state.doc);
  if (frontmatterRange) {
    builder.add(
      frontmatterRange.from,
      frontmatterRange.to,
      Decoration.mark({ class: "cm-mfe-frontmatter" }),
    );
  }

  for (
    let lineNumber = 1;
    lineNumber <= view.state.doc.lines;
    lineNumber += 1
  ) {
    const line = view.state.doc.line(lineNumber);
    const text = String(line.text || "");
    const blockedRanges = [];
    MFE_MARKER_LINE_RE.lastIndex = 0;
    let match = MFE_MARKER_LINE_RE.exec(text);
    while (match) {
      const markerName = String(match[1] || "");
      const markerClass =
        classifyMarker(markerName) === "structural"
          ? "cm-mfe-structural-marker"
          : "cm-mfe-field-marker";
      builder.add(
        line.from + match.index,
        line.from + match.index + match[0].length,
        Decoration.mark({ class: markerClass }),
      );
      blockedRanges.push({
        from: line.from + match.index,
        to: line.from + match.index + match[0].length,
      });
      match = MFE_MARKER_LINE_RE.exec(text);
    }

    addMarkdownTargetDecorations({
      builder,
      text,
      lineFrom: line.from,
      regex: MARKDOWN_IMAGE_RE,
      className: "cm-mfe-image-syntax",
      blockedRanges,
    });
    addMarkdownTargetDecorations({
      builder,
      text,
      lineFrom: line.from,
      regex: MARKDOWN_LINK_RE,
      className: "cm-mfe-link-syntax",
      blockedRanges,
    });
  }

  return builder.finish();
}

const mfeHighlightPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildHighlightDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildHighlightDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);

export function createRawMarkdownEditor({
  parent,
  value = "",
  onChange,
  onFocus,
} = {}) {
  if (!parent) {
    throw new Error("[mfe] raw editor: parent element is required");
  }

  let suppressChange = false;
  const state = EditorState.create({
    doc: String(value || ""),
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || suppressChange) return;
        if (typeof onChange === "function") {
          onChange(update.state.doc.toString());
        }
      }),
      EditorView.domEventHandlers({
        focus: () => {
          if (typeof onFocus === "function") onFocus();
        },
      }),
      EditorView.theme({
        "&": {
          height: "auto",
          backgroundColor: "transparent",
        },
        ".cm-scroller": {
          overflow: "visible",
          fontFamily: "inherit",
          lineHeight: "inherit",
        },
        ".cm-content": {
          padding: 0,
          minHeight: "0",
          caretColor: "#0f172a",
        },
        ".cm-line": {
          padding: 0,
        },
        ".cm-focused": {
          outline: "none",
        },
      }),
      mfeHighlightPlugin,
    ],
  });

  const view = new EditorView({
    state,
    parent,
  });

  return {
    dom: view.dom,
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
    getValue() {
      return view.state.doc.toString();
    },
    getSelection() {
      return {
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
      };
    },
    setSelection(from = 0, to = 0) {
      const length = view.state.doc.length;
      const safeFrom = Math.max(0, Math.min(Number(from || 0), length));
      const safeTo = Math.max(0, Math.min(Number(to || 0), length));
      view.dispatch({
        selection: { anchor: safeFrom, head: safeTo },
      });
    },
    setValue(nextValue = "") {
      const valueString = String(nextValue || "");
      if (valueString === view.state.doc.toString()) return;
      suppressChange = true;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: valueString,
        },
      });
      suppressChange = false;
    },
  };
}
