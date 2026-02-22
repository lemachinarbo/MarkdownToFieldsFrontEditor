import {
  shouldWarnForExtraContent,
  countNonEmptyBlocks,
  serializeMarkdownDoc,
  trimTrailingLineBreaks,
} from "./editor-core.js";

export function getMetaAttr(el, name) {
  if (!el) return "";
  return (
    el.getAttribute(`data-mfe-${name}`) ||
    el.getAttribute(`data-md-${name}`) ||
    ""
  );
}

export function getImageBaseUrl() {
  const fromConfig = window.MarkdownFrontEditorConfig?.imageBaseUrl;
  const base =
    typeof fromConfig === "string" && fromConfig.trim() !== ""
      ? fromConfig
      : "/";
  return base.endsWith("/") ? base : `${base}/`;
}

export function setOriginalBlockCount(
  editor,
  fieldType,
  fieldName,
  originalBlockCounts,
) {
  const count = shouldWarnForExtraContent(fieldType, fieldName)
    ? 1
    : countNonEmptyBlocks(editor.state.doc);
  originalBlockCounts.set(editor, count);
}

export function getOriginalBlockCount(editor, originalBlockCounts) {
  return originalBlockCounts.get(editor) || 0;
}

export function applyFieldAttributes(editor, fieldType, fieldName) {
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

export function stripTrailingEmptyParagraph(editor) {
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

export function getMarkdownFromEditor(editor) {
  if (!editor) return "";
  return trimTrailingLineBreaks(serializeMarkdownDoc(editor.state.doc));
}

export const MFE_MARKER_LINE_RE =
  /^[\t ]*<!--\s*[a-zA-Z0-9_:.\/-]+\s*-->[\t ]*(?:\r?\n|$)/gm;

export function stripMfeMarkersForFieldScope(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  return text.replace(MFE_MARKER_LINE_RE, "");
}
