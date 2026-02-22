/** @jest-environment jsdom */

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Marker } from "../src/marker-extension.js";
import {
  getMarkdownFromEditor,
  stripMfeMarkersForFieldScope,
} from "../src/editor-shared-helpers.js";
import {
  parseMarkdownToDoc,
  trimTrailingLineBreaks,
} from "../src/editor-core.js";

function createFullscreenLikeEditor() {
  const host = document.createElement("div");
  document.body.appendChild(host);

  const editor = new Editor({
    element: host,
    extensions: [StarterKit, Marker],
    content: "",
  });

  return {
    editor,
    destroy() {
      editor.destroy();
      host.remove();
    },
  };
}

function extractFenceBlocks(markdown) {
  return String(markdown || "").match(/```[\s\S]*?```/g) || [];
}

function countInnerBlankLinesInFence(fence) {
  const lines = String(fence || "").split("\n");
  if (lines.length <= 2) return 0;
  return lines.slice(1, -1).filter((line) => line.trim() === "").length;
}

function saveRehydrateCycle(editor, markdown) {
  const outbound = trimTrailingLineBreaks(
    stripMfeMarkersForFieldScope(markdown),
  );
  const doc = parseMarkdownToDoc(outbound, editor.schema);
  editor.commands.setContent(doc.toJSON(), false);
  return getMarkdownFromEditor(editor);
}

describe("Code fence stability across save/rehydrate cycles", () => {
  test("repeated fullscreen-like cycles do not accumulate fence blank lines", () => {
    const fixture = createFullscreenLikeEditor();
    const { editor } = fixture;
    const cases = [
      ["```", "Hello", "", "```", "", "Hola"].join("\n"),
      ["<!-- intro... -->", "", "```", "Hello", "", "```", "", "Holas"].join(
        "\n",
      ),
      [
        "- item one",
        "- item two",
        "",
        "```",
        "const x = 1",
        "",
        "```",
        "",
        "After",
      ].join("\n"),
    ];

    try {
      cases.forEach((input) => {
        let current = input;
        let baseline = "";
        let baselineFenceBlankCounts = [];

        for (let i = 0; i < 5; i += 1) {
          current = saveRehydrateCycle(editor, current);
          const fences = extractFenceBlocks(current);
          const blankCounts = fences.map(countInnerBlankLinesInFence);

          if (i === 0) {
            baseline = current;
            baselineFenceBlankCounts = blankCounts;
            continue;
          }

          expect(current).toBe(baseline);
          expect(blankCounts).toEqual(baselineFenceBlankCounts);
        }
      });
    } finally {
      fixture.destroy();
    }
  });
});
