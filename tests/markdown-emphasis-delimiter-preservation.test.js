import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  parseMarkdownToDoc,
  serializeMarkdownDoc,
} from "../src/editor-core.js";
import {
  MarkerAwareBold,
  MarkerAwareItalic,
} from "../src/editor-tiptap-extensions.js";

function buildSchema() {
  return getSchema([
    StarterKit.configure({
      bold: false,
      italic: false,
      codeBlock: true,
      link: false,
      underline: false,
    }),
    MarkerAwareBold,
    MarkerAwareItalic,
  ]);
}

describe("markdown emphasis delimiter preservation", () => {
  test("preserves per-mark bold and italic delimiters on round-trip", () => {
    const schema = buildSchema();
    const input = "__bold__ **bold** *italic* _italic_ ~~strike~~ `inline code`";

    const doc = parseMarkdownToDoc(input, schema);
    const output = serializeMarkdownDoc(doc);

    expect(output).toBe(input);
  });
});
