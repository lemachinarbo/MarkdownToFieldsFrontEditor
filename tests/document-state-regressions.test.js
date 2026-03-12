import { createScopeSession, doesScopeSessionMatch } from "../src/scope-session.js";
import {
  assertStructuralMarkerGraphEqual,
  parseStructuralDocument,
} from "../src/structural-document.js";
import { applyScopedEdit } from "../src/mutation-plan.js";
import {
  projectCanonicalSlice,
  resolveCanonicalScopeSlice,
} from "../src/canonical-scope-session.js";
import { renderMarkdownToHtml } from "../src/editor-core.js";

const BASE_CANONICAL = [
  "<!-- section:hero -->",
  "",
  "<!-- title -->",
  "# The Urban <br>Farm",
  "",
  "<!-- intro... -->",
  "We grow food and ideas in the city. From rooftop gardens to indoor farms, we craft systems that actually produce. We work where soil, design, and tech collide.",
  "",
  "<!-- section:columns -->",
  "",
  "<!-- sub:left -->",
  "### What we grow",
  "",
  "- Leafy greens",
  "- Mushrooms and sprouts",
  "",
  "<!-- sub:right -->",
  "### How we work",
  "",
  "We prototype and ship quickly.",
  "",
  "<!-- section:body -->",
  "",
  "<!-- predictable -->",
  "Every _plot_ starts _small_. Every harvest stays **predictable**.",
].join("\n");

function applyScoped({ canonicalBody, scopeMeta, editorContent, runtimeProjection = null }) {
  const session = createScopeSession({
    stateId: "session:v2|en",
    lang: "en",
    originKey: "field:hero:title",
    scopeMeta,
  });
  return applyScopedEdit({
    session,
    structuralDocument: parseStructuralDocument(canonicalBody),
    editorContent,
    runtimeProjection,
  });
}

describe("v2 behavior regressions", () => {
  test("save blocks when scope session does not match target scope", () => {
    const locked = createScopeSession({
      stateId: "session:v2|en",
      lang: "en",
      originKey: "field:hero:title",
      scopeMeta: {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
      },
    });

    const attempted = {
      scopeKind: "field",
      section: "hero",
      subsection: "",
      name: "intro",
    };

    expect(doesScopeSessionMatch(locked, attempted)).toBe(false);
  });

  test("marker graph is stable across field/subsection/section/document edits", () => {
    const afterField = applyScoped({
      canonicalBody: BASE_CANONICAL,
      scopeMeta: {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
      },
      editorContent: "# The Urban <br>Farms",
    });
    expect(afterField.ok).toBe(true);

    const subsectionMeta = {
      scopeKind: "subsection",
      section: "columns",
      subsection: "right",
      name: "right",
    };
    const subsectionSlice = resolveCanonicalScopeSlice(
      afterField.canonicalBody,
      subsectionMeta,
    );
    const subsectionProjection = projectCanonicalSlice(subsectionSlice);
    const afterSubsection = applyScoped({
      canonicalBody: afterField.canonicalBody,
      scopeMeta: subsectionMeta,
      editorContent: String(subsectionProjection.displayText || "").replace(
        "How we work",
        "How we operate",
      ),
      runtimeProjection: {
        editableBoundaries: subsectionProjection.editableBoundaries,
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });
    expect(afterSubsection.ok).toBe(true);

    const sectionMeta = {
      scopeKind: "section",
      section: "hero",
      subsection: "",
      name: "hero",
    };
    const sectionSlice = resolveCanonicalScopeSlice(
      afterSubsection.canonicalBody,
      sectionMeta,
    );
    const sectionProjection = projectCanonicalSlice(sectionSlice);
    const afterSection = applyScoped({
      canonicalBody: afterSubsection.canonicalBody,
      scopeMeta: sectionMeta,
      editorContent: String(sectionProjection.displayText || "").replace(
        "tech collide.",
        "tech collide safely.",
      ),
      runtimeProjection: {
        editableBoundaries: sectionProjection.editableBoundaries,
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });
    expect(afterSection.ok).toBe(true);

    const documentMeta = {
      scopeKind: "document",
      section: "",
      subsection: "",
      name: "document",
    };
    const documentSlice = resolveCanonicalScopeSlice(
      afterSection.canonicalBody,
      documentMeta,
    );
    const documentProjection = projectCanonicalSlice(documentSlice);
    const afterDocument = applyScoped({
      canonicalBody: afterSection.canonicalBody,
      scopeMeta: documentMeta,
      editorContent: String(documentProjection.displayText || "").replace(
        "predictable**.",
        "predictable** forever.",
      ),
      runtimeProjection: {
        editableBoundaries: documentProjection.editableBoundaries,
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });
    expect(afterDocument.ok).toBe(true);

    const graphCheck = assertStructuralMarkerGraphEqual(
      BASE_CANONICAL,
      afterDocument.canonicalBody,
    );
    expect(graphCheck.ok).toBe(true);
  });

  test("protected span mismatch blocks save", () => {
    const sectionMeta = {
      scopeKind: "section",
      section: "hero",
      subsection: "",
      name: "hero",
    };
    const sectionSlice = resolveCanonicalScopeSlice(BASE_CANONICAL, sectionMeta);
    const sectionProjection = projectCanonicalSlice(sectionSlice);

    const malformedEditorContent = `${String(sectionProjection.displayText || "")}\n\n<!-- injected -->`;

    expect(() =>
      applyScoped({
        canonicalBody: BASE_CANONICAL,
        scopeMeta: sectionMeta,
        editorContent: malformedEditorContent,
        runtimeProjection: {
          editableBoundaries: [0],
          projectionMeta: {
            runtimeBoundariesTrusted: true,
            updateMode: "runtime-boundaries-preserved",
          },
        },
      }),
    ).toThrow(/protected spans changed/);
  });

  test("rendered html does not leak marker comments as escaped paragraph text", () => {
    const markdown = [
      "We grow food and ideas in the city.",
      "<!-- section:columns -->",
      "<!-- mfe-gap:1 -->",
      "<!-- sub:left -->",
      "### What we grows",
    ].join("\n");

    const html = String(renderMarkdownToHtml(markdown) || "");

    expect(html).toContain('<div data-mfe-marker="section:columns"></div>');
    expect(html).toContain('<div data-mfe-marker="mfe-gap:1"></div>');
    expect(html).toContain('<div data-mfe-marker="sub:left"></div>');
    expect(html).not.toContain("&lt;!-- section:columns --&gt;");
    expect(html).not.toContain("&lt;!-- mfe-gap:1 --&gt;");
    expect(html).not.toContain("&lt;!-- sub:left --&gt;");
  });
});
