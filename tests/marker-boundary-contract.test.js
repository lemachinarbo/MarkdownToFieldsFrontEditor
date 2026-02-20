function findMarkersInRange(document, pattern, start, end) {
  const out = [];
  if (end <= start) return out;
  const regex = new RegExp(pattern, "gi");
  let match;
  while ((match = regex.exec(document)) !== null) {
    const text = match[0] || "";
    const pos = match.index;
    if (pos < start || pos >= end) continue;
    out.push({ pos, end: pos + text.length, len: text.length });
  }
  return out;
}

function findFirstMarkerPosInRange(document, pattern, start, end) {
  const regex = new RegExp(pattern, "gi");
  regex.lastIndex = start;
  const match = regex.exec(document);
  if (!match) return null;
  const pos = match.index;
  if (pos < start || pos >= end) return null;
  return pos;
}

function resolveSectionBlockRange(document, sectionName) {
  const markerPattern = `<!--\\s*section:${sectionName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*-->\\s*`;
  const markers = findMarkersInRange(
    document,
    markerPattern,
    0,
    document.length,
  );
  if (markers.length === 0)
    return { status: "missing", reason: "section_marker_not_found" };
  if (markers.length > 1)
    return {
      status: "ambiguous",
      reason: "section_marker_ambiguous",
      markers: markers.length,
    };

  const start = markers[0].end;
  let end = document.length;
  const nextSection = findFirstMarkerPosInRange(
    document,
    "<!--\\s*section:[^>]*-->\\s*",
    start,
    end,
  );
  if (nextSection !== null) end = nextSection;
  return { status: "ok", start, end };
}

function resolveSectionContentRange(document, sectionName) {
  const block = resolveSectionBlockRange(document, sectionName);
  if (block.status !== "ok") return block;
  let { start, end } = block;
  const firstSub = findFirstMarkerPosInRange(
    document,
    "<!--\\s*sub:[^>]*-->\\s*",
    start,
    end,
  );
  if (firstSub !== null) end = firstSub;
  return { status: "ok", start, end };
}

function resolveSubsectionContentRange(document, sectionName, subsectionName) {
  const sectionRange = resolveSectionBlockRange(document, sectionName);
  if (sectionRange.status !== "ok") return sectionRange;

  const subPattern = `<!--\\s*sub:${subsectionName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*-->\\s*`;
  const subs = findMarkersInRange(
    document,
    subPattern,
    sectionRange.start,
    sectionRange.end,
  );
  if (subs.length === 0)
    return { status: "missing", reason: "subsection_marker_not_found" };
  if (subs.length > 1)
    return {
      status: "ambiguous",
      reason: "subsection_marker_ambiguous",
      markers: subs.length,
    };

  const start = subs[0].end;
  let end = sectionRange.end;
  const nextSub = findFirstMarkerPosInRange(
    document,
    "<!--\\s*sub:[^>]*-->\\s*",
    start,
    sectionRange.end,
  );
  if (nextSub !== null) end = nextSub;
  return { status: "ok", start, end };
}

function resolveAnchoredFieldRangeByExpectedMarkdown(
  document,
  start,
  end,
  expectedMarkdown,
) {
  let scanStart = start;
  while (scanStart < end && /[\s]/.test(document[scanStart])) {
    scanStart += 1;
  }

  const variants = [
    expectedMarkdown,
    expectedMarkdown.replace(/\r\n|\r/g, "\n"),
    expectedMarkdown.replace(/\r\n|\r/g, "\n").replace(/\n/g, "\r\n"),
  ];
  const uniqueVariants = Array.from(new Set(variants.filter(Boolean)));

  const matches = [];
  for (const variant of uniqueVariants) {
    if (scanStart + variant.length > end) continue;
    if (document.slice(scanStart, scanStart + variant.length) === variant) {
      matches.push({ start: scanStart, end: scanStart + variant.length });
    }
  }

  if (matches.length === 1) return { status: "ok", ...matches[0] };
  if (matches.length > 1)
    return {
      status: "ambiguous",
      reason: "field_expected_anchored_ambiguous",
      markers: matches.length,
    };
  return { status: "missing", reason: "field_expected_not_anchored" };
}

function resolveScopedFieldRange(
  document,
  name,
  sectionName,
  subsectionName,
  expectedCurrentMarkdown,
) {
  let parentStart = 0;
  let parentEnd = document.length;
  let parentType = "document";

  if (sectionName && subsectionName) {
    const sub = resolveSubsectionContentRange(
      document,
      sectionName,
      subsectionName,
    );
    if (sub.status !== "ok") return sub;
    parentStart = sub.start;
    parentEnd = sub.end;
    parentType = "subsection";
  } else if (sectionName) {
    const sec = resolveSectionContentRange(document, sectionName);
    if (sec.status !== "ok") return sec;
    parentStart = sec.start;
    parentEnd = sec.end;
    parentType = "section";
  }

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fieldPattern = `<!--\\s*${escaped}(?:\\.\\.\\.)?\\s*-->\\s*`;
  const markers = findMarkersInRange(
    document,
    fieldPattern,
    parentStart,
    parentEnd,
  );
  if (markers.length === 0)
    return { status: "missing", reason: "field_marker_not_found" };
  if (markers.length > 1)
    return {
      status: "ambiguous",
      reason: "field_marker_ambiguous",
      markers: markers.length,
    };

  const start = markers[0].end;
  let end = parentEnd;

  const nextField = findFirstMarkerPosInRange(
    document,
    "<!--\\s*(?!section:|sub:)[^>]+-->\\s*",
    start,
    parentEnd,
  );
  if (nextField !== null) end = Math.min(end, nextField);

  if (parentType !== "subsection") {
    const nextSub = findFirstMarkerPosInRange(
      document,
      "<!--\\s*sub:[^>]*-->\\s*",
      start,
      parentEnd,
    );
    if (nextSub !== null) end = Math.min(end, nextSub);
  }

  if (parentType === "document") {
    const nextSection = findFirstMarkerPosInRange(
      document,
      "<!--\\s*section:[^>]*-->\\s*",
      start,
      parentEnd,
    );
    if (nextSection !== null) end = Math.min(end, nextSection);
  }

  if (expectedCurrentMarkdown) {
    const anchored = resolveAnchoredFieldRangeByExpectedMarkdown(
      document,
      start,
      end,
      expectedCurrentMarkdown,
    );
    if (anchored.status !== "ok") return anchored;
    return anchored;
  }

  return { status: "ok", start, end };
}

describe("Marker boundary contract (section/sub/field/container)", () => {
  test("section content excludes subsection blocks", () => {
    const doc = `<!-- section:body -->\nTop line\n\n<!-- sub:right -->\nsub line`;
    const range = resolveSectionContentRange(doc, "body");
    expect(range.status).toBe("ok");
    const slice = doc.slice(range.start, range.end);
    expect(slice).toContain("Top line");
    expect(slice).not.toContain("sub line");
  });

  test("subsection content excludes following subsection", () => {
    const doc = `<!-- section:body -->\nX\n<!-- sub:right -->\nR1\n<!-- sub:left -->\nL1`;
    const range = resolveSubsectionContentRange(doc, "body", "right");
    expect(range.status).toBe("ok");
    const slice = doc.slice(range.start, range.end);
    expect(slice).toContain("R1");
    expect(slice).not.toContain("L1");
  });

  test("field marker stops at next field marker", () => {
    const doc = `<!-- section:body -->\n<!-- foo -->\nA\n<!-- bar -->\nB`;
    const range = resolveScopedFieldRange(doc, "foo", "body", "", "A\n");
    expect(range.status).toBe("ok");
    expect(doc.slice(range.start, range.end)).toBe("A\n");
  });

  test("container marker foo... is matched by same identity as foo", () => {
    const doc = `<!-- section:body -->\n<!-- foo... -->\nA\n<!-- bar -->\nB`;
    const range = resolveScopedFieldRange(doc, "foo", "body", "", "A\n");
    expect(range.status).toBe("ok");
    expect(doc.slice(range.start, range.end)).toBe("A\n");
  });

  test("having both foo and foo... in same parent is ambiguous", () => {
    const doc = `<!-- section:body -->\n<!-- foo -->\nA\n<!-- foo... -->\nB`;
    const range = resolveScopedFieldRange(doc, "foo", "body", "", "A\n");
    expect(range.status).toBe("ambiguous");
    expect(range.reason).toBe("field_marker_ambiguous");
  });

  test("anchored range prevents swallowing trailing untagged image", () => {
    const doc = `<!-- section:columns -->\n<!-- sub:right -->\n### How we work\n\n<!-- list -->\n- ONE\n- TWO\n\n![Earth](01.jpg)`;
    const expected = "- ONE\n- TWO";
    const range = resolveScopedFieldRange(
      doc,
      "list",
      "columns",
      "right",
      expected,
    );
    expect(range.status).toBe("ok");
    const slice = doc.slice(range.start, range.end);
    expect(slice).toBe(expected);
    expect(slice).not.toContain("![Earth]");
  });

  test("anchored range fails safe when expected markdown does not match", () => {
    const doc = `<!-- section:columns -->\n<!-- sub:right -->\n<!-- list -->\n- ONE\n- TWO\n\n![Earth](01.jpg)`;
    const range = resolveScopedFieldRange(
      doc,
      "list",
      "columns",
      "right",
      "- ONE\n- TWO\n- THREE",
    );
    expect(range.status).toBe("missing");
    expect(range.reason).toBe("field_expected_not_anchored");
  });
});
