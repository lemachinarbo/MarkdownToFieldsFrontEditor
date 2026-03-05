import { Schema } from "prosemirror-model";
import {
  createMarkdownParser,
  createMarkdownSerializer,
  markdownSerializer,
  serializeMarkdownDoc,
} from "../src/editor-core.js";

function createSchemaA() {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      blockquote: {
        group: "block",
        content: "block+",
        toDOM() {
          return ["blockquote", 0];
        },
      },
      paragraph: {
        group: "block",
        content: "inline*",
        toDOM() {
          return ["p", 0];
        },
      },
      listItem: {
        group: "block",
        content: "paragraph block*",
        toDOM() {
          return ["li", 0];
        },
      },
      bulletList: {
        group: "block",
        content: "listItem+",
        toDOM() {
          return ["ul", 0];
        },
      },
      orderedList: {
        group: "block",
        attrs: { order: { default: 1 } },
        content: "listItem+",
        toDOM(node) {
          return ["ol", { start: node.attrs.order }, 0];
        },
      },
      heading: {
        group: "block",
        content: "inline*",
        attrs: { level: { default: 1 } },
        toDOM(node) {
          return ["h" + node.attrs.level, 0];
        },
      },
      codeBlock: {
        group: "block",
        content: "text*",
        marks: "",
        code: true,
        toDOM() {
          return ["pre", ["code", 0]];
        },
      },
      horizontalRule: {
        group: "block",
        toDOM() {
          return ["hr"];
        },
      },
      hardBreak: {
        inline: true,
        group: "inline",
        selectable: false,
        toDOM() {
          return ["br"];
        },
      },
      image: {
        inline: true,
        group: "inline",
        attrs: {
          src: { default: "" },
          alt: { default: "" },
          title: { default: null },
          originalFilename: { default: null },
        },
        toDOM(node) {
          return ["img", node.attrs];
        },
      },
      mfeMarker: {
        group: "block",
        atom: true,
        attrs: { name: { default: "" } },
        toDOM(node) {
          return ["div", { "data-mfe-marker": node.attrs.name }];
        },
      },
      text: { group: "inline" },
    },
    marks: {
      bold: {
        toDOM() {
          return ["strong", 0];
        },
      },
      italic: {
        toDOM() {
          return ["em", 0];
        },
      },
      code: {
        toDOM() {
          return ["code", 0];
        },
      },
      strike: {
        toDOM() {
          return ["s", 0];
        },
      },
      underline: {
        toDOM() {
          return ["u", 0];
        },
      },
      superscript: {
        toDOM() {
          return ["sup", 0];
        },
      },
      subscript: {
        toDOM() {
          return ["sub", 0];
        },
      },
      link: {
        attrs: { href: {} },
        toDOM(mark) {
          return ["a", { href: mark.attrs.href }, 0];
        },
      },
    },
  });
}

function createSchemaB() {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      blockquote: {
        group: "block",
        content: "block+",
        toDOM() {
          return ["blockquote", 0];
        },
      },
      paragraph: {
        group: "block",
        content: "inline*",
        toDOM() {
          return ["p", 0];
        },
      },
      listItem: {
        group: "block",
        content: "paragraph block*",
        toDOM() {
          return ["li", 0];
        },
      },
      bulletList: {
        group: "block",
        content: "listItem+",
        toDOM() {
          return ["ul", 0];
        },
      },
      orderedList: {
        group: "block",
        attrs: { order: { default: 1 } },
        content: "listItem+",
        toDOM(node) {
          return ["ol", { start: node.attrs.order }, 0];
        },
      },
      heading: {
        group: "block",
        content: "inline*",
        attrs: { level: { default: 1 } },
        toDOM(node) {
          return ["h" + node.attrs.level, 0];
        },
      },
      codeBlock: {
        group: "block",
        content: "text*",
        marks: "",
        code: true,
        toDOM() {
          return ["pre", ["code", 0]];
        },
      },
      horizontalRule: {
        group: "block",
        toDOM() {
          return ["hr"];
        },
      },
      hardBreak: {
        inline: true,
        group: "inline",
        selectable: false,
        toDOM() {
          return ["br"];
        },
      },
      image: {
        inline: true,
        group: "inline",
        attrs: {
          src: { default: "" },
          alt: { default: "" },
          title: { default: null },
          originalFilename: { default: null },
        },
        toDOM(node) {
          return ["img", node.attrs];
        },
      },
      mfeMarker: {
        group: "block",
        atom: true,
        attrs: { name: { default: "" } },
        toDOM(node) {
          return ["div", { "data-mfe-marker": node.attrs.name }];
        },
      },
      text: { group: "inline" },
    },
    marks: {
      bold: {
        toDOM() {
          return ["strong", 0];
        },
      },
      italic: {
        toDOM() {
          return ["em", 0];
        },
      },
      code: {
        toDOM() {
          return ["code", 0];
        },
      },
      strike: {
        toDOM() {
          return ["s", 0];
        },
      },
      underline: {
        toDOM() {
          return ["u", 0];
        },
      },
      superscript: {
        toDOM() {
          return ["sup", 0];
        },
      },
      subscript: {
        toDOM() {
          return ["sub", 0];
        },
      },
      link: {
        attrs: { href: {} },
        toDOM(mark) {
          return ["a", { href: mark.attrs.href }, 0];
        },
      },
    },
  });
}

describe("serializer immutability", () => {
  test("per-call serializer isolates external mutation", () => {
    const schema = createSchemaA();
    const parser = createMarkdownParser(schema);
    const doc = parser.parse("**bold**");
    const first = serializeMarkdownDoc(doc);

    expect(Object.isFrozen(markdownSerializer)).toBe(true);
    try {
      markdownSerializer.marks.bold.open = "!!";
    } catch (_error) {}
    try {
      markdownSerializer.nodes.heading = null;
    } catch (_error) {}

    const second = serializeMarkdownDoc(doc);
    expect(second).toBe(first);

    const s1 = createMarkdownSerializer(schema);
    const s2 = createMarkdownSerializer(schema);
    expect(s1).not.toBe(s2);
    s1.marks.bold.open = "XX";

    expect(serializeMarkdownDoc(doc)).toBe(first);
  });

  test("cross-schema serializer instances stay isolated", () => {
    const schemaA = createSchemaA();
    const schemaB = createSchemaB();

    const docA = createMarkdownParser(schemaA).parse("**bold**");
    const docB = createMarkdownParser(schemaB).parse("plain");

    const outA = serializeMarkdownDoc(docA);
    const outB = serializeMarkdownDoc(docB);

    const serializerA = createMarkdownSerializer(schemaA);
    const serializerB = createMarkdownSerializer(schemaB);

    expect(serializerA).not.toBe(serializerB);
    serializerA.marks.bold.open = "!!";

    expect(serializeMarkdownDoc(docA)).toBe(outA);
    expect(serializeMarkdownDoc(docB)).toBe(outB);
  });
});
