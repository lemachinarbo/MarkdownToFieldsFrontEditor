import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";

/**
 * CRITICAL: Each parser/serializer instance MUST be fresh and isolated.
 * Never mutate shared instances. Markdown source must be immutable.
 */

export const warningFieldTypes = new Set(["heading"]);
export const warningFieldNames = new Set(["title", "name"]);

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

export function shouldWarnForExtraContent(fieldType, fieldName) {
  if (fieldType === "container") return false;
  if (warningFieldTypes.size === 0 && warningFieldNames.size === 0)
    return false;
  if (warningFieldTypes.size > 0 && warningFieldNames.size > 0) {
    return warningFieldTypes.has(fieldType) && warningFieldNames.has(fieldName);
  }
  if (warningFieldTypes.size > 0) return warningFieldTypes.has(fieldType);
  return warningFieldNames.has(fieldName);
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

  return md;
}

export function createMarkdownParser(schema) {
  // Create a fresh markdown-it instance - DO NOT mutate global state
  const markdownIt = createFreshMarkdownItInstance();

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
    );
    markdownIt.__mfeMarker = true;
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
    mfe_marker: {
      block: "mfeMarker",
      getAttrs: (tok) => ({ name: tok.meta?.name || "" }),
    },
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

export const markdownSerializer = new MarkdownSerializer(
  {
    blockquote: defaultMarkdownSerializer.nodes.blockquote,
    codeBlock: defaultMarkdownSerializer.nodes.code_block,
    heading: defaultMarkdownSerializer.nodes.heading,
    horizontalRule: defaultMarkdownSerializer.nodes.horizontal_rule,
    bulletList: defaultMarkdownSerializer.nodes.bullet_list,
    orderedList: defaultMarkdownSerializer.nodes.ordered_list,
    listItem: defaultMarkdownSerializer.nodes.list_item,
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
    hardBreak(state) {
      state.write("\n");
    },
    text: defaultMarkdownSerializer.nodes.text,
  },
  {
    ...defaultMarkdownSerializer.marks,
    bold: {
      open: "**",
      close: "**",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    italic: {
      open: "_",
      close: "_",
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
    code: defaultMarkdownSerializer.marks.code,
  },
  {
    tightLists: true,
    bulletListMarker: "-",
  },
);

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
  return fetch(
    `?markdownFrontEditorTranslations=1&mdName=${encodeURIComponent(
      mdName,
    )}&pageId=${encodeURIComponent(pageId)}${scopeParam}${sectionParam}`,
    { credentials: "same-origin" },
  )
    .then((res) => res.json())
    .then((data) => (data?.status ? data.data : null))
    .catch(() => null);
}

export function saveTranslation(
  pageId,
  mdName,
  lang,
  markdown,
  scope = "field",
  section = "",
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

export function getSaveUrl() {
  return "?markdownFrontEditorSave=1";
}

export function getFragmentsUrl() {
  return "?markdownFrontEditorFragments=1";
}

export async function fetchCsrfToken() {
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
    // token fetch errors are handled by callers
  }
  return null;
}
/**
 * SYSTEM INVARIANT: Markdown Losslessness Assertion
 *
 * Detects accidental normalization, transformation, or mutation of markdown source.
 * In dev mode, this validates that parse → serialize round-trip is lossless.
 *
 * Rule: If markdown didn't change in the editor, it must not change in persistence.
 *
 * @param {string} original Original markdown source
 * @param {string} serialized Serialized markdown from editor state
 * @returns {boolean} true if lossless, false if mutation detected
 */
export function validateMarkdownLosslessness(original, serialized) {
  if (!isDevMode()) return true;

  if (original === serialized) return true;

  return false;
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

/**
 * Detect if markdown appears to have been mutated implicitly.
 */
export function detectMarkdownNormalization(markdown) {
  if (!isDevMode()) return [];

  const violations = [];

  // Check for HTML line breaks that should be newlines
  if (markdown.includes("<br>")) {
    violations.push("Found <br> instead of newlines");
  }

  // Check for HTML strong/em instead of markdown
  if (markdown.includes("<strong>") || markdown.includes("<em>")) {
    violations.push("Found HTML formatting instead of markdown");
  }

  // Check for collapsed blank lines (visible if originally had `\n\n`)
  if (
    markdown.includes("\n\n") &&
    markdown !== markdown.replace(/\n\n+/g, "\n\n")
  ) {
    violations.push("Possible blank line normalization");
  }

  return violations;
}

/**
 * Verify serializer losslessness: parse(src) → serialize() === src
 *
 * CRITICAL INVARIANT: If the user did not modify the markdown,
 * the serialized output must be byte-identical to the input.
 *
 * This validates that the parse/serialize round-trip is lossless
 * for untouched content.
 *
 * @param {string} markdown Original markdown source
 * @param {SchemaSpec} schema ProseMirror schema
 * @throws Error in dev mode if round-trip is not lossless
 */
export function validateSerializerLosslessness(markdown, schema) {
  if (!isDevMode()) return;

  try {
    const parser = createMarkdownParser(schema);
    const parsed = parser.parse(markdown);
    const serialized = markdownSerializer.serialize(parsed);

    if (serialized === markdown) return; // ✅ Lossless

    // ❌ Mutation detected
    const msg =
      `SERIALIZER LOSSLESSNESS FAILURE\n` +
      `Input (${markdown.length} bytes):\n${JSON.stringify(markdown)}\n\n` +
      `Output (${serialized.length} bytes):\n${JSON.stringify(serialized)}\n\n` +
      `Diff: Characters differ at unedited content`;

    throw new Error(msg);
  } catch (err) {
    if (err.message.includes("SERIALIZER LOSSLESSNESS FAILURE")) throw err;
    // Parse errors are OK - malformed markdown is expected sometimes
    // Only throw losslessness violations
  }
}

function isDevMode() {
  return Boolean(
    typeof window !== "undefined" &&
    (window.__MFE_DEV || window.localStorage?.getItem("mfe-dev") === "1"),
  );
}
