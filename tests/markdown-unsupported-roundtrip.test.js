import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Marker, GapSentinel } from "../src/marker-extension.js";
import {
  MarkerAwareBulletList,
  MarkerAwareTaskList,
} from "../src/editor-tiptap-extensions.js";
import {
  parseMarkdownToDoc,
  serializeMarkdownDoc,
  trimTrailingLineBreaks,
} from "../src/editor-core.js";

function buildSchema() {
  return getSchema([
    StarterKit.configure({
      codeBlock: true,
      link: false,
      bulletList: false,
    }),
    Link.configure({
      openOnClick: false,
      linkOnPaste: true,
    }),
    MarkerAwareBulletList,
    MarkerAwareTaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ]);
}

function buildSchemaWithMarker() {
  return getSchema([
    StarterKit.configure({
      codeBlock: true,
      link: false,
      bulletList: false,
    }),
    Link.configure({
      openOnClick: false,
      linkOnPaste: true,
    }),
    MarkerAwareBulletList,
    MarkerAwareTaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Marker,
    GapSentinel,
  ]);
}

describe("unsupported markdown roundtrip preservation", () => {
  test("footnote-like syntax is preserved as canonical markdown tokens", () => {
    const schema = buildSchema();
    const markdown = ["Footnote[^1]", "", "[^1]: note"].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(serialized).not.toContain("Footnote[^1](note)");
    expect(serialized).toContain("Footnote[^1]");
    expect(serialized).toContain("[^1]: note");
    expect(serialized).not.toContain("\\[^1\\]");
  });

  test("inline-style footnote syntax is preserved as plain markdown token", () => {
    const schema = buildSchema();
    const markdown =
      "Inline style footnote^[This appears inline in some parsers.]";

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(serialized).toContain("^[This appears inline in some parsers.]");
  });

  test("escaped task-list checkboxes keep task syntax and escaped footnotes", () => {
    const schema = buildSchema();
    const markdown = [
      "- [x] task done",
      "- [ ] task todo",
      "",
      "[^1]: First note.",
      "[^2]: Second note.",
    ].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(serialized).toMatch(/^[*-] \[x\] task done$/m);
    expect(serialized).toMatch(/^[*-] \[ \] task todo$/m);
    expect(serialized).not.toContain("\\[x\\] task done");
    expect(serialized).not.toContain("\\[ \\] task todo");
    expect(serialized).toContain("[^1]: First note.");
    expect(serialized).toContain("[^2]: Second note.");
  });

  test("multiple footnote refs remain canonical without hardbreak normalization", () => {
    const schema = buildSchema();
    const markdown = [
      "Footnote[^1]",
      "",
      "Multiple refs[^1][^2]",
      "[^1]: First note.",
      "[^2]: Second note.",
    ].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(serialized).toContain("Footnote[^1]");
    expect(serialized).toContain("Multiple refs[^1][^2]");
    expect(serialized).toContain("[^1]: First note.");
    expect(serialized).toContain("[^2]: Second note.");
    expect(serialized).not.toContain("  \n");
  });

  test("unordered list marker style roundtrips with plus markers", () => {
    const schema = buildSchema();
    const markdown = ["+ first", "+ second", "+ third"].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(trimTrailingLineBreaks(serialized)).toBe(markdown);
  });

  test("task list marker style roundtrips with plus markers", () => {
    const schema = buildSchema();
    const markdown = ["+ [x] done", "+ [ ] todo"].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(trimTrailingLineBreaks(serialized)).toBe(markdown);
  });

  test("task-list markdown parses as task nodes and preserves checkbox syntax", () => {
    const schema = buildSchema();
    const markdown = ["- [x] done", "- [ ] todo"].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    const firstNode = doc.child(0);
    expect(firstNode.type.name).toBe("taskList");
    expect(firstNode.child(0).type.name).toBe("taskItem");
    expect(firstNode.child(0).attrs.checked).toBe(true);
    expect(firstNode.child(1).attrs.checked).toBe(false);
    expect(trimTrailingLineBreaks(serialized)).toBe(markdown);
    expect(serialized).toContain("- [x] done");
    expect(serialized).toContain("- [ ] todo");
  });

  test("escaped task-list checkbox syntax is preserved as plain markdown", () => {
    const schema = buildSchema();
    const markdown = ["* \\[x\\] task done", "* \\[ \\] task todo"].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    const firstNode = doc.child(0);
    expect(firstNode.type.name).toBe("bulletList");
    expect(firstNode.child(0).type.name).toBe("listItem");
    expect(serialized).toContain("* \\[x\\] task done");
    expect(serialized).toContain("* \\[ \\] task todo");
  });

  test("table markdown parses as table nodes and serializes as pipe table", () => {
    const schema = buildSchema();
    const markdown = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 |",
    ].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    const firstNode = doc.child(0);
    expect(firstNode.type.name).toBe("table");
    expect(firstNode.child(0).type.name).toBe("tableRow");
    expect(firstNode.child(0).child(0).type.name).toBe("tableHeader");
    expect(firstNode.child(1).child(0).type.name).toBe("tableCell");
    expect(serialized).toContain("| A   | B   |");
    expect(serialized).toContain("| --- | --- |");
    expect(serialized).toContain("| 1   | 2   |");
  });

  test("single-dash table delimiter row is normalized and parsed as table", () => {
    const schema = buildSchema();
    const markdown = ["A | B", "- | -", "1 | 2"].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    const firstNode = doc.child(0);
    expect(firstNode.type.name).toBe("table");
    expect(serialized).toContain("| A   | B   |");
    expect(serialized).toContain("| --- | --- |");
    expect(serialized).toContain("| 1   | 2   |");
  });

  test("fenced code keeps language and does not gain blank line before close", () => {
    const schema = buildSchema();
    const markdown = ["```js", "const x = 1;", "```"].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(trimTrailingLineBreaks(serialized)).toBe(markdown);
    expect(serialized).not.toContain("const x = 1;\n\n```");
  });

  test("tab-indented nested list serializes with canonical spaces", () => {
    const schema = buildSchema();
    const markdown = ["- parent", "\t- child"].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(serialized).toMatch(/^[*-] parent$/m);
    expect(serialized).toMatch(/^  [*-] child$/m);
    expect(serialized).not.toContain("\t- child");
  });

  test("mfe marker comments do not crash parse when schema lacks marker node", () => {
    const schema = buildSchema();
    const markdown = [
      "<!-- section:columns -->",
      "",
      "- [x] task done",
      "- [ ] task todo",
    ].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(doc.childCount).toBeGreaterThan(0);
    expect(serialized).toContain("- [x] task done");
    expect(serialized).toContain("- [ ] task todo");
  });

  test("mfe marker comments parse as marker node when schema includes marker", () => {
    const schema = buildSchemaWithMarker();
    const markdown = ["<!-- section:columns -->", "", "- [x] task done"].join(
      "\n",
    );

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    expect(doc.child(0).type.name).toBe("mfeMarker");
    expect(serialized).toContain("<!-- section:columns -->");
    expect(serialized).toContain("- [x] task done");
  });

  test("marker line after paragraph is parsed as marker block without blank separator", () => {
    const schema = buildSchemaWithMarker();
    const markdown = [
      "We grow food and ideas in the city.",
      "<!-- section:columns -->",
      "### What we grow",
    ].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const nodeNames = [];
    doc.forEach((node) => nodeNames.push(node.type.name));

    expect(nodeNames).toEqual(["paragraph", "mfeMarker", "heading"]);
    expect(doc.child(0).textContent).toBe("We grow food and ideas in the city.");
  });

  test("marker and mfe-gap lines after paragraph stay structural nodes", () => {
    const schema = buildSchemaWithMarker();
    const markdown = [
      "We grow food and ideas in the city.",
      "<!-- section:columns -->",
      "<!-- mfe-gap:1 -->",
      "<!-- sub:left -->",
      "### What we grows",
    ].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const nodeNames = [];
    doc.forEach((node) => nodeNames.push(node.type.name));

    expect(nodeNames).toEqual([
      "paragraph",
      "mfeMarker",
      "mfeGap",
      "mfeMarker",
      "heading",
    ]);
    expect(doc.child(2).attrs.lineCount).toBe(1);
    expect(doc.child(0).textContent).toBe("We grow food and ideas in the city.");
  });

  test("marker boundary A: adjacent markers preserve zero blank lines", () => {
    const schema = buildSchemaWithMarker();
    const markdown = ["<!-- section:alpha -->", "<!-- /section:alpha -->"].join(
      "\n",
    );

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    const nodeNames = [];
    doc.forEach((node) => nodeNames.push(node.type.name));

    expect(nodeNames).toEqual(["mfeMarker", "mfeMarker"]);
    expect(trimTrailingLineBreaks(serialized)).toBe(markdown);
  });

  test("marker boundary B: one blank line roundtrips via mfeGap lineCount=1", () => {
    const schema = buildSchemaWithMarker();
    const markdown = [
      "<!-- section:alpha -->",
      "",
      "<!-- /section:alpha -->",
    ].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    const nodes = [];
    doc.forEach((node) => nodes.push(node));

    expect(nodes.map((node) => node.type.name)).toEqual([
      "mfeMarker",
      "mfeGap",
      "mfeMarker",
    ]);
    expect(nodes[1].attrs.lineCount).toBe(1);
    expect(trimTrailingLineBreaks(serialized)).toBe(markdown);
  });

  test("marker boundary C: two blank lines roundtrip via mfeGap lineCount=2", () => {
    const schema = buildSchemaWithMarker();
    const markdown = [
      "<!-- section:alpha -->",
      "",
      "",
      "<!-- /section:alpha -->",
    ].join("\n");

    const doc = parseMarkdownToDoc(markdown, schema);
    const serialized = serializeMarkdownDoc(doc);

    const nodes = [];
    doc.forEach((node) => nodes.push(node));

    expect(nodes.map((node) => node.type.name)).toEqual([
      "mfeMarker",
      "mfeGap",
      "mfeMarker",
    ]);
    expect(nodes[1].attrs.lineCount).toBe(2);
    expect(trimTrailingLineBreaks(serialized)).toBe(markdown);
  });
});
