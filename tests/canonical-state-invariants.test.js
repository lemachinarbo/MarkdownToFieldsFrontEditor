import {
  computeCanonicalMarkdownStateFromInputs,
  resolveMarkdownForScopeFromCanonical,
} from "../src/canonical-state.js";

function parseMarkers(markdown) {
  const text = String(markdown || "");
  const markerRegex = /^\s*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->\s*$/gm;
  const markers = [];
  let match;
  while ((match = markerRegex.exec(text))) {
    markers.push({ marker: match[1], start: match.index });
  }
  return markers;
}

describe("canonical state invariants", () => {
  test("field overrides section overrides document", () => {
    const configDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# doc",
      "",
      "<!-- intro... -->",
      "Intro",
    ].join("\n");

    const documentDraft = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# da",
      "",
      "<!-- intro... -->",
      "Intro",
    ].join("\n");

    const sectionOverlay = [
      "<!-- title -->",
      "# sec",
      "",
      "<!-- intro... -->",
      "Intro",
    ].join("\n");

    const state = computeCanonicalMarkdownStateFromInputs({
      documentDraft,
      configDocument,
      scopedDraftEntries: [
        ["section:hero", sectionOverlay],
        ["field:hero:title", "# field"],
      ],
    });

    expect(state.markdown).toContain("# field");
    expect(state.markdown).not.toContain("# sec");
    expect(state.markdown).not.toContain("# da");
  });

  test("overlay referencing missing key auto-vivifies section", () => {
    const configDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# foo",
    ].join("\n");

    const state = computeCanonicalMarkdownStateFromInputs({
      documentDraft: "",
      configDocument,
      scopedDraftEntries: [["section:missing", "<!-- title -->\n# bad"]],
    });
    
    expect(state.markdown).toContain("<!-- section:missing -->");
    expect(state.markdown).toContain("# bad");
  });

  test("same-rank collision throws", () => {
    const configDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# foo",
    ].join("\n");

    expect(() =>
      computeCanonicalMarkdownStateFromInputs({
        documentDraft: "",
        configDocument,
        scopedDraftEntries: [
          ["field:hero:title", "# one"],
          ["field:hero:title", "# two"],
        ],
      }),
    ).toThrow(/same-rank collision/);
  });

  test("determinism: identical inputs produce identical bytes", () => {
    const configDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# foo",
      "",
      "<!-- intro... -->",
      "Intro",
    ].join("\n");

    const input = {
      documentDraft: "",
      configDocument,
      scopedDraftEntries: [["field:hero:title", "# za"]],
    };

    const first = computeCanonicalMarkdownStateFromInputs(input);
    const second = computeCanonicalMarkdownStateFromInputs(input);

    expect(first.markdown).toBe(second.markdown);
    expect(JSON.stringify(first.applied)).toBe(JSON.stringify(second.applied));
  });

  test("root scoped entry key is valid for document-level draft slot", () => {
    const configDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# foo",
    ].join("\n");

    expect(() =>
      computeCanonicalMarkdownStateFromInputs({
        documentDraft: "",
        configDocument,
        scopedDraftEntries: [["", "# doc-root"]],
      }),
    ).not.toThrow();
  });

  test("structural integrity: marker topology and ordering preserved", () => {
    const configDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# foo",
      "",
      "<!-- intro... -->",
      "Intro",
      "",
      "<!-- section:body -->",
      "Body",
    ].join("\n");

    const state = computeCanonicalMarkdownStateFromInputs({
      documentDraft: "",
      configDocument,
      scopedDraftEntries: [["field:hero:title", "# za"]],
    });

    const markers = parseMarkers(state.markdown);
    const markerNames = markers.map((item) => item.marker);

    expect(markerNames).toEqual([
      "section:hero",
      "title",
      "intro...",
      "section:body",
    ]);

    const unique = new Set(markerNames);
    expect(unique.size).toBe(markerNames.length);

    for (let index = 1; index < markers.length; index += 1) {
      expect(markers[index].start).toBeGreaterThan(markers[index - 1].start);
    }
  });

  test("field resolution allows empty subsection when match is unique", () => {
    const markdown = [
      "<!-- section:hero -->",
      "",
      "<!-- sub:lead -->",
      "",
      "<!-- intro -->",
      "Hello world",
    ].join("\n");

    const resolved = resolveMarkdownForScopeFromCanonical({
      markdown,
      scope: "field",
      section: "hero",
      subsection: "",
      name: "intro",
    });

    expect(resolved).toBe("Hello world");
  });

  test("field resolution treats container marker ellipsis as same identity", () => {
    const markdown = [
      "<!-- section:hero -->",
      "",
      "<!-- intro... -->",
      "Container body",
    ].join("\n");

    const resolved = resolveMarkdownForScopeFromCanonical({
      markdown,
      scope: "field",
      section: "hero",
      subsection: "",
      name: "intro",
    });

    expect(resolved).toBe("Container body");
  });

  test("field overlay key without ellipsis applies to container marker", () => {
    const configDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- intro... -->",
      "Original",
    ].join("\n");

    const state = computeCanonicalMarkdownStateFromInputs({
      documentDraft: "",
      configDocument,
      scopedDraftEntries: [["field:hero:intro", "Updated"]],
    });

    expect(state.markdown).toContain("<!-- intro... -->\nUpdated");
  });

  test("field resolution throws on empty-subsection ambiguity", () => {
    const markdown = [
      "<!-- section:hero -->",
      "",
      "<!-- sub:one -->",
      "",
      "<!-- intro -->",
      "First",
      "",
      "<!-- sub:two -->",
      "",
      "<!-- intro -->",
      "Second",
    ].join("\n");

    expect(() =>
      resolveMarkdownForScopeFromCanonical({
        markdown,
        scope: "field",
        section: "hero",
        subsection: "",
        name: "intro",
      }),
    ).toThrow(/ambiguous field scope/);
  });

  test("field resolution prefers section-level field over subsection homonyms", () => {
    const markdown = [
      "<!-- section:methods -->",
      "",
      "<!-- title -->",
      "Section level",
      "",
      "<!-- sub:one -->",
      "",
      "<!-- title -->",
      "Sub one",
      "",
      "<!-- sub:two -->",
      "",
      "<!-- title -->",
      "Sub two",
    ].join("\n");

    const resolved = resolveMarkdownForScopeFromCanonical({
      markdown,
      scope: "field",
      section: "methods",
      subsection: "",
      name: "title",
    });

    expect(resolved).toBe("Section level");
  });

  test("section overlay with only descendant markers resolves as section body", () => {
    const configDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# doc",
      "",
      "<!-- intro... -->",
      "Intro",
      "",
      "<!-- section:body -->",
      "Body",
    ].join("\n");

    const sectionOverlay = [
      "<!-- title -->",
      "# Updated",
      "",
      "<!-- intro... -->",
      "Updated intro",
    ].join("\n");

    const state = computeCanonicalMarkdownStateFromInputs({
      documentDraft: "",
      configDocument,
      scopedDraftEntries: [["section:hero", sectionOverlay]],
    });

    expect(state.markdown).toContain("# Updated");
    expect(state.markdown).toContain("Updated intro");
    expect(state.applied.map((entry) => entry.key)).toEqual(["section:hero"]);
  });

  test("subsection overlay with sub marker and no section marker resolves", () => {
    const configDocument = [
      "<!-- section:columns -->",
      "",
      "<!-- sub:left -->",
      "",
      "### What we grow",
      "",
      "Old left",
      "",
      "<!-- sub:right -->",
      "",
      "Right body",
    ].join("\n");

    const subsectionOverlay = [
      "<!-- sub:left -->",
      "",
      "### What we grow",
      "",
      "Updated left",
    ].join("\n");

    const state = computeCanonicalMarkdownStateFromInputs({
      documentDraft: "",
      configDocument,
      scopedDraftEntries: [["subsection:columns:left", subsectionOverlay]],
    });

    expect(state.markdown).toContain("Updated left");
    expect(state.markdown).not.toContain("Old left");
    expect(state.applied.map((entry) => entry.key)).toEqual([
      "subsection:columns:left",
    ]);
  });
});
