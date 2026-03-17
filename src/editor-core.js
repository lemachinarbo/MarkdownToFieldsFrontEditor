import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import { isHostDevMode } from "./host-env.js";
import {
  getDefaultBoldDelimiter,
  getDefaultItalicDelimiter,
  getDefaultUnorderedListMarker,
} from "./markdown-style-preferences.js";
import { request } from "./network.js";

/**
 * CRITICAL: Each parser/serializer instance MUST be fresh and isolated.
 * Never mutate shared instances. Markdown source must be immutable.
 */

const warningFieldTypes = new Set(["heading"]);
const warningFieldNames = new Set(["title", "name"]);

export const inlineHtmlTags = [
  "br",
  "strong",
  "em",
  "span",
  "a",
  "i",
  "u",
  "s",
  "del",
  "sub",
  "sup",
];

const MFE_MARKER_LINE_RE = /^[\t ]*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->[\t ]*$/;
const MFE_GAP_COMMENT_RE = /^[\t ]*<!--\s*mfe-gap:(\d+)\s*-->[\t ]*$/;

function isBlankLine(line) {
  return String(line || "").trim() === "";
}

function parseGapLineCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.max(1, Math.floor(parsed));
}

function isReservedGapMarkerName(name) {
  return /^mfe-gap:\d+$/i.test(String(name || "").trim());
}

function encodeMarkerBoundaryGapsForParser(markdown) {
  const source = typeof markdown === "string" ? markdown : "";
  if (!source.includes("<!--")) return source;

  const lines = source.split("\n");
  if (lines.length < 3) return source;

  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = String(lines[index] || "");
    output.push(currentLine);

    const markerMatch = currentLine.match(MFE_MARKER_LINE_RE);
    if (!markerMatch) {
      continue;
    }
    if (isReservedGapMarkerName(markerMatch[1])) {
      continue;
    }

    let scan = index + 1;
    while (scan < lines.length && isBlankLine(lines[scan])) {
      scan += 1;
    }

    const blankLineCount = scan - (index + 1);
    if (blankLineCount < 1 || scan >= lines.length) {
      continue;
    }

    const nextLine = String(lines[scan] || "");
    if (!MFE_MARKER_LINE_RE.test(nextLine)) {
      continue;
    }

    output.push(`<!-- mfe-gap:${blankLineCount} -->`);
    index += blankLineCount;
  }

  return output.join("\n");
}

function decodeGapSentinelComments(markdown) {
  const source = typeof markdown === "string" ? markdown : "";
  if (!source.includes("mfe-gap:")) return source;

  const lines = source.split("\n");
  const output = [];
  for (const line of lines) {
    const match = String(line || "").match(MFE_GAP_COMMENT_RE);
    if (!match) {
      output.push(line);
      continue;
    }
    const gapLineCount = parseGapLineCount(match[1]);
    for (let i = 0; i < gapLineCount; i += 1) {
      output.push("");
    }
  }
  return output.join("\n");
}

export function trimTrailingLineBreaks(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  return text.replace(/(?:\r?\n)+$/, "");
}

export function shouldWarnForExtraContent(fieldType, fieldName) {
  if (fieldType === "container") return false;
  if (warningFieldNames.size > 0 && warningFieldNames.has(fieldName)) {
    return true;
  }
  if (warningFieldTypes.size > 0 && warningFieldTypes.has(fieldType)) {
    return true;
  }
  return false;
}

export function countNonEmptyBlocks(doc) {
  let count = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (child.textContent.trim().length > 0) {
      count += 1;
    }
  }
  return count;
}

export function countSignificantTopLevelBlocks(doc) {
  let count = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    const isEmptyParagraph =
      child?.type?.name === "paragraph" &&
      child.textContent.trim().length === 0;
    if (isEmptyParagraph) continue;
    count += 1;
  }
  return count;
}

/**
 * Create a fresh, isolated markdown-it instance for editing.
 * NEVER mutates the global defaultMarkdownParser.tokenizer.
 *
 * Configuration:
 * - html: false → HTML tags are literal text, not parsed as elements
 * - breaks: false → Single newlines are NOT converted to breaks
 *
 * This enforces source immutability: markdown is read-only unless explicitly edited.
 */
function createFreshMarkdownItInstance() {
  // Clone the default tokenizer to get a fresh instance with all built-in rules
  const base = defaultMarkdownParser.tokenizer;
  const md = base.clone ? base.clone() : base;

  // Configure for source preservation
  md.set({ html: false, breaks: false });
  md.enable("strikethrough");
  md.enable("table");
  md.disable(["reference"], true);

  return md;
}

function findMatchingTokenIndex(tokens, startIndex, openType, closeType) {
  let depth = 0;
  for (let i = startIndex; i < tokens.length; i += 1) {
    if (tokens[i].type === openType) depth += 1;
    if (tokens[i].type === closeType) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripTaskPrefixFromInlineToken(inlineToken, checkboxPattern) {
  if (!inlineToken || typeof inlineToken.content !== "string") return false;
  if (!checkboxPattern.test(inlineToken.content)) return false;

  inlineToken.content = inlineToken.content.replace(checkboxPattern, "");

  if (Array.isArray(inlineToken.children)) {
    for (const child of inlineToken.children) {
      if (child?.type !== "text" || typeof child.content !== "string") continue;
      if (checkboxPattern.test(child.content)) {
        child.content = child.content.replace(checkboxPattern, "");
      }
      break;
    }
  }

  return true;
}

function promoteTaskListTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return;
  const checkboxPattern = /^\[([ xX])\]\s+/;

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "bullet_list_open") continue;

    const listCloseIndex = findMatchingTokenIndex(
      tokens,
      i,
      "bullet_list_open",
      "bullet_list_close",
    );
    if (listCloseIndex <= i) continue;

    const candidateItems = [];
    let allItemsAreTaskItems = true;

    for (let j = i + 1; j < listCloseIndex; j += 1) {
      if (tokens[j].type !== "list_item_open") continue;

      const itemCloseIndex = findMatchingTokenIndex(
        tokens,
        j,
        "list_item_open",
        "list_item_close",
      );
      if (itemCloseIndex <= j || itemCloseIndex > listCloseIndex) {
        allItemsAreTaskItems = false;
        break;
      }

      let inlineIndex = -1;
      for (let k = j + 1; k < itemCloseIndex; k += 1) {
        if (tokens[k].type === "inline") {
          inlineIndex = k;
          break;
        }
      }

      if (inlineIndex === -1) {
        allItemsAreTaskItems = false;
        break;
      }

      const match = String(tokens[inlineIndex].content || "").match(
        checkboxPattern,
      );
      if (!match) {
        allItemsAreTaskItems = false;
        break;
      }

      candidateItems.push({
        openIndex: j,
        closeIndex: itemCloseIndex,
        inlineIndex,
        checked: String(match[1] || " ").toLowerCase() === "x",
      });
      j = itemCloseIndex;
    }

    if (!allItemsAreTaskItems || candidateItems.length === 0) continue;

    tokens[i].type = "task_list_open";
    tokens[listCloseIndex].type = "task_list_close";

    for (const item of candidateItems) {
      tokens[item.openIndex].type = "task_list_item_open";
      tokens[item.closeIndex].type = "task_list_item_close";
      tokens[item.openIndex].meta = {
        ...(tokens[item.openIndex].meta || {}),
        checked: item.checked,
      };
      stripTaskPrefixFromInlineToken(tokens[item.inlineIndex], checkboxPattern);
    }

    i = listCloseIndex;
  }
}

function wrapInlineTableCellContent(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || (token.type !== "th_open" && token.type !== "td_open")) {
      continue;
    }

    const nextToken = tokens[i + 1];
    if (!nextToken || nextToken.type !== "inline") continue;

    const TokenCtor = nextToken.constructor;
    if (typeof TokenCtor !== "function") continue;

    const paragraphOpen = new TokenCtor("paragraph_open", "p", 1);
    const paragraphClose = new TokenCtor("paragraph_close", "p", -1);
    paragraphOpen.block = true;
    paragraphClose.block = true;

    tokens.splice(i + 1, 0, paragraphOpen);
    tokens.splice(i + 3, 0, paragraphClose);
    i += 3;
  }
}

function parseMarkdownTableDelimiterCell(cell) {
  const raw = String(cell || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(:)?(-+)(:)?$/);
  if (!match) return null;
  return {
    left: Boolean(match[1]),
    right: Boolean(match[3]),
    dashCount: match[2].length,
  };
}

function normalizeShortTableDelimiterRows(src) {
  const source = typeof src === "string" ? src : "";
  if (!source.includes("|")) return source;

  const lines = source.split("\n");
  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerLine = String(lines[i] || "");
    const delimiterLine = String(lines[i + 1] || "");

    if (!headerLine.includes("|") || !delimiterLine.includes("|")) continue;
    if (!headerLine.trim() || !delimiterLine.trim()) continue;

    const delimiterCells = delimiterLine.split("|");
    const parsedCells = [];
    let hasAnyDelimiterCell = false;
    let allNonEmptyCellsAreDelimiters = true;

    for (const cell of delimiterCells) {
      const trimmed = String(cell || "").trim();
      if (!trimmed) {
        parsedCells.push(null);
        continue;
      }

      const parsed = parseMarkdownTableDelimiterCell(trimmed);
      if (!parsed) {
        allNonEmptyCellsAreDelimiters = false;
        break;
      }

      hasAnyDelimiterCell = true;
      parsedCells.push(parsed);
    }

    if (!hasAnyDelimiterCell || !allNonEmptyCellsAreDelimiters) continue;

    const normalized = parsedCells.map((entry) => {
      if (!entry) return "";
      const dashes = "-".repeat(Math.max(3, entry.dashCount));
      return `${entry.left ? ":" : ""}${dashes}${entry.right ? ":" : ""}`;
    });

    lines[i + 1] = normalized.join(" | ").trim();
  }

  return lines.join("\n");
}

export function createMarkdownParser(schema) {
  // Create a fresh markdown-it instance - DO NOT mutate global state
  const markdownIt = createFreshMarkdownItInstance();
  const parseTokens = markdownIt.parse.bind(markdownIt);
  markdownIt.parse = (src, env) => {
    const normalizedSource = normalizeShortTableDelimiterRows(src);
    const tokens = parseTokens(normalizedSource, env);
    wrapInlineTableCellContent(tokens);
    promoteTaskListTokens(tokens);
    return tokens;
  };

  const blockTerminatorAlts = ["paragraph", "reference", "blockquote", "list"];

  // Add MFE marker rule (only once per instance)
  if (!markdownIt.__mfeMarker) {
    markdownIt.block.ruler.before(
      "html_block",
      "mfe_marker",
      (state, startLine, endLine, silent) => {
        const pos = state.bMarks[startLine] + state.tShift[startLine];
        const max = state.eMarks[startLine];
        if (pos >= max) return false;
        const line = state.src.slice(pos, max);
        const match = line.match(/^\s*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->\s*$/);
        if (!match) return false;
        if (isReservedGapMarkerName(match[1])) return false;
        if (silent) return true;

        markdownIt.__mfeMarkerHits = (markdownIt.__mfeMarkerHits || 0) + 1;
        if (markdownIt.__mfeMarkerHits > 5000) {
          return false;
        }

        const token = state.push("mfe_marker", "", 0);
        token.meta = { name: match[1] };
        token.block = true;
        state.line = startLine + 1;
        return true;
      },
      { alt: blockTerminatorAlts },
    );
    markdownIt.__mfeMarker = true;
  }
  if (!markdownIt.__mfeGap) {
    markdownIt.block.ruler.before(
      "html_block",
      "mfe_gap",
      (state, startLine, endLine, silent) => {
        void endLine;
        const pos = state.bMarks[startLine] + state.tShift[startLine];
        const max = state.eMarks[startLine];
        if (pos >= max) return false;
        const line = state.src.slice(pos, max);
        const match = line.match(/^\s*<!--\s*mfe-gap:(\d+)\s*-->\s*$/);
        if (!match) return false;
        if (silent) return true;

        const token = state.push("mfe_gap", "", 0);
        token.meta = { lineCount: parseGapLineCount(match[1]) };
        token.block = true;
        state.line = startLine + 1;
        return true;
      },
      { alt: blockTerminatorAlts },
    );
    markdownIt.__mfeGap = true;
  }
  if (!schema.nodes.image) {
    markdownIt.disable("image");
  }
  const tokens = {
    ...defaultMarkdownParser.tokens,
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "listItem" },
    bullet_list: {
      block: "bulletList",
      getAttrs: (tok, tokens, i) => ({
        ...(defaultMarkdownParser.tokens.bullet_list?.getAttrs
          ? defaultMarkdownParser.tokens.bullet_list.getAttrs(tok, tokens, i)
          : {}),
        bullet: String(tok?.markup || "-").slice(0, 1) || "-",
      }),
    },
    ordered_list: {
      block: "orderedList",
      getAttrs: defaultMarkdownParser.tokens.ordered_list?.getAttrs,
    },
    task_list: {
      block: "taskList",
      getAttrs: (tok, tokens, i) => ({
        ...(defaultMarkdownParser.tokens.bullet_list?.getAttrs
          ? defaultMarkdownParser.tokens.bullet_list.getAttrs(tok, tokens, i)
          : {}),
        bullet: String(tok?.markup || "-").slice(0, 1) || "-",
      }),
    },
    task_list_item: {
      block: "taskItem",
      getAttrs: (tok) => ({ checked: Boolean(tok?.meta?.checked) }),
    },
    table: { block: "table" },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: "tableRow" },
    th: { block: "tableHeader" },
    td: { block: "tableCell" },
    heading: {
      block: "heading",
      getAttrs: defaultMarkdownParser.tokens.heading?.getAttrs,
    },
    code_block: { block: "codeBlock", noCloseToken: true },
    fence: {
      block: "codeBlock",
      getAttrs: (tok) => {
        const info = String(tok?.info || "").trim();
        return {
          ...(defaultMarkdownParser.tokens.fence?.getAttrs
            ? defaultMarkdownParser.tokens.fence.getAttrs(tok)
            : {}),
          params: info || null,
          language: info ? info.split(/\s+/, 1)[0] : null,
        };
      },
      noCloseToken: true,
    },
    hr: { node: "horizontalRule" },
    hardbreak: { node: "hardBreak" },
    softbreak: { node: "hardBreak" },
    em: {
      mark: "italic",
      getAttrs: (tok) => ({
        delimiter: String(tok?.markup || "") === "_" ? "_" : "*",
      }),
    },
    strong: {
      mark: "bold",
      getAttrs: (tok) => ({
        delimiter: String(tok?.markup || "") === "__" ? "__" : "**",
      }),
    },
    s: { mark: "strike" },
    link: {
      ...defaultMarkdownParser.tokens.link,
      getAttrs: defaultMarkdownParser.tokens.link?.getAttrs,
    },
    image: defaultMarkdownParser.tokens.image,
  };

  tokens.mfe_marker = schema.nodes.mfeMarker
    ? {
        block: "mfeMarker",
        getAttrs: (tok) => ({ name: tok.meta?.name || "" }),
        noCloseToken: true,
      }
    : { ignore: true, noCloseToken: true };

  tokens.mfe_gap = schema.nodes.mfeGap
    ? {
        block: "mfeGap",
        getAttrs: (tok) => ({
          lineCount: parseGapLineCount(tok.meta?.lineCount),
        }),
        noCloseToken: true,
      }
    : { ignore: true, noCloseToken: true };

  if (!schema.nodes.codeBlock) {
    delete tokens.code_block;
    delete tokens.fence;
  }
  if (!schema.nodes.taskList || !schema.nodes.taskItem) {
    delete tokens.task_list;
    delete tokens.task_list_item;
  }
  if (
    !schema.nodes.table ||
    !schema.nodes.tableRow ||
    !schema.nodes.tableHeader ||
    !schema.nodes.tableCell
  ) {
    delete tokens.table;
    delete tokens.thead;
    delete tokens.tbody;
    delete tokens.tr;
    delete tokens.th;
    delete tokens.td;
  }
  if (!schema.nodes.image) {
    delete tokens.image;
  }
  if (!schema.marks?.strike) {
    delete tokens.s;
  }

  return new MarkdownParser(schema, markdownIt, tokens);
}

export function parseMarkdownToDoc(markdown, schema) {
  if (!schema) {
    throw new Error("parseMarkdownToDoc requires schema");
  }
  const parser = createMarkdownParser(schema);
  const canonicalMarkdown = typeof markdown === "string" ? markdown : "";
  const parserSource = encodeMarkerBoundaryGapsForParser(canonicalMarkdown);
  const doc = parser.parse(parserSource);

  const taskStats = getTaskNodeStats(doc);
  const taskLines = buildTaskLineDiagnostics(canonicalMarkdown);
  if (taskLines.hasTaskSyntax || taskStats.taskItemCount > 0) {
    const payload = {
      inputHash: hashTextForTrace(canonicalMarkdown),
      taskListCount: taskStats.taskListCount,
      taskItemCount: taskStats.taskItemCount,
      canonicalTaskLineCount: taskLines.canonicalTaskLineCount,
      escapedTaskLineCount: taskLines.escapedTaskLineCount,
      canonicalSamples: taskLines.canonicalSamples,
      escapedSamples: taskLines.escapedSamples,
      callerStack: getCallerStack(),
    };
    logMfeTrace("TASK_PARSE_TRACE", payload);
    if (isHostDevMode()) {
      try {
        console.warn("[mfe] TASK_PARSE_TRACE", payload);
      } catch (_error) {
        // noop
      }
    }
  }

  return doc;
}

/**
 * Render markdown to HTML for display purposes ONLY.
 *
 * CRITICAL: This creates a fresh parser instance and does NOT affect persistence.
 * The HTML output is for display rendering only. It is never saved.
 *
 * Configuration:
 * - html: false → HTML tags treated as literal text
 * - breaks: false → Single newlines NOT interpreted as breaks
 */
export function renderMarkdownToHtml(markdown) {
  const src = markdown || "";

  // Create a fresh markdown-it instance for rendering
  const md = createFreshMarkdownItInstance();

  const withPlaceholders = src.replace(
    /^\s*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->\s*$/gm,
    (_, name) => `\n\n[[MFE_MARKER:${name}]]\n\n`,
  );
  let html = md.render(withPlaceholders);
  html = html.replace(
    /<p>\s*\[\[MFE_MARKER:([a-zA-Z0-9_:.\/-]+)\]\]\s*<\/p>/g,
    '<div data-mfe-marker="$1"></div>',
  );
  return html;
}

function getSerializableImageSource(node) {
  const fromOriginal = (node?.attrs?.originalFilename || "").trim();
  if (fromOriginal) return fromOriginal;

  const fromSrc = (node?.attrs?.src || "").trim();
  if (!fromSrc) return "";

  const pageAssetsMatch = fromSrc.match(
    /^(?:https?:\/\/[^/]+)?\/site\/assets\/files\/\d+\/([^?#]+)$/i,
  );
  if (pageAssetsMatch?.[1]) {
    return pageAssetsMatch[1];
  }

  return fromSrc;
}

function serializeImageSrc(src) {
  return (src || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\s/g, "%20");
}

function serializeLinkHref(src) {
  return String(src || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\s/g, "%20");
}

function escapeTableCellText(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function computeMarkdownTableColumnWidths(rows, columnCount) {
  const widths = Array.from({ length: columnCount }, () => 3);
  rows.forEach((row) => {
    for (let i = 0; i < columnCount; i += 1) {
      const cell = String(row?.[i] || "");
      widths[i] = Math.max(widths[i], cell.length);
    }
  });
  return widths;
}

function formatMarkdownTableDataRow(cells, widths) {
  const padded = cells.map((cell, index) => {
    const value = String(cell || "");
    const width = Number(widths?.[index] || 0);
    return value.padEnd(width, " ");
  });
  return `| ${padded.join(" | ")} |`;
}

function buildMarkdownTableSeparator(widths, alignments) {
  const segments = [];
  for (let i = 0; i < widths.length; i += 1) {
    const align = String(alignments[i] || "").toLowerCase();
    const dashCount = Math.max(3, Number(widths[i] || 0));
    if (align === "left") {
      segments.push(`:${"-".repeat(Math.max(1, dashCount - 1))}`);
      continue;
    }
    if (align === "right") {
      segments.push(`${"-".repeat(Math.max(1, dashCount - 1))}:`);
      continue;
    }
    if (align === "center") {
      segments.push(`:${"-".repeat(Math.max(1, dashCount - 2))}:`);
      continue;
    }
    segments.push("-".repeat(dashCount));
  }
  return `| ${segments.join(" | ")} |`;
}

function writeTextPreservingFootnoteTokens(state, textValue) {
  const text = String(textValue || "");
  if (!text) return;

  const footnoteTokenPattern = /\[\^[^\]\n]+\](?::)?|\^\[[^\]\n]+\]/g;
  let cursor = 0;
  let match = footnoteTokenPattern.exec(text);

  while (match) {
    const matchIndex = Number(match.index || 0);
    const token = String(match[0] || "");
    if (matchIndex > cursor) {
      state.text(text.slice(cursor, matchIndex));
    }
    state.write(token);
    cursor = matchIndex + token.length;
    match = footnoteTokenPattern.exec(text);
  }

  if (cursor < text.length) {
    state.text(text.slice(cursor));
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.getOwnPropertyNames(value).forEach((name) => {
    const child = value[name];
    if (child && typeof child === "object") {
      deepFreeze(child);
    }
  });
  return Object.freeze(value);
}

function cloneMarkSpecMap(source) {
  const out = {};
  Object.keys(source || {}).forEach((key) => {
    const spec = source[key];
    out[key] =
      spec && typeof spec === "object" && !Array.isArray(spec)
        ? { ...spec }
        : spec;
  });
  return out;
}

const SERIALIZER_NODES_BLUEPRINT = deepFreeze({
  blockquote: defaultMarkdownSerializer.nodes.blockquote,
  codeBlock(state, node) {
    const language = String(node?.attrs?.language || "").trim();
    const params = String(node?.attrs?.params || "").trim();
    const info = language || params;
    const content = String(node?.textContent || "").replace(/[\r\n]+$/, "");
    state.write(`\`\`\`${info}`);
    state.ensureNewLine();
    if (content) {
      state.text(content, false);
      state.ensureNewLine();
    }
    state.write("```");
    state.closeBlock(node);
  },
  heading: defaultMarkdownSerializer.nodes.heading,
  horizontalRule: defaultMarkdownSerializer.nodes.horizontal_rule,
  bulletList(state, node) {
    const marker =
      String(node?.attrs?.bullet || "").slice(0, 1) ||
      getDefaultUnorderedListMarker();
    state.renderList(node, "  ", () => `${marker} `);
  },
  orderedList: defaultMarkdownSerializer.nodes.ordered_list,
  taskList(state, node) {
    const marker =
      String(node?.attrs?.bullet || "").slice(0, 1) ||
      getDefaultUnorderedListMarker();
    state.renderList(node, "  ", () => `${marker} `);
  },
  taskItem(state, node) {
    state.write(node?.attrs?.checked ? "[x] " : "[ ] ");
    state.renderContent(node);
  },
  listItem: defaultMarkdownSerializer.nodes.list_item,
  table(state, node) {
    const rows = [];
    const alignments = [];

    for (let i = 0; i < node.childCount; i += 1) {
      const row = node.child(i);
      if (row?.type?.name !== "tableRow") continue;

      const cells = [];
      for (let j = 0; j < row.childCount; j += 1) {
        const cell = row.child(j);
        cells.push(escapeTableCellText(cell?.textContent || ""));
        if (i === 0) {
          const align =
            cell?.attrs?.align ||
            cell?.attrs?.textAlign ||
            cell?.attrs?.textalign;
          alignments.push(align || "");
        }
      }

      rows.push(cells);
    }

    if (rows.length === 0) {
      state.closeBlock(node);
      return;
    }

    const columnCount = rows.reduce(
      (maxCount, row) => Math.max(maxCount, row.length),
      0,
    );
    const safeColumnCount = Math.max(1, columnCount);
    const normalizedRows = rows.map((row) => {
      const normalized = row.slice(0, safeColumnCount);
      while (normalized.length < safeColumnCount) normalized.push("");
      return normalized;
    });
    const columnWidths = computeMarkdownTableColumnWidths(
      normalizedRows,
      safeColumnCount,
    );

    state.write(formatMarkdownTableDataRow(normalizedRows[0], columnWidths));
    state.ensureNewLine();
    state.write(buildMarkdownTableSeparator(columnWidths, alignments));
    state.ensureNewLine();

    for (let i = 1; i < normalizedRows.length; i += 1) {
      state.write(formatMarkdownTableDataRow(normalizedRows[i], columnWidths));
      state.ensureNewLine();
    }

    state.closeBlock(node);
  },
  paragraph: defaultMarkdownSerializer.nodes.paragraph,
  image(state, node) {
    const src = getSerializableImageSource(node);
    state.write(
      "![" +
        state.esc(node.attrs.alt || "") +
        "](" +
        serializeImageSrc(src) +
        (node.attrs.title ? ' "' + state.esc(node.attrs.title) + '"' : "") +
        ")",
    );
  },
  mfeMarker(state, node) {
    const name = node.attrs.name || "";
    state.write(`<!-- ${name} -->`);
    state.ensureNewLine();
    state.atBlockStart = true;
  },
  mfeGap(state, node) {
    const lineCount = parseGapLineCount(node?.attrs?.lineCount || 1);
    state.write(`<!-- mfe-gap:${lineCount} -->`);
    state.ensureNewLine();
    state.atBlockStart = true;
  },
  hardBreak(state) {
    state.write("\n");
  },
  text(state, node) {
    writeTextPreservingFootnoteTokens(state, node?.text || "");
  },
});

const SERIALIZER_MARKS_BLUEPRINT = deepFreeze({
  ...cloneMarkSpecMap(defaultMarkdownSerializer.marks),
  link: {
    open: () => "[",
    close: (state, mark) => {
      const href = serializeLinkHref(mark?.attrs?.href || "");
      const title = String(mark?.attrs?.title || "").trim();
      const titlePart = title ? ` "${state.esc(title)}"` : "";
      return `](${href}${titlePart})`;
    },
    mixable: false,
  },
  bold: {
    open: (_state, mark) =>
      String(mark?.attrs?.delimiter || "") === "__"
        ? "__"
        : getDefaultBoldDelimiter(),
    close: (_state, mark) =>
      String(mark?.attrs?.delimiter || "") === "__"
        ? "__"
        : getDefaultBoldDelimiter(),
    mixable: true,
    expelEnclosingWhitespace: true,
  },
  italic: {
    open: (_state, mark) =>
      String(mark?.attrs?.delimiter || "") === "_"
        ? "_"
        : getDefaultItalicDelimiter(),
    close: (_state, mark) =>
      String(mark?.attrs?.delimiter || "") === "_"
        ? "_"
        : getDefaultItalicDelimiter(),
    mixable: true,
    expelEnclosingWhitespace: true,
  },
  strike: {
    open: "~~",
    close: "~~",
    mixable: true,
    expelEnclosingWhitespace: true,
  },
  underline: {
    open: "<u>",
    close: "</u>",
    mixable: true,
    expelEnclosingWhitespace: true,
  },
  superscript: {
    open: "<sup>",
    close: "</sup>",
    mixable: true,
    expelEnclosingWhitespace: true,
  },
  subscript: {
    open: "<sub>",
    close: "</sub>",
    mixable: true,
    expelEnclosingWhitespace: true,
  },
  code: {
    ...defaultMarkdownSerializer.marks.code,
  },
});

const SERIALIZER_OPTIONS_BLUEPRINT = deepFreeze({
  tightLists: true,
});

function cloneSerializerNodeMap() {
  return { ...SERIALIZER_NODES_BLUEPRINT };
}

function cloneSerializerMarkMap() {
  return cloneMarkSpecMap(SERIALIZER_MARKS_BLUEPRINT);
}

export function createMarkdownSerializer(_schema) {
  return new MarkdownSerializer(
    cloneSerializerNodeMap(),
    cloneSerializerMarkMap(),
    {
      ...SERIALIZER_OPTIONS_BLUEPRINT,
      bulletListMarker: getDefaultUnorderedListMarker(),
    },
  );
}

function hashTextForTrace(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

function buildTaskLineDiagnostics(markdown, maxSamples = 4) {
  const text = String(markdown || "");
  const lines = text.split(/\r?\n/);
  const canonicalSamples = [];
  const escapedSamples = [];
  let canonicalTaskLineCount = 0;
  let escapedTaskLineCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isCanonical = /^[ \t]*[*+-][ \t]+\[[ xX]\][ \t]+.*$/.test(line);
    const isEscaped = /^[ \t]*[*+-][ \t]+\\\[[ xX]\\\][ \t]+.*$/.test(line);

    if (!isCanonical && !isEscaped) continue;

    if (isCanonical) {
      canonicalTaskLineCount += 1;
      if (canonicalSamples.length < maxSamples) {
        canonicalSamples.push({ line: index + 1, value: line });
      }
    }

    if (isEscaped) {
      escapedTaskLineCount += 1;
      if (escapedSamples.length < maxSamples) {
        escapedSamples.push({ line: index + 1, value: line });
      }
    }
  }

  return {
    canonicalTaskLineCount,
    escapedTaskLineCount,
    canonicalSamples,
    escapedSamples,
    hasTaskSyntax: canonicalTaskLineCount > 0 || escapedTaskLineCount > 0,
  };
}

function getCallerStack(limit = 6) {
  return (
    new Error("MFE_TASK_TRACE").stack
      ?.split("\n")
      ?.slice(1, 1 + limit)
      ?.map((line) => String(line || "").trim()) || []
  );
}

function getTaskNodeStats(doc) {
  if (!doc || typeof doc.descendants !== "function") {
    return { taskListCount: 0, taskItemCount: 0 };
  }

  let taskListCount = 0;
  let taskItemCount = 0;

  doc.descendants((node) => {
    if (node?.type?.name === "taskList") taskListCount += 1;
    if (node?.type?.name === "taskItem") taskItemCount += 1;
  });

  return { taskListCount, taskItemCount };
}

function countEscapedTaskCheckboxLines(markdown) {
  const text = String(markdown || "");
  const matches = text.match(/^[ \t]*[*+-][ \t]+\\\[[ xX]\\\][ \t]+.*$/gm);
  return Array.isArray(matches) ? matches.length : 0;
}

function collectTaskCheckboxLineSamples(markdown, limit = 4) {
  const text = String(markdown || "");
  const lines = text.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[ \t]*[*+-][ \t]+\\\[[ xX]\\\][ \t]+.*$/.test(line)) {
      out.push({ line: i + 1, value: line });
      if (out.length >= limit) break;
    }
  }

  return out;
}

function logTaskEscapeDriftIfDetected(doc, output) {
  const taskStats = getTaskNodeStats(doc);
  if (taskStats.taskItemCount === 0) return;

  const escapedTaskLineCount = countEscapedTaskCheckboxLines(output);
  if (escapedTaskLineCount === 0) return;

  const stack =
    new Error("TASK_ESCAPE_DRIFT").stack
      ?.split("\n")
      ?.slice(1, 7)
      ?.map((line) => String(line || "").trim()) || [];

  const payload = {
    taskListCount: taskStats.taskListCount,
    taskItemCount: taskStats.taskItemCount,
    escapedTaskLineCount,
    escapedTaskSamples: collectTaskCheckboxLineSamples(output),
    outputHash: hashTextForTrace(output),
    callerStack: stack,
  };

  logMfeTrace("TASK_ESCAPE_DRIFT_DETECTED", payload);

  if (isHostDevMode()) {
    try {
      console.warn("[mfe] TASK_ESCAPE_DRIFT_DETECTED", payload);
    } catch (_error) {
      // noop
    }
  }
}

function logTaskSerializeTrace(doc, output) {
  const taskStats = getTaskNodeStats(doc);
  const taskLines = buildTaskLineDiagnostics(output);
  if (!taskLines.hasTaskSyntax && taskStats.taskItemCount === 0) return;

  const payload = {
    outputHash: hashTextForTrace(output),
    taskListCount: taskStats.taskListCount,
    taskItemCount: taskStats.taskItemCount,
    canonicalTaskLineCount: taskLines.canonicalTaskLineCount,
    escapedTaskLineCount: taskLines.escapedTaskLineCount,
    canonicalSamples: taskLines.canonicalSamples,
    escapedSamples: taskLines.escapedSamples,
    callerStack: getCallerStack(),
  };

  logMfeTrace("TASK_SERIALIZE_TRACE", payload);

  if (isHostDevMode()) {
    try {
      console.warn("[mfe] TASK_SERIALIZE_TRACE", payload);
    } catch (_error) {
      // noop
    }
  }
}

function logMfeTrace(label, payload) {
  const debugEnabled =
    typeof window !== "undefined" &&
    window.MarkdownFrontEditorConfig?.debug === true;
  if (!debugEnabled) return;
  try {
    console.warn(`[mfe] ${label}`, payload);
  } catch (_error) {
    // noop
  }
}

let lastSerializeMarkdownDocTraceSignature = "";

function logSerializeMarkdownDocTrace(output) {
  const debugEnabled =
    typeof window !== "undefined" &&
    window.MarkdownFrontEditorConfig?.debug === true;
  if (!debugEnabled) return;

  const outputHash = hashTextForTrace(output);
  const payload = {
    serializedHash: outputHash,
    outputHash,
    changedByNormalizer: false,
  };
  const signature = `${payload.serializedHash}|${payload.outputHash}|${payload.changedByNormalizer ? "1" : "0"}`;
  if (signature === lastSerializeMarkdownDocTraceSignature) return;
  lastSerializeMarkdownDocTraceSignature = signature;

  logMfeTrace("SERIALIZE_MARKDOWN_DOC", payload);
}

// Backwards-compatible snapshot export. Runtime serialization uses per-call factories.
export const markdownSerializer = deepFreeze(createMarkdownSerializer(null));

export function serializeMarkdownDoc(doc) {
  if (!doc) return "";
  const serializer = createMarkdownSerializer(doc?.type?.schema);
  const serialized = serializer.serialize(doc);
  const output = decodeGapSentinelComments(serialized);
  logTaskSerializeTrace(doc, output);
  logTaskEscapeDriftIfDetected(doc, output);

  logSerializeMarkdownDocTrace(output);

  return output;
}

export function decodeMarkdownBase64(markdownB64) {
  return decodeURIComponent(
    Array.prototype.map
      .call(
        atob(markdownB64),
        (c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`,
      )
      .join(""),
  );
}

export function decodeHtmlEntitiesInFences(markdown) {
  const parts = markdown.split(/```/);
  if (parts.length === 1) return markdown;

  for (let i = 1; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  return parts.join("```");
}

export function getLanguagesConfig() {
  const cfg = window.MarkdownFrontEditorConfig || {};
  const langs = Array.isArray(cfg.languages) ? cfg.languages : [];
  const current = cfg.currentLanguage || "";
  return { langs, current };
}

export function fetchTranslations(
  mdName,
  pageId,
  scope = "field",
  section = "",
) {
  const scopeParam = scope ? `&mdScope=${encodeURIComponent(scope)}` : "";
  const sectionParam = section
    ? `&mdSection=${encodeURIComponent(section)}`
    : "";
  return request(
    `?markdownFrontEditorTranslations=1&mdName=${encodeURIComponent(
      mdName,
    )}&pageId=${encodeURIComponent(pageId)}${scopeParam}${sectionParam}`,
    {
      method: "GET",
      headers: undefined,
      body: undefined,
      parse: "json",
    },
  )
    .then((result) =>
      result.ok && result.data?.status ? result.data.data : null,
    )
    .catch(() => null);
}

export function saveTranslation(
  pageId,
  mdName,
  lang,
  markdown,
  scope = "field",
  section = "",
  subsection = "",
  fieldId = "",
) {
  return fetchCsrfToken().then((csrf) => {
    const formData = new FormData();
    formData.append("markdown", markdown);
    formData.append("mdName", mdName);
    formData.append("pageId", pageId);
    formData.append("lang", lang);
    formData.append("mdScope", scope || "field");
    if (section) {
      formData.append("mdSection", section);
    }
    if (subsection) {
      formData.append("mdSubsection", subsection);
    }
    if (fieldId) {
      formData.append("fieldId", fieldId);
    }

    if (csrf) {
      formData.append(csrf.name, csrf.value);
    }

    logMfeTrace("SAVE_TRANSLATION_REQUEST", {
      mdName,
      scope: scope || "field",
      section,
      subsection,
      fieldId,
      markdownHash: hashTextForTrace(markdown),
    });

    const taskLines = buildTaskLineDiagnostics(markdown);
    if (taskLines.hasTaskSyntax) {
      const payload = {
        mdName,
        scope: scope || "field",
        section,
        subsection,
        fieldId,
        markdownHash: hashTextForTrace(markdown),
        canonicalTaskLineCount: taskLines.canonicalTaskLineCount,
        escapedTaskLineCount: taskLines.escapedTaskLineCount,
        canonicalSamples: taskLines.canonicalSamples,
        escapedSamples: taskLines.escapedSamples,
        callerStack: getCallerStack(),
      };
      logMfeTrace("TASK_SAVE_PAYLOAD_TRACE", payload);
      if (isHostDevMode()) {
        try {
          console.warn("[mfe] TASK_SAVE_PAYLOAD_TRACE", payload);
        } catch (_error) {
          // noop
        }
      }
    }

    return request(getSaveUrl(), {
      method: "POST",
      headers: undefined,
      body: formData,
      parse: "json",
    });
  });
}

export function getSaveUrl() {
  const fromConfig = window.MarkdownFrontEditorConfig?.saveUrl;
  if (typeof fromConfig === "string" && fromConfig.trim() !== "") {
    return fromConfig;
  }
  return "?markdownFrontEditorSave=1";
}

export function getFragmentsUrl() {
  return "?markdownFrontEditorFragments=1";
}

export async function fetchCsrfToken() {
  try {
    const result = await request("?markdownFrontEditorToken=1", {
      method: "GET",
      headers: undefined,
      body: undefined,
      parse: "text",
    });
    if (!result.ok) return null;
    const html = String(result.data || "");
    const match = html.match(
      /name=["\']?([^"\'\s]+)["\']?[^>]*value=["\']?([^"\'>]+)/,
    );
    if (match && match.length > 2) {
      return { name: match[1], value: match[2] };
    }
  } catch (err) {
    // token fetch errors are handled by callers
  }
  return null;
}

/**
 * Assert markdown is byte-for-byte identical unless explicitly edited.
 * Throws in dev mode if mutation is detected.
 *
 * @param {string} original Original markdown passed to editor
 * @param {string} edited Current markdown from editor buffer
 * @throws Error if non-lossless transform detected
 */
export function assertMarkdownInvariant(original, edited) {
  if (!isDevMode()) return;

  if (original === edited) return;

  const msg =
    `INVARIANT VIOLATION: Markdown mutation detected\n` +
    `Original (${original.length} bytes):\n${JSON.stringify(original)}\n\n` +
    `Current (${edited.length} bytes):\n${JSON.stringify(edited)}`;

  throw new Error(msg);
}

function isDevMode() {
  return isHostDevMode();
}
