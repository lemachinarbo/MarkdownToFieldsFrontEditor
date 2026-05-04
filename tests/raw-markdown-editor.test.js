/** @jest-environment jsdom */

import { createRawMarkdownEditor } from "../src/raw-markdown-editor.js";

describe("raw markdown editor", () => {
  test("highlights frontmatter, markers, and only markdown destinations", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const editor = createRawMarkdownEditor({
      parent,
      value: [
        "---",
        "title: Hello",
        "---",
        "",
        "<!-- section:hero -->",
        "<!-- title -->",
        "[From](/en/boo/)",
        "![Moon](moon.png)",
      ].join("\n"),
    });

    const frontmatterText = Array.from(
      parent.querySelectorAll(".cm-mfe-frontmatter"),
    )
      .map((element) => element.textContent)
      .join("\n");
    expect(frontmatterText).toContain("---");
    expect(frontmatterText).toContain("title: Hello");

    const structuralMarkers = Array.from(
      parent.querySelectorAll(".cm-mfe-structural-marker"),
    ).map((element) => element.textContent);
    expect(structuralMarkers).toContain("<!-- section:hero -->");

    const fieldMarkers = Array.from(
      parent.querySelectorAll(".cm-mfe-field-marker"),
    ).map((element) => element.textContent);
    expect(fieldMarkers).toContain("<!-- title -->");

    const linkTargets = Array.from(
      parent.querySelectorAll(".cm-mfe-link-syntax"),
    ).map((element) => element.textContent);
    expect(linkTargets).toContain("/en/boo/");
    expect(linkTargets).not.toContain("[From]");
    expect(linkTargets).not.toContain("(/en/boo/)");

    const imageTargets = Array.from(
      parent.querySelectorAll(".cm-mfe-image-syntax"),
    ).map((element) => element.textContent);
    expect(imageTargets).toContain("moon.png");
    expect(imageTargets).not.toContain("![Moon]");

    editor.destroy();
    parent.remove();
  });
});
