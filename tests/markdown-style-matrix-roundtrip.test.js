import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  parseMarkdownToDoc,
  serializeMarkdownDoc,
} from "../src/editor-core.js";
import { createMfeImageExtension } from "../src/editor-tiptap-extensions.js";

function buildTestSchema() {
  const ImageExtension = createMfeImageExtension(() => "");
  return getSchema([
    StarterKit.configure({
      codeBlock: true,
      link: false,
      underline: false,
    }),
    Link.configure({
      openOnClick: false,
      linkOnPaste: true,
    }),
    ImageExtension,
  ]);
}

function roundTrip(markdown, schema) {
  const firstDoc = parseMarkdownToDoc(markdown, schema);
  const serialized = serializeMarkdownDoc(firstDoc);
  const reparsedDoc = parseMarkdownToDoc(serialized, schema);
  return { firstDoc, serialized, reparsedDoc };
}

function replaceUniqueBlockInText(documentText, search, replacement) {
  const firstPos = documentText.indexOf(search);
  if (firstPos === -1) return null;
  const secondPos = documentText.indexOf(search, firstPos + search.length);
  if (secondPos !== -1) return null;
  return (
    documentText.slice(0, firstPos) +
    replacement +
    documentText.slice(firstPos + search.length)
  );
}

function findTextWithMark(node, markName) {
  if (!node) return false;
  if (node.type === "text" && Array.isArray(node.marks)) {
    return node.marks.some((mark) => mark?.type === markName);
  }
  const content = Array.isArray(node.content) ? node.content : [];
  return content.some((child) => findTextWithMark(child, markName));
}

function collectImageSources(node, out = []) {
  if (!node) return out;
  if (node.type === "image") {
    out.push(node?.attrs?.src || "");
  }
  const content = Array.isArray(node.content) ? node.content : [];
  content.forEach((child) => collectImageSources(child, out));
  return out;
}

describe("Markdown style matrix round-trip", () => {
  const schema = buildTestSchema();

  const cases = [
    { name: "bold", markdown: "**bold text**" },
    { name: "italic", markdown: "_italic text_" },
    { name: "strikethrough", markdown: "~~striked text~~" },
    { name: "inline code", markdown: "Text with `code`" },
    { name: "link", markdown: "[Example](https://example.com)" },
    { name: "heading", markdown: "## Heading" },
    { name: "unordered list", markdown: "- A\n- B" },
    { name: "ordered list", markdown: "1. A\n2. B" },
    { name: "blockquote", markdown: "> quote" },
    { name: "horizontal rule", markdown: "---" },
    { name: "image", markdown: "![alt](image.jpg)" },
  ];

  test.each(cases)("round-trips semantic structure: $name", ({ markdown }) => {
    const { firstDoc, reparsedDoc } = roundTrip(markdown, schema);
    expect(reparsedDoc.toJSON()).toEqual(firstDoc.toJSON());
  });

  test("strikethrough stays a mark after round-trip", () => {
    const { reparsedDoc, serialized } = roundTrip("~~Title~~", schema);
    const json = reparsedDoc.toJSON();
    expect(serialized).toContain("~~Title~~");
    expect(findTextWithMark(json, "strike")).toBe(true);
  });

  test("scope handoff simulation keeps strike + image semantics", () => {
    const originalField = "Promo ~~Old~~ ![hero](old.jpg)";
    const editedField = "Promo ~~New~~ ![hero](new.jpg)";
    const documentMarkdown = [
      "## Hero",
      originalField,
      "",
      "## Body",
      "Body text",
    ].join("\n");

    const composed = replaceUniqueBlockInText(
      documentMarkdown,
      originalField,
      editedField,
    );
    expect(composed).toBeTruthy();

    const { reparsedDoc, serialized } = roundTrip(composed, schema);
    const json = reparsedDoc.toJSON();
    const imageSources = collectImageSources(json);

    expect(serialized).toContain("~~New~~");
    expect(findTextWithMark(json, "strike")).toBe(true);
    expect(imageSources).toContain("new.jpg");
  });
});
