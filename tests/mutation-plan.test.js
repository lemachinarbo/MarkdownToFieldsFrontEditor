import { createScopeSession } from "../src/scope-session.js";
import fs from "node:fs";
import path from "node:path";
import {
  assertStructuralMarkerGraphEqual,
  hasStructuralMarkerBoundaryViolations,
  parseStructuralDocument,
  resolveStructuralScopeRange,
} from "../src/structural-document.js";
import { applyScopedEdit } from "../src/mutation-plan.js";
import {
  projectCanonicalSlice,
  resolveCanonicalScopeSlice,
} from "../src/canonical-scope-session.js";

const CANONICAL = [
  "<!-- section:hero -->",
  "",
  "<!-- title -->",
  "# The Urban <br>Farm",
  "",
  "<!-- intro... -->",
  "We grow food and ideas in the city. From rooftop gardens to indoor farms, we craft systems that actually produce. We work where soil, design, and tech collide.",
  "",
  "<!-- section:next -->",
  "",
  "<!-- title -->",
  "# Next",
].join("\n");

const CANONICAL_WITH_SUBSECTIONS = [
  "<!-- section:hero -->",
  "",
  "<!-- title -->",
  "# The Urban <br>Farm",
  "",
  "<!-- intro... -->",
  "We grow food and ideas in the city.",
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
  "Every harvest stays **predictable**.",
].join("\n");

const CANONICAL_WITH_PLAIN_TAG_FIELD = [
  "<!-- section:edgecases -->",
  "",
  "<!-- plain -->",
  "Alpha beta gamma",
  "",
  "<!-- after -->",
  "After marker stays untouched.",
].join("\n");

const COMPLEX_CANONICAL_BODY = fs
  .readFileSync(
    path.join(process.cwd(), "tests/fixtures/en-home.baseline.md"),
    "utf8",
  )
  .replace(/^---\n[\s\S]*?\n---\n\n/, "");

const COMPLEX_DOCUMENT_BOUNDARY_FIXTURE = fs
  .readFileSync(
    path.join(
      process.cwd(),
      "tests/fixtures/en-home-complex-document.md",
    ),
    "utf8",
  )
  .replace(/^---\n[\s\S]*?\n---\n\n/, "");

const CHIROLOGY_MARKER_REGRESSION_FIXTURE = fs
  .readFileSync(
    path.join(
      process.cwd(),
      "tests/fixtures/de-chirology-marker-regression.md",
    ),
    "utf8",
  )
  .replace(/^---\n[\s\S]*?\n---\n\n/, "");

describe("mutation-plan", () => {
  test("field right-edge edit keeps marker separation", () => {
    const session = createScopeSession({
      stateId: "s1|en",
      lang: "en",
      scopeMeta: {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
      },
    });
    const structuralDoc = parseStructuralDocument(CANONICAL);
    const result = applyScopedEdit({
      session,
      structuralDocument: structuralDoc,
      editorContent: "# The Urban <br>Far",
    });

    expect(result.ok).toBe(true);
    expect(result.canonicalBody).toMatch(/# The Urban <br>Far\n+<!-- intro\.\.\. -->/);
    expect(result.canonicalBody).not.toContain("Far<!-- intro... -->");
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
  });

  test.each([
    {
      label: "whole replacement",
      editorContent: "Omega field replacement",
      expectedFieldText: "Omega field replacement",
    },
    {
      label: "start replacement",
      editorContent: "Omega beta gamma",
      expectedFieldText: "Omega beta gamma",
    },
    {
      label: "end replacement",
      editorContent: "Alpha beta delta",
      expectedFieldText: "Alpha beta delta",
    },
  ])("plain tag field adjacent edits keep range inside scope: $label", ({
    editorContent,
    expectedFieldText,
  }) => {
    const scopeMeta = {
      scopeKind: "field",
      section: "edgecases",
      subsection: "",
      name: "plain",
    };
    const session = createScopeSession({
      stateId: "plain|en",
      lang: "en",
      scopeMeta,
    });
    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(CANONICAL_WITH_PLAIN_TAG_FIELD),
      editorContent,
    });

    const beforeRange = resolveStructuralScopeRange(
      parseStructuralDocument(CANONICAL_WITH_PLAIN_TAG_FIELD),
      scopeMeta,
    );
    const afterRange = resolveStructuralScopeRange(
      parseStructuralDocument(result.canonicalBody),
      scopeMeta,
    );

    expect(result.ok).toBe(true);
    expect(result.canonicalBody).toContain(`<!-- plain -->\n${expectedFieldText}\n\n<!-- after -->`);
    expect(result.canonicalBody).toContain("<!-- after -->\nAfter marker stays untouched.");
    expect(result.startOffset).toBe(beforeRange.contentStart);
    expect(result.endOffset).toBe(beforeRange.contentEnd);
    expect(afterRange.trimmedContentEnd).toBeGreaterThanOrEqual(result.startOffset);
    expect(result.scopedComparableMarkdown).toBe(expectedFieldText);
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
  });

  test("sequential field saves keep marker graph stable", () => {
    const introSession = createScopeSession({
      stateId: "s1|en",
      lang: "en",
      scopeMeta: {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "intro",
      },
    });
    const titleSession = createScopeSession({
      stateId: "s1|en",
      lang: "en",
      scopeMeta: {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
      },
    });

    const first = applyScopedEdit({
      session: introSession,
      structuralDocument: parseStructuralDocument(CANONICAL),
      editorContent:
        "We grow food and ideas in the city. From rooftop gardens to indoor farms, we craft systems that actually produce. We work where soil, design, and tech collide.sss",
    });
    const second = applyScopedEdit({
      session: titleSession,
      structuralDocument: parseStructuralDocument(first.canonicalBody),
      editorContent: "# The Urban <br>Farms",
    });

    const graphCheck = assertStructuralMarkerGraphEqual(
      CANONICAL,
      second.canonicalBody,
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(graphCheck.ok).toBe(true);
    expect(second.canonicalBody).toContain("# The Urban <br>Farms");
    expect(second.canonicalBody).toContain("collide.sss");
    expect(hasStructuralMarkerBoundaryViolations(second.canonicalBody)).toBe(false);
  });

  test("document markerless projection edit keeps marker topology stable", () => {
    const scopeMeta = {
      scopeKind: "document",
      section: "",
      subsection: "",
      name: "document",
    };
    const session = createScopeSession({
      stateId: "s4|en",
      lang: "en",
      scopeMeta,
    });
    const documentSlice = resolveCanonicalScopeSlice(CANONICAL, scopeMeta);
    const projection = projectCanonicalSlice(documentSlice);
    const editedDisplay = String(projection.displayText || "").replace(
      "The Urban <br>Farm",
      "The Urban <br>Farms",
    );

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(CANONICAL),
      editorContent: editedDisplay,
      runtimeProjection: {
        editableBoundaries: projection.editableBoundaries,
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });
    const graphCheck = assertStructuralMarkerGraphEqual(
      CANONICAL,
      result.canonicalBody,
    );

    expect(result.ok).toBe(true);
    expect(graphCheck.ok).toBe(true);
    expect(result.canonicalBody).toContain("# The Urban <br>Farms");
    expect(result.canonicalBody).toContain("<!-- intro... -->");
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
    expect(result.scopedOutboundMarkdown).toBe(result.canonicalBody);
  });

  test("document save recovers when selected boundaries drift", () => {
    const canonical = [
      "<!-- section:hero -->",
      "",
      "<!-- f0 -->",
      "adeHF_G_IdJJJId",
      "",
      "<!-- f1 -->",
      "FcbII_ aFJH __cG_",
      "",
      "<!-- f2 -->",
      "cdGbbFJGcFGG_b FHaJ bd IaJaF",
      "",
      "<!-- f3 -->",
      "GJHeeF",
      "",
      "<!-- f4 -->",
      "IbaaGHJ",
      "",
      "<!-- f5 -->",
      "JGHc Ga",
      "<!-- section:next -->",
      "",
      "<!-- title -->",
      "# Next",
    ].join("\n");
    const session = createScopeSession({
      stateId: "s5|en",
      lang: "en",
      scopeMeta: {
        scopeKind: "document",
        section: "",
        subsection: "",
        name: "document",
      },
    });
    const editedDisplay = [
      "",
      "adeHF_G_IdJJJId",
      "",
      "FcbII_ aFsJH __cG_",
      "",
      "cdGbbFJGcFGG_b FHaJ d IaJaF",
      "",
      "GJHeeF",
      "",
      "IbaaGHJ",
      "",
      "JGHc Ga",
      "",
      "#Next",
    ].join("\n");

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(canonical),
      editorContent: editedDisplay,
      runtimeProjection: {
        editableBoundaries: [0, 2, 19, 38, 66, 73, 84, 90, 91],
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });
    const graphCheck = assertStructuralMarkerGraphEqual(
      canonical,
      result.canonicalBody,
    );

    expect(result.ok).toBe(true);
    expect(graphCheck.ok).toBe(true);
    expect(result.canonicalBody).toContain("aFsJH");
    expect(result.canonicalBody).toContain("FHaJ d IaJaF");
    expect(result.canonicalBody).toContain("#Next");
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
  });

  test("document save tolerates collapsed boundary slots", () => {
    const scopeMeta = {
      scopeKind: "document",
      section: "",
      subsection: "",
      name: "document",
    };
    const session = createScopeSession({
      stateId: "s6|en",
      lang: "en",
      scopeMeta,
    });
    const documentSlice = resolveCanonicalScopeSlice(CANONICAL, scopeMeta);
    const projection = projectCanonicalSlice(documentSlice);
    const editedDisplay = String(projection.displayText || "").replace(/^\n+/, "");

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(CANONICAL),
      editorContent: editedDisplay,
      runtimeProjection: {
        editableBoundaries: [0, 0, 23, 60, 61],
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });
    const graphCheck = assertStructuralMarkerGraphEqual(
      CANONICAL,
      result.canonicalBody,
    );

    expect(result.ok).toBe(true);
    expect(graphCheck.ok).toBe(true);
    expect(result.canonicalBody).toContain("<!-- title -->");
    expect(result.canonicalBody).toContain("# The Urban <br>Farm");
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
  });

  test("document save tolerates runtime boundaries from protected slots when a middle editable part is empty", () => {
    const canonical = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# The Urban <br>Farm",
      "",
      "<!-- intro... -->",
      "We grow food and ideas.",
      "",
      "<!-- section:columns -->",
      "<!-- sub:left -->",
      "### What we grow",
      "",
      "- Leafy greens",
      "",
      "<!-- sub:right -->",
      "### How we work",
      "",
      "<!-- section:body -->",
      "## Forget farms",
    ].join("\n");
    const scopeMeta = {
      scopeKind: "document",
      section: "",
      subsection: "",
      name: "document",
    };
    const session = createScopeSession({
      stateId: "s7|en",
      lang: "en",
      scopeMeta,
    });
    const scopeSlice = resolveCanonicalScopeSlice(canonical, scopeMeta);
    const projection = projectCanonicalSlice(scopeSlice);
    const editedDisplay = String(projection.displayText || "").replace(
      "The Urban <br>Farm",
      "The Urban <br>Farms",
    );

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(canonical),
      editorContent: editedDisplay,
      runtimeProjection: {
        editableBoundaries: projection.editableBoundaries,
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });
    const graphCheck = assertStructuralMarkerGraphEqual(
      canonical,
      result.canonicalBody,
    );

    expect(result.ok).toBe(true);
    expect(graphCheck.ok).toBe(true);
    expect(result.canonicalBody).toContain("# The Urban <br>Farms");
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
  });

  test("document projection keeps marker-adjacent text stable under broad normalization edits", () => {
    const scopeMeta = {
      scopeKind: "document",
      section: "",
      subsection: "",
      name: "document",
    };
    const session = createScopeSession({
      stateId: "s8|en",
      lang: "en",
      scopeMeta,
    });
    const scopeSlice = resolveCanonicalScopeSlice(COMPLEX_CANONICAL_BODY, scopeMeta);
    const projection = projectCanonicalSlice(scopeSlice);
    const editedDisplay = String(projection.displayText || "")
      .replace(
        "# The Urban <br>Farm",
        "# The Urban <br>Farm V2_CLI_FLOW_FIELD V2_CLI_FLOW_SECTION V2_CLI_FLOW_DOCUMENT",
      )
      .replace(
        "__bold__ **bold** *italic* _italic_ ~~strike~~ `inline code`  ",
        "**bold** **bold** _italic_ _italic_ ~~strike~~ `inline code`",
      )
      .replace("|------|-----|------|", "| ---- | --- | ---- |")
      .replace("|---------|-------|-------|--------|", "| ------- | ----- | ----- | ------ |")
      .replace(
        "Name | Score\n---- | -----\nAna  | 10\nLeo  | 8",
        "| Name | Score |\n| ---- | ----- |\n| Ana  | 10    |\n| Leo  | 8     |",
      )
      .replace(
        "A | B\n- | -\n1 | 2",
        "| A   | B   |\n| --- | --- |\n| 1   | 2   |",
      );
    const runtimeBoundaries = projection.editableBoundaries.map((value) =>
      Number(value || 0),
    );
    if (runtimeBoundaries.length > 5) {
      runtimeBoundaries[5] = runtimeBoundaries[5] + 1;
    }

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(COMPLEX_CANONICAL_BODY),
      editorContent: editedDisplay,
      runtimeProjection: {
        editableBoundaries: runtimeBoundaries,
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });
    const graphCheck = assertStructuralMarkerGraphEqual(
      COMPLEX_CANONICAL_BODY,
      result.canonicalBody,
    );

    expect(result.ok).toBe(true);
    expect(graphCheck.ok).toBe(true);
    expect(result.canonicalBody).toContain(
      "# The Urban <br>Farm V2_CLI_FLOW_FIELD V2_CLI_FLOW_SECTION V2_CLI_FLOW_DOCUMENT",
    );
    expect(result.canonicalBody).toContain("tech collide.\n\n<!-- section:columns -->");
    expect(result.canonicalBody).toContain(
      "<!-- section:columns -->\n\n<!-- sub:left -->\n### What we grow",
    );
    expect(result.canonicalBody).toContain(
      "<!-- section:body -->\n## Forget _industrial_ farms _and rigid layouts_.",
    );
    expect(result.canonicalBody).toContain(
      "scale without chaos\n\n<!-- predictable -->\nEvery _plot_ starts _small_.",
    );
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
  });

  test("section save preserves marker graph and immutable markers", () => {
    const sectionScope = {
      scopeKind: "section",
      section: "columns",
      subsection: "",
      name: "columns",
    };
    const sectionSession = createScopeSession({
      stateId: "s2|en",
      lang: "en",
      scopeMeta: sectionScope,
    });
    const sectionSlice = resolveCanonicalScopeSlice(
      CANONICAL_WITH_SUBSECTIONS,
      sectionScope,
    );
    const sectionDisplay = projectCanonicalSlice(sectionSlice).displayText;
    const editedDisplay = String(sectionDisplay || "").replace(
      "Mushrooms and sprouts",
      "Mushrooms and sprouts V2",
    );

    const result = applyScopedEdit({
      session: sectionSession,
      structuralDocument: parseStructuralDocument(CANONICAL_WITH_SUBSECTIONS),
      editorContent: editedDisplay,
    });
    const graphCheck = assertStructuralMarkerGraphEqual(
      CANONICAL_WITH_SUBSECTIONS,
      result.canonicalBody,
    );

    expect(result.ok).toBe(true);
    expect(graphCheck.ok).toBe(true);
    expect(result.canonicalBody).toContain("Mushrooms and sprouts V2");
    expect(result.canonicalBody).toContain("<!-- sub:right -->");
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
  });

  test("subsection save preserves marker graph and immutable markers", () => {
    const subsectionScope = {
      scopeKind: "subsection",
      section: "columns",
      subsection: "right",
      name: "right",
    };
    const subsectionSession = createScopeSession({
      stateId: "s3|en",
      lang: "en",
      scopeMeta: subsectionScope,
    });
    const subsectionSlice = resolveCanonicalScopeSlice(
      CANONICAL_WITH_SUBSECTIONS,
      subsectionScope,
    );
    const subsectionDisplay = projectCanonicalSlice(subsectionSlice).displayText;
    const editedDisplay = String(subsectionDisplay || "").replace(
      "How we work",
      "How we work V2",
    );

    const result = applyScopedEdit({
      session: subsectionSession,
      structuralDocument: parseStructuralDocument(CANONICAL_WITH_SUBSECTIONS),
      editorContent: editedDisplay,
    });
    const graphCheck = assertStructuralMarkerGraphEqual(
      CANONICAL_WITH_SUBSECTIONS,
      result.canonicalBody,
    );

    expect(result.ok).toBe(true);
    expect(graphCheck.ok).toBe(true);
    expect(result.canonicalBody).toContain("How we work V2");
    expect(result.canonicalBody).toContain("<!-- sub:right -->");
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
  });

  test.each([
    {
      label: "section start",
      scopeMeta: {
        scopeKind: "section",
        section: "hero",
        subsection: "",
        name: "hero",
      },
      mutate(display) {
        const trimmed = String(display || "").replace(/^\n+/, "").replace(/\n+$/, "");
        return `Metro${trimmed.slice(Math.min(5, trimmed.length))}`;
      },
      expected: "Metro",
    },
    {
      label: "section end",
      scopeMeta: {
        scopeKind: "section",
        section: "hero",
        subsection: "",
        name: "hero",
      },
      mutate(display) {
        const trimmed = String(display || "").replace(/^\n+/, "").replace(/\n+$/, "");
        return `${trimmed.slice(0, Math.max(0, trimmed.length - 6))}SAFELY`;
      },
      expected: "SAFELY",
    },
    {
      label: "subsection start",
      scopeMeta: {
        scopeKind: "subsection",
        section: "columns",
        subsection: "right",
        name: "right",
      },
      mutate(display) {
        const trimmed = String(display || "").replace(/^\n+/, "").replace(/\n+$/, "");
        return `Why${trimmed.slice(Math.min(3, trimmed.length))}`;
      },
      expected: "Why",
    },
    {
      label: "subsection end",
      scopeMeta: {
        scopeKind: "subsection",
        section: "columns",
        subsection: "right",
        name: "right",
      },
      mutate(display) {
        const trimmed = String(display || "").replace(/^\n+/, "").replace(/\n+$/, "");
        return `${trimmed.slice(0, Math.max(0, trimmed.length - 6))}steady`;
      },
      expected: "steady",
    },
  ])("$label edits preserve scoped marker boundaries", ({ scopeMeta, mutate, expected }) => {
    const session = createScopeSession({
      stateId: "boundary|en",
      lang: "en",
      scopeMeta,
    });
    const scopeSlice = resolveCanonicalScopeSlice(
      CANONICAL_WITH_SUBSECTIONS,
      scopeMeta,
    );
    const projection = projectCanonicalSlice(scopeSlice);
    const editedDisplay = mutate(projection.displayText);

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(CANONICAL_WITH_SUBSECTIONS),
      editorContent: editedDisplay,
      runtimeProjection: {
        editableBoundaries: projection.editableBoundaries,
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.canonicalBody).toContain(expected);
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
    expect(
      assertStructuralMarkerGraphEqual(
        CANONICAL_WITH_SUBSECTIONS,
        result.canonicalBody,
      ).ok,
    ).toBe(true);
  });

  test("document projection insertion across complex home fixture preserves marker boundaries", () => {
    const scopeMeta = {
      scopeKind: "document",
      section: "",
      subsection: "",
      name: "document",
    };
    const session = createScopeSession({
      stateId: "complex-doc|en",
      lang: "en",
      scopeMeta,
    });
    const scopeSlice = resolveCanonicalScopeSlice(
      COMPLEX_DOCUMENT_BOUNDARY_FIXTURE,
      scopeMeta,
    );
    const projection = projectCanonicalSlice(scopeSlice);
    const display = String(projection.displayText || "");
    const anchor = display.indexOf("tiefen Leidens");
    expect(anchor).toBeGreaterThan(0);
    const editedDisplay = `${display.slice(0, anchor)}steady ${display.slice(anchor)}`;

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(COMPLEX_DOCUMENT_BOUNDARY_FIXTURE),
      editorContent: editedDisplay,
      runtimeProjection: {
        editableBoundaries: projection.editableBoundaries,
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.canonicalBody).toContain("steady tiefen Leidens");
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
    expect(
      assertStructuralMarkerGraphEqual(
        COMPLEX_DOCUMENT_BOUNDARY_FIXTURE,
        result.canonicalBody,
      ).ok,
    ).toBe(true);
  });

  test("df chirology hero title field edit preserves next marker separation", () => {
    const scopeMeta = {
      scopeKind: "field",
      section: "hero",
      subsection: "",
      name: "title",
    };
    const session = createScopeSession({
      stateId: "df-chirology|de",
      lang: "de",
      originKey: "field:hero:title",
      scopeMeta,
    });

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(CHIROLOGY_MARKER_REGRESSION_FIXTURE),
      editorContent: "# Moderne Chirologiex",
    });

    expect(result.ok).toBe(true);
    expect(result.canonicalBody).toContain("# Moderne Chirologiex\n\n<!-- kicker -->");
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
    expect(
      assertStructuralMarkerGraphEqual(
        CHIROLOGY_MARKER_REGRESSION_FIXTURE,
        result.canonicalBody,
      ).ok,
    ).toBe(true);
  });

  test("df chirology hero section edit does not rewrite later marker whitespace", () => {
    const scopeMeta = {
      scopeKind: "section",
      section: "hero",
      subsection: "",
      name: "hero",
    };
    const session = createScopeSession({
      stateId: "df-chirology-section|de",
      lang: "de",
      originKey: "field:hero:description",
      scopeMeta,
    });

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(CHIROLOGY_MARKER_REGRESSION_FIXTURE),
      editorContent: [
        "# Moderne Chirologie",
        "",
        "Erkunde diese Methode",
        "",
        "Eine lebendige Landkarte deines Seins.x",
        "",
        "![](oli-qyrvpsargry-unsplash.jpg)",
        "",
        "",
      ].join("\n"),
    });

    expect(result.ok).toBe(true);
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
    expect(
      result.canonicalBody.includes("<!-- description... --> \n"),
    ).toBe(true);
    expect(
      assertStructuralMarkerGraphEqual(
        CHIROLOGY_MARKER_REGRESSION_FIXTURE,
        result.canonicalBody,
      ).ok,
    ).toBe(true);
  });

  test.each([
    { label: "document-start", needle: "# The Urban <br>Farm", offset: 0, token: "X" },
    { label: "document-middle-near-body-marker", needle: "Every _plot_ starts _small_.", offset: 10, token: "Y" },
    { label: "document-middle-complex-content", needle: "tiefen Leidens", offset: 0, token: "Z" },
    { label: "document-end-near-cta", needle: "wie Sitzungen ablaufen.", offset: 5, token: "Q" },
  ])("$label single-char insert preserves marker graph on complex fixture", ({
    needle,
    offset,
    token,
  }) => {
    const scopeMeta = {
      scopeKind: "document",
      section: "",
      subsection: "",
      name: "document",
    };
    const session = createScopeSession({
      stateId: "complex-doc-sweep|en",
      lang: "en",
      scopeMeta,
    });
    const scopeSlice = resolveCanonicalScopeSlice(
      COMPLEX_DOCUMENT_BOUNDARY_FIXTURE,
      scopeMeta,
    );
    const projection = projectCanonicalSlice(scopeSlice);
    const display = String(projection.displayText || "");
    const anchor = display.indexOf(String(needle || ""));
    expect(anchor).toBeGreaterThanOrEqual(0);
    const insertAt = Math.max(0, Math.min(display.length, anchor + Number(offset || 0)));
    const editedDisplay = `${display.slice(0, insertAt)}${token}${display.slice(insertAt)}`;

    const result = applyScopedEdit({
      session,
      structuralDocument: parseStructuralDocument(COMPLEX_DOCUMENT_BOUNDARY_FIXTURE),
      editorContent: editedDisplay,
      runtimeProjection: {
        editableBoundaries: projection.editableBoundaries,
        projectionMeta: {
          runtimeBoundariesTrusted: true,
          updateMode: "runtime-boundaries-preserved",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(hasStructuralMarkerBoundaryViolations(result.canonicalBody)).toBe(false);
    expect(
      assertStructuralMarkerGraphEqual(
        COMPLEX_DOCUMENT_BOUNDARY_FIXTURE,
        result.canonicalBody,
      ).ok,
    ).toBe(true);
  });
});
