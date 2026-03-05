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

function getParentScopeKey(scopeKey) {
  const key = String(scopeKey || "").trim();
  if (!key) return "";
  if (key.startsWith("section:")) return "";
  if (key.startsWith("subsection:")) {
    const parts = key.split(":");
    if (parts.length === 3) return `section:${parts[1] || ""}`;
    if (parts.length >= 4)
      return `subsection:${parts[1] || ""}:${parts[2] || ""}`;
  }
  if (key.startsWith("field:")) {
    const parts = key.split(":");
    if (parts.length >= 3) return `section:${parts[1] || ""}`;
  }
  return "";
}

function hasDescendantScopedCandidate(scopeKey, allKeys) {
  const current = String(scopeKey || "");
  if (!current) return false;
  for (const candidate of allKeys) {
    const next = String(candidate || "");
    if (!next || next === current) continue;
    let parent = getParentScopeKey(next);
    while (parent) {
      if (parent === current) return true;
      parent = getParentScopeKey(parent);
    }
  }
  return false;
}

function composeDocumentMarkdownFromScopedDrafts(baseMarkdown, candidatesMap) {
  let composed = typeof baseMarkdown === "string" ? baseMarkdown : "";
  const candidates = candidatesMap instanceof Map ? candidatesMap : new Map();
  if (!candidates.size) return composed;

  const keys = Array.from(candidates.keys()).filter(Boolean);
  const filteredKeys = keys.filter(
    (key) => !hasDescendantScopedCandidate(key, keys),
  );

  filteredKeys.forEach((scopeKey) => {
    const nextMarkdown = candidates.get(scopeKey);
    if (typeof nextMarkdown !== "string") return;
    const currentMarkdown = candidates.get(`base:${scopeKey}`) || "";
    if (!currentMarkdown || currentMarkdown === nextMarkdown) return;
    const updated = replaceUniqueBlockInText(
      composed,
      currentMarkdown,
      nextMarkdown,
    );
    if (updated !== null) composed = updated;
  });

  return composed;
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

function parseMarkdownMarkersWithRanges(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  const markerRegex = /^\s*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->\s*$/gm;
  const markers = [];
  let match;

  while ((match = markerRegex.exec(text))) {
    const marker = match[1] || "";
    const markerStart = match.index;
    const markerEnd = markerRegex.lastIndex;

    let lineEnd = text.indexOf("\n", markerEnd);
    if (lineEnd === -1) {
      lineEnd = text.length;
    } else {
      lineEnd += 1;
    }

    markers.push({
      marker,
      start: markerStart,
      afterLine: lineEnd,
    });
  }

  return markers;
}

function extractScopedMarkdownFromDocument({
  markdown,
  scope,
  section,
  subsection,
  name,
}) {
  const text = typeof markdown === "string" ? markdown : "";
  if (!text) return null;

  const markers = parseMarkdownMarkersWithRanges(text);
  if (!markers.length) return null;

  const wantedScope = String(scope || "field");
  const wantedSection = String(section || "");
  const wantedSubsection = String(subsection || "");
  const wantedName = String(name || "");
  const hasSectionMarkers = markers.some((entry) =>
    String(entry?.marker || "").startsWith("section:"),
  );

  let currentSection = "";
  let currentSubsection = "";

  for (let index = 0; index < markers.length; index += 1) {
    const current = markers[index];
    const markerName = current.marker;

    if (markerName.startsWith("section:")) {
      currentSection = markerName.slice("section:".length);
      currentSubsection = "";
    } else if (markerName.startsWith("sub:")) {
      currentSubsection = markerName.slice("sub:".length);
    } else if (markerName.startsWith("subsection:")) {
      currentSubsection = markerName.slice("subsection:".length);
    }

    let matches = false;
    if (wantedScope === "section") {
      matches = markerName === `section:${wantedName || wantedSection}`;
    } else if (wantedScope === "subsection") {
      const expectedSection = wantedSection;
      const expectedSub = wantedName || wantedSubsection;
      matches =
        currentSection === expectedSection &&
        (markerName === `sub:${expectedSub}` ||
          markerName === `subsection:${expectedSub}`);
    } else if (wantedScope === "field") {
      const directScopedMatch =
        markerName === wantedName &&
        currentSection === wantedSection &&
        currentSubsection === wantedSubsection;
      const sectionFragmentMatch =
        !hasSectionMarkers &&
        markerName === wantedName &&
        currentSubsection === wantedSubsection;
      matches = directScopedMatch || sectionFragmentMatch;
    }

    if (!matches) continue;

    let end = text.length;
    for (
      let nextIndex = index + 1;
      nextIndex < markers.length;
      nextIndex += 1
    ) {
      const nextMarker = markers[nextIndex].marker;
      if (wantedScope === "section") {
        if (nextMarker.startsWith("section:")) {
          end = markers[nextIndex].start;
          break;
        }
      } else if (wantedScope === "subsection") {
        if (
          nextMarker.startsWith("section:") ||
          nextMarker.startsWith("sub:") ||
          nextMarker.startsWith("subsection:")
        ) {
          end = markers[nextIndex].start;
          break;
        }
      } else {
        end = markers[nextIndex].start;
        break;
      }
    }

    return text.slice(current.afterLine, end).replace(/(?:\r?\n)+$/, "");
  }

  return null;
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

  test("document unsaved edits travel to field scope (text + image)", () => {
    const originalDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "Promo ~~Old~~ ![hero](old.jpg)",
      "",
      "<!-- section:body -->",
      "Body text",
    ].join("\n");

    const unsavedDocument = originalDocument.replace(
      "Promo ~~Old~~ ![hero](old.jpg)",
      "Promo ~~New~~ ![hero](new.jpg)",
    );

    const fieldMarkdown = extractScopedMarkdownFromDocument({
      markdown: unsavedDocument,
      scope: "field",
      section: "hero",
      subsection: "",
      name: "title",
    });

    expect(fieldMarkdown).toContain("~~New~~");
    expect(fieldMarkdown).toContain("![hero](new.jpg)");

    const { reparsedDoc } = roundTrip(fieldMarkdown, schema);
    const json = reparsedDoc.toJSON();
    const imageSources = collectImageSources(json);

    expect(findTextWithMark(json, "strike")).toBe(true);
    expect(imageSources).toContain("new.jpg");
  });

  test("document unsaved edits travel to subsection and section scopes", () => {
    const originalDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- sub:left -->",
      "### Left",
      "- Item A",
      "![left](left-old.jpg)",
      "",
      "<!-- sub:right -->",
      "### Right",
      "- Item B",
      "",
      "<!-- section:body -->",
      "Body text",
    ].join("\n");

    const unsavedDocument = originalDocument
      .replace("- Item A", "- Item A updated")
      .replace("![left](left-old.jpg)", "![left](left-new.jpg)")
      .replace("### Right", "### Right updated");

    const subsectionMarkdown = extractScopedMarkdownFromDocument({
      markdown: unsavedDocument,
      scope: "subsection",
      section: "hero",
      subsection: "",
      name: "left",
    });
    expect(subsectionMarkdown).toContain("Item A updated");
    expect(subsectionMarkdown).toContain("left-new.jpg");

    const sectionMarkdown = extractScopedMarkdownFromDocument({
      markdown: unsavedDocument,
      scope: "section",
      section: "",
      subsection: "",
      name: "hero",
    });
    expect(sectionMarkdown).toContain("Item A updated");
    expect(sectionMarkdown).toContain("left-new.jpg");
    expect(sectionMarkdown).toContain("Right updated");
  });

  test("section unsaved edits travel down to field scope", () => {
    const sectionDraftMarkdown = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "Promo ~~New~~ ![hero](new.jpg)",
      "",
      "<!-- intro... -->",
      "Intro text",
    ].join("\n");

    const fieldMarkdown = extractScopedMarkdownFromDocument({
      markdown: sectionDraftMarkdown,
      scope: "field",
      section: "hero",
      subsection: "",
      name: "title",
    });

    expect(fieldMarkdown).toContain("~~New~~");
    expect(fieldMarkdown).toContain("![hero](new.jpg)");

    const { reparsedDoc } = roundTrip(fieldMarkdown, schema);
    const json = reparsedDoc.toJSON();
    const imageSources = collectImageSources(json);

    expect(findTextWithMark(json, "strike")).toBe(true);
    expect(imageSources).toContain("new.jpg");
  });

  test("section fragment without section marker still resolves title field", () => {
    const sectionFragment = [
      "<!-- title -->",
      "tedty",
      "",
      "<!-- intro... -->",
      "Intro text",
    ].join("\n");

    const fieldMarkdown = extractScopedMarkdownFromDocument({
      markdown: sectionFragment,
      scope: "field",
      section: "hero",
      subsection: "",
      name: "title",
    });

    expect(fieldMarkdown).toBe("tedty");
  });

  test("field draft beats stale section draft when composing projected document", () => {
    const baseDocument = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# foo",
      "",
      "<!-- intro... -->",
      "Intro text",
    ].join("\n");

    const staleSection = [
      "<!-- title -->",
      "# da",
      "",
      "<!-- intro... -->",
      "Intro text",
    ].join("\n");

    const freshField = "# za";

    const projected = composeDocumentMarkdownFromScopedDrafts(
      baseDocument,
      new Map([
        ["section:hero", staleSection],
        [
          "base:section:hero",
          [
            "<!-- title -->",
            "# foo",
            "",
            "<!-- intro... -->",
            "Intro text",
          ].join("\n"),
        ],
        ["field:hero:title", freshField],
        ["base:field:hero:title", "# foo"],
      ]),
    );

    const fieldMarkdown = extractScopedMarkdownFromDocument({
      markdown: projected,
      scope: "field",
      section: "hero",
      subsection: "",
      name: "title",
    });

    expect(fieldMarkdown).toBe("# za");
  });
});
