const CONFIG_KEY = "MarkdownFrontEditorConfig";

export const DEFAULT_EMPHASIS_STYLE = "asterisk";
export const DEFAULT_UNORDERED_LIST_MARKER = "*";

function readHostConfigOptional() {
  if (typeof window === "undefined" || !window) return null;
  const cfg = window[CONFIG_KEY];
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null;
  return cfg;
}

export function normalizeEmphasisStyle(value) {
  return String(value || "").toLowerCase() === "underscore"
    ? "underscore"
    : DEFAULT_EMPHASIS_STYLE;
}

export function normalizeUnorderedListMarker(value) {
  const marker = String(value || "").slice(0, 1);
  return marker === "-" || marker === "+" || marker === "*"
    ? marker
    : DEFAULT_UNORDERED_LIST_MARKER;
}

export function getMarkdownStylePreferences() {
  const cfg = readHostConfigOptional();
  return {
    emphasisStyle: normalizeEmphasisStyle(cfg?.defaultEmphasisStyle),
    unorderedListMarker: normalizeUnorderedListMarker(
      cfg?.defaultUnorderedListMarker,
    ),
  };
}

export function getDefaultBoldDelimiter() {
  return getMarkdownStylePreferences().emphasisStyle === "underscore"
    ? "__"
    : "**";
}

export function getDefaultItalicDelimiter() {
  return getMarkdownStylePreferences().emphasisStyle === "underscore"
    ? "_"
    : "*";
}

export function getDefaultUnorderedListMarker() {
  return getMarkdownStylePreferences().unorderedListMarker;
}
