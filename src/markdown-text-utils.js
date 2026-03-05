const LEADING_FRONTMATTER_RE =
  /^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/;

function normalizeLineEndingsToLf(value) {
  return String(value || "").replace(/\r\n|\r/g, "\n");
}

function splitLeadingFrontmatter(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  const match = text.match(LEADING_FRONTMATTER_RE);
  if (!match) {
    return {
      frontmatter: "",
      body: text,
    };
  }
  return {
    frontmatter: match[0],
    body: text.slice(match[0].length),
  };
}

function hasLeadingFrontmatter(markdown) {
  return LEADING_FRONTMATTER_RE.test(
    typeof markdown === "string" ? markdown : "",
  );
}

function hasBareCarriageReturn(value) {
  return /(?:^|[^\n])\r(?!\n)/.test(String(value || ""));
}

function countLeadingLineBreakUnits(value) {
  const text = String(value || "");
  const match = text.match(/^(?:\r\n|\n|\r)+/);
  if (!match) return 0;
  const units = match[0].match(/\r\n|\n|\r/g);
  return Array.isArray(units) ? units.length : 0;
}

function countTrailingLineBreakUnits(value) {
  const text = String(value || "");
  const match = text.match(/(?:\r\n|\n|\r)+$/);
  if (!match) return 0;
  const units = match[0].match(/\r\n|\n|\r/g);
  return Array.isArray(units) ? units.length : 0;
}

function buildNewlineDiagnostics(value) {
  const text = String(value || "");
  const lineBreakUnits = text.match(/\r\n|\n|\r/g);
  return {
    bytes: text.length,
    lineBreakUnits: Array.isArray(lineBreakUnits) ? lineBreakUnits.length : 0,
    leadingLineBreakUnits: countLeadingLineBreakUnits(text),
    trailingLineBreakUnits: countTrailingLineBreakUnits(text),
  };
}

function escapeMarkdownPreview(value) {
  return String(value || "")
    .replace(/\r\n/g, "\\r\\n")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function computeChangedRanges(beforeText, afterText) {
  const before = typeof beforeText === "string" ? beforeText : "";
  const after = typeof afterText === "string" ? afterText : "";
  if (before === after) return [];
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return [
    {
      start,
      endBefore,
      endAfter,
      beforeBytes: Math.max(0, endBefore - start),
      afterBytes: Math.max(0, endAfter - start),
    },
  ];
}

export {
  normalizeLineEndingsToLf,
  splitLeadingFrontmatter,
  hasLeadingFrontmatter,
  hasBareCarriageReturn,
  countLeadingLineBreakUnits,
  countTrailingLineBreakUnits,
  buildNewlineDiagnostics,
  escapeMarkdownPreview,
  computeChangedRanges,
};
