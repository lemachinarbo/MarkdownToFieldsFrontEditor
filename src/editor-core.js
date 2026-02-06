import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";

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

export function createMarkdownParser(schema) {
  const markdownIt = defaultMarkdownParser.tokenizer;
  markdownIt.set({ breaks: true });
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

export function decodeMarkdownBase64(markdownB64) {
  return decodeURIComponent(
    Array.prototype.map
      .call(atob(markdownB64), (c) =>
        `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`,
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

export function fetchTranslations(mdName, pageId, scope = "field", section = "") {
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
