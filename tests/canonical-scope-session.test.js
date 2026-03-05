import {
  resolveCanonicalScopeSlice,
  projectCanonicalSlice,
  recomputeEditableBoundariesFromSegmentMap,
  unprojectDisplayToCanonicalSlice,
  validateProtectedSpansUnchanged,
} from "../src/canonical-scope-session.js";

const CANONICAL = [
  "<!-- section:hero -->",
  "<!-- title -->",
  "# Urban Farms",
  "",
  "<!-- sub:right -->",
  "<!-- subtitle -->",
  "Fast systems.",
  "",
  "<!-- section:columns -->",
  "<!-- title -->",
  "# Columns",
  "",
].join("\n");

describe("canonical scope session", () => {
  function countNonEmptyEditableParts(segmentMap = []) {
    return (Array.isArray(segmentMap) ? segmentMap : []).filter((part) => {
      if (String(part?.kind || "") !== "editable") return false;
      const displayStart = Number(part?.displayStart || 0);
      const displayEnd = Number(part?.displayEnd || 0);
      const canonicalStart = Number(part?.canonicalStart || 0);
      const canonicalEnd = Number(part?.canonicalEnd || 0);
      return !(displayStart === displayEnd && canonicalStart === canonicalEnd);
    }).length;
  }

  function withDeterministicBoundaries(scopeSlice, projection, displayText) {
    return {
      ...projection,
      displayText,
      editableBoundaries: recomputeEditableBoundariesFromSegmentMap(
        projection.segmentMap,
        displayText,
      ),
    };
  }

  test("section slice includes defining marker and matches canonical source", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    expect(scopeSlice.canonicalSlice.startsWith("<!-- section:hero -->")).toBe(
      true,
    );
    expect(
      scopeSlice.canonicalDoc.slice(scopeSlice.sliceStartCu, scopeSlice.sliceEndCu),
    ).toBe(scopeSlice.canonicalSlice);
    expect((scopeSlice.canonicalSlice.match(/<!--\s*section:/g) || []).length).toBe(1);
    expect(scopeSlice.canonicalSlice.includes("<!-- section:columns -->")).toBe(false);
  });

  test("projection roundtrip is lossless", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const deterministicProjection = withDeterministicBoundaries(
      scopeSlice,
      projection,
      projection.displayText,
    );
    const roundtrip = unprojectDisplayToCanonicalSlice(
      deterministicProjection.displayText,
      scopeSlice,
      deterministicProjection,
    );
    expect(roundtrip).toBe(scopeSlice.canonicalSlice);
  });

  test("protected spans are immutable through unproject", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const editedDisplay = projection.displayText.replace("Urban", "Rural");
    const deterministicProjection = withDeterministicBoundaries(
      scopeSlice,
      projection,
      editedDisplay,
    );
    const canonicalEditedSlice = unprojectDisplayToCanonicalSlice(
      editedDisplay,
      scopeSlice,
      deterministicProjection,
    );
    const integrity = validateProtectedSpansUnchanged(
      canonicalEditedSlice,
      scopeSlice,
    );
    expect(integrity.ok).toBe(true);
    expect(canonicalEditedSlice).toContain("<!-- section:hero -->");
    expect(canonicalEditedSlice).toContain("<!-- sub:right -->");
  });

  test("projection returns markerless display text with segment map", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    expect(projection.displayText.includes("<!--")).toBe(false);
    expect(/[\uE000-\uF8FF]/.test(projection.displayText)).toBe(false);
    expect(Array.isArray(projection.segmentMap)).toBe(true);
    expect(projection.segmentMap.length).toBeGreaterThan(0);
    expect(Array.isArray(projection.editableBoundaries)).toBe(true);
    expect(projection.editableBoundaries.length).toBe(scopeSlice.protectedSpans.length);
  });

  test("invalid boundary metadata is rejected clearly", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const editedDisplay = `${projection.displayText} changed`;
    expect(() =>
      unprojectDisplayToCanonicalSlice(editedDisplay, scopeSlice, {
        ...projection,
        editableBoundaries: [],
      }),
    ).toThrow(/boundaries\/nonEmptyEditable mismatch/);
  });

  test("transaction-like edits at beginning/middle/end keep deterministic boundaries", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);

    const beginEdit = `X${projection.displayText}`;
    const middleIndex = Math.floor(projection.displayText.length / 2);
    const middleEdit = `${projection.displayText.slice(0, middleIndex)}Y${projection.displayText.slice(middleIndex)}`;
    const endEdit = `${projection.displayText}Z`;

    const beginBoundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      beginEdit,
    );
    const middleBoundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      middleEdit,
    );
    const endBoundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      endEdit,
    );
    const expectedBoundaryCount = countNonEmptyEditableParts(projection.segmentMap);

    expect(beginBoundaries.length).toBe(expectedBoundaryCount);
    expect(middleBoundaries.length).toBe(expectedBoundaryCount);
    expect(endBoundaries.length).toBe(expectedBoundaryCount);
    expect(beginBoundaries.every((v, i, arr) => i === 0 || v > arr[i - 1])).toBe(true);
    expect(middleBoundaries.every((v, i, arr) => i === 0 || v > arr[i - 1])).toBe(true);
    expect(endBoundaries.every((v, i, arr) => i === 0 || v > arr[i - 1])).toBe(true);
  });

  test("undo/redo style boundary recompute roundtrips deterministically", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const edited = `${projection.displayText} Added`;

    const editedBoundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      edited,
    );
    const undoneBoundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      projection.displayText,
    );
    const baselineDeterministic = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      projection.displayText,
    );

    expect(editedBoundaries.length).toBe(baselineDeterministic.length);
    expect(undoneBoundaries).toEqual(baselineDeterministic);
  });

  test("serialize+canonicalize no-op keeps canonical roundtrip", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const canonicalizedDisplay = String(projection.displayText || "").replace(/\r\n/g, "\n");
    const boundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      canonicalizedDisplay,
    );
    const rebuilt = unprojectDisplayToCanonicalSlice(canonicalizedDisplay, scopeSlice, {
      ...projection,
      displayText: canonicalizedDisplay,
      editableBoundaries: boundaries,
    });
    expect(rebuilt).toBe(scopeSlice.canonicalSlice);
  });

  test("no-op normalization handshake (trailing blank removal) preserves protected spans", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "field",
      section: "hero",
      subsection: "",
      name: "title",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const normalizedByEditor = String(projection.displayText || "").replace(/\n+$/, "");
    const boundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      normalizedByEditor,
    );
    const rebuilt = unprojectDisplayToCanonicalSlice(normalizedByEditor, scopeSlice, {
      ...projection,
      displayText: normalizedByEditor,
      editableBoundaries: boundaries,
    });
    const integrity = validateProtectedSpansUnchanged(rebuilt, scopeSlice);
    expect(integrity.ok).toBe(true);
    expect(rebuilt.includes("<!--")).toBe(true);
  });

  test("arbitrary edit sequence preserves protected marker bytes", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    let display = projection.displayText;

    display = `Start ${display}`;
    let boundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      display,
    );
    display = display.replace("Urban", "City");
    boundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      display,
    );
    display = display.slice(0, Math.max(0, display.length - 6));
    boundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      display,
    );
    // undo-like reset
    display = projection.displayText;
    boundaries = recomputeEditableBoundariesFromSegmentMap(
      projection.segmentMap,
      display,
    );

    const rebuilt = unprojectDisplayToCanonicalSlice(display, scopeSlice, {
      ...projection,
      editableBoundaries: boundaries,
      displayText: display,
    });
    const integrity = validateProtectedSpansUnchanged(rebuilt, scopeSlice);
    expect(integrity.ok).toBe(true);
  });

  test("no-op save splice keeps canonical document identical", () => {
    const scopeSlice = resolveCanonicalScopeSlice(CANONICAL, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const deterministicProjection = withDeterministicBoundaries(
      scopeSlice,
      projection,
      projection.displayText,
    );
    const rebuilt = unprojectDisplayToCanonicalSlice(
      deterministicProjection.displayText,
      scopeSlice,
      deterministicProjection,
    );
    const spliced = `${scopeSlice.canonicalDoc.slice(0, scopeSlice.sliceStartCu)}${rebuilt}${scopeSlice.canonicalDoc.slice(scopeSlice.sliceEndCu)}`;
    expect(spliced).toBe(scopeSlice.canonicalDoc);
  });

  test("section save does not duplicate next section marker and preserves newline boundary", () => {
    const sourceDoc = [
      "<!-- section:hero -->",
      "<!-- title -->",
      "# The Urban Farm",
      "",
      "<!-- intro -->",
      "We work where soil, design, and tech collide.",
      "",
      "<!-- section:columns -->",
      "<!-- title -->",
      "# Columns",
      "",
      "Columns body",
      "",
    ].join("\n");
    const scopeSlice = resolveCanonicalScopeSlice(sourceDoc, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const editedDisplay = String(projection.displayText || "").replace(
      "collide.",
      "collide.sss",
    );
    const deterministicProjection = withDeterministicBoundaries(
      scopeSlice,
      projection,
      editedDisplay,
    );
    let rebuilt = unprojectDisplayToCanonicalSlice(
      editedDisplay,
      scopeSlice,
      deterministicProjection,
    );
    if (!/\n$/.test(rebuilt)) rebuilt = `${rebuilt}\n`;
    const spliced = `${scopeSlice.canonicalDoc.slice(0, scopeSlice.sliceStartCu)}${rebuilt}${scopeSlice.canonicalDoc.slice(scopeSlice.sliceEndCu)}`;
    expect((spliced.match(/<!--\s*section:columns\s*-->/g) || []).length).toBe(1);
    expect(spliced.includes("<!-- section:columns -->\n<!-- section:columns -->")).toBe(false);
    const columnsMarkerOffset = spliced.indexOf("<!-- section:columns -->");
    expect(columnsMarkerOffset).toBeGreaterThan(0);
    expect(spliced.slice(columnsMarkerOffset - 1, columnsMarkerOffset)).toBe("\n");
  });

  test("stale boundaries must not move non-newline content across structural marker", () => {
    const sourceDoc = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# Title",
      "",
      "<!-- intro... -->",
      "Intro text",
      "",
      "<!-- section:next -->",
      "<!-- title -->",
      "# Next",
      "",
    ].join("\n");
    const scopeSlice = resolveCanonicalScopeSlice(sourceDoc, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const editedDisplay = String(projection.displayText || "").replace(
      "Intro text",
      "Intro text updated",
    );
    // Simulate a drifted boundary where separator newlines are pushed after intro marker.
    const driftedBoundaries = [0, 1, 8];
    const rebuilt = unprojectDisplayToCanonicalSlice(editedDisplay, scopeSlice, {
      ...projection,
      displayText: editedDisplay,
      editableBoundaries: driftedBoundaries,
    });

    expect(rebuilt.includes("\n<!-- intro... -->\ns")).toBe(false);
  });

  test("title +1 edit with mapped boundary preserves intro marker separation", () => {
    const sourceDoc = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# The Urban <br>Farm",
      "",
      "<!-- intro... -->",
      "We grow food and ideas in the city.",
      "",
    ].join("\n");
    const scopeSlice = resolveCanonicalScopeSlice(sourceDoc, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const editedDisplay = String(projection.displayText || "").replace("Farm", "Farms");
    const mappedBoundaries = [0, 1, 24];
    const rebuilt = unprojectDisplayToCanonicalSlice(editedDisplay, scopeSlice, {
      ...projection,
      displayText: editedDisplay,
      editableBoundaries: mappedBoundaries,
    });
    expect(rebuilt.includes("# The Urban <br>Farms\n\n<!-- intro... -->\nWe grow")).toBe(
      true,
    );
    expect(rebuilt.includes("Farms\n<!-- intro... -->\n\nsWe")).toBe(false);
  });

  test("mapped boundary shift (+1 in title) keeps protected span hashes and newline contract", () => {
    const sourceDoc = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# The Urban <br>Farm",
      "",
      "<!-- intro... -->",
      "We grow food and ideas in the city. From rooftop gardens to indoor farms, we craft systems that actually produce. We work where soil, design, and tech collide.",
      "",
    ].join("\n");
    const scopeSlice = resolveCanonicalScopeSlice(sourceDoc, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const editedDisplay = String(projection.displayText || "").replace("Farm", "Farms");
    const rebuilt = unprojectDisplayToCanonicalSlice(editedDisplay, scopeSlice, {
      ...projection,
      displayText: editedDisplay,
      editableBoundaries: [0, 1, 24],
    });
    const baselineIntroMarkerOffset = sourceDoc.indexOf("<!-- intro... -->");
    const rebuiltIntroMarkerOffset = rebuilt.indexOf("<!-- intro... -->");
    const integrity = validateProtectedSpansUnchanged(rebuilt, scopeSlice);
    expect(integrity.ok).toBe(true);
    expect(rebuiltIntroMarkerOffset).toBe(baselineIntroMarkerOffset + 1);
    expect(
      rebuilt.includes(
        "# The Urban <br>Farms\n\n<!-- intro... -->\nWe grow food and ideas in the city.",
      ),
    ).toBe(true);
    expect(rebuilt.includes("Farms\n<!-- intro... -->\n\nsWe")).toBe(false);
  });

  test("title edits at start/middle/end and multiple markers keep bytes on correct side", () => {
    const sourceDoc = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# The Urban <br>Farm",
      "",
      "<!-- intro... -->",
      "We grow food and ideas in the city.",
      "",
      "<!-- cta... -->",
      "Join us this season.",
      "",
    ].join("\n");
    const scopeSlice = resolveCanonicalScopeSlice(sourceDoc, {
      scopeKind: "section",
      section: "hero",
      name: "hero",
    });
    const projection = projectCanonicalSlice(scopeSlice);
    const baseDisplay = String(projection.displayText || "");

    const insertionOffsets = [
      baseDisplay.indexOf("The Urban"),
      baseDisplay.indexOf("Urban"),
      baseDisplay.indexOf("Farm") + "Farm".length,
    ];
    insertionOffsets.forEach((offset, index) => {
      const pos = Math.max(0, Number(offset || 0));
      const editedDisplay = `${baseDisplay.slice(0, pos)}${index}${baseDisplay.slice(pos)}`;
      const mappedBoundaries = projection.editableBoundaries.map((boundary, boundaryIndex) => {
        if (boundaryIndex === 0) return 0;
        const b = Number(boundary || 0);
        return b >= pos ? b + 1 : b;
      });
      const rebuilt = unprojectDisplayToCanonicalSlice(editedDisplay, scopeSlice, {
        ...projection,
        displayText: editedDisplay,
        editableBoundaries: mappedBoundaries,
      });
      expect(rebuilt.includes("<!-- intro... -->\nWe grow")).toBe(true);
      expect(rebuilt.includes("<!-- cta... -->\nJoin us")).toBe(true);
      expect(rebuilt.includes("<!-- intro... -->\n\n0We grow")).toBe(false);
      expect(rebuilt.includes("<!-- intro... -->\n\n1We grow")).toBe(false);
      expect(rebuilt.includes("<!-- intro... -->\n\n2We grow")).toBe(false);
    });
  });
});
