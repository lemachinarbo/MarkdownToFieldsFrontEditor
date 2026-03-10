/** @jest-environment jsdom */

import { Editor, getSchema } from "@tiptap/core";
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

function createEditor() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        bold: false,
        italic: false,
        codeBlock: true,
        link: false,
        underline: false,
      }),
      MarkerAwareBold,
      MarkerAwareItalic,
    ],
    content: "<p>Focus text</p>",
  });

  return {
    editor,
    destroy() {
      editor.destroy();
      host.remove();
    },
  };
}

describe("markdown emphasis delimiter preservation", () => {
  afterEach(() => {
    delete window.MarkdownFrontEditorConfig;
  });

  test("preserves per-mark bold and italic delimiters on round-trip", () => {
    const schema = buildSchema();
    const input = "__bold__ **bold** *italic* _italic_ ~~strike~~ `inline code`";

    const doc = parseMarkdownToDoc(input, schema);
    const output = serializeMarkdownDoc(doc);

    expect(output).toBe(input);
  });

  test("toolbar-created marks use asterisk defaults when configured", () => {
    window.MarkdownFrontEditorConfig = {
      defaultEmphasisStyle: "asterisk",
    };
    const fixture = createEditor();

    try {
      fixture.editor.commands.selectAll();
      fixture.editor.commands.toggleBold();
      fixture.editor.commands.toggleItalic();

      expect(serializeMarkdownDoc(fixture.editor.state.doc)).toBe(
        "***Focus text***",
      );
    } finally {
      fixture.destroy();
    }
  });

  test("toolbar-created marks use underscore defaults when configured", () => {
    window.MarkdownFrontEditorConfig = {
      defaultEmphasisStyle: "underscore",
    };
    const fixture = createEditor();

    try {
      fixture.editor.commands.selectAll();
      fixture.editor.commands.toggleBold();
      fixture.editor.commands.toggleItalic();

      expect(serializeMarkdownDoc(fixture.editor.state.doc)).toBe(
        "___Focus text___",
      );
    } finally {
      fixture.destroy();
    }
  });
});
