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
  const esc = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markerPattern = `<!--\\s*section:${esc}\\s*-->\\s*`;
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

function resolveSubsectionContentRange(document, sectionName, subsectionName) {
  const section = resolveSectionBlockRange(document, sectionName);
  if (section.status !== "ok") return section;

  const esc = subsectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const subPattern = `<!--\\s*sub:${esc}\\s*-->\\s*`;
  const markers = findMarkersInRange(
    document,
    subPattern,
    section.start,
    section.end,
  );
  if (markers.length === 0)
    return { status: "missing", reason: "subsection_marker_not_found" };
  if (markers.length > 1)
    return {
      status: "ambiguous",
      reason: "subsection_marker_ambiguous",
      markers: markers.length,
    };

  const start = markers[0].end;
  let end = section.end;
  const nextSub = findFirstMarkerPosInRange(
    document,
    "<!--\\s*sub:[^>]*-->\\s*",
    start,
    section.end,
  );
  if (nextSub !== null) end = nextSub;

  return { status: "ok", start, end };
}

function resolveScopedFieldRange(document, name, sectionName, subsectionName) {
  let parentStart = 0;
  let parentEnd = document.length;

  if (sectionName && subsectionName) {
    const sub = resolveSubsectionContentRange(
      document,
      sectionName,
      subsectionName,
    );
    if (sub.status !== "ok") return sub;
    parentStart = sub.start;
    parentEnd = sub.end;
  }

  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fieldPattern = `<!--\\s*${esc}(?:\\.\\.\\.)?\\s*-->\\s*`;
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

  return { status: "ok", start: markers[0].end, end: parentEnd };
}

describe("Marker ambiguity matrix", () => {
  test("duplicate section marker with same name is ambiguous", () => {
    const doc = `<!-- section:body -->\nA\n<!-- section:body -->\nB`;
    const range = resolveSectionBlockRange(doc, "body");
    expect(range.status).toBe("ambiguous");
    expect(range.reason).toBe("section_marker_ambiguous");
    expect(range.markers).toBe(2);
  });

  test("duplicate subsection marker with same name in same section is ambiguous", () => {
    const doc = `<!-- section:body -->\n<!-- sub:right -->\nA\n<!-- sub:right -->\nB`;
    const range = resolveSubsectionContentRange(doc, "body", "right");
    expect(range.status).toBe("ambiguous");
    expect(range.reason).toBe("subsection_marker_ambiguous");
    expect(range.markers).toBe(2);
  });

  test("foo and foo... in same parent are ambiguous for field foo", () => {
    const doc = `<!-- section:body -->\n<!-- sub:right -->\n<!-- foo -->\nA\n<!-- foo... -->\nB`;
    const range = resolveScopedFieldRange(doc, "foo", "body", "right");
    expect(range.status).toBe("ambiguous");
    expect(range.reason).toBe("field_marker_ambiguous");
    expect(range.markers).toBe(2);
  });

  test("same field name in different subsections is not ambiguous within scoped parent", () => {
    const doc = `<!-- section:body -->\n<!-- sub:left -->\n<!-- foo -->\nL\n<!-- sub:right -->\n<!-- foo -->\nR`;
    const left = resolveScopedFieldRange(doc, "foo", "body", "left");
    const right = resolveScopedFieldRange(doc, "foo", "body", "right");
    expect(left.status).toBe("ok");
    expect(right.status).toBe("ok");
  });

  test("same field name in different sections is not ambiguous within section+subsection scope", () => {
    const doc = `<!-- section:alpha -->\n<!-- sub:right -->\n<!-- foo -->\nA\n<!-- section:beta -->\n<!-- sub:right -->\n<!-- foo -->\nB`;
    const alpha = resolveScopedFieldRange(doc, "foo", "alpha", "right");
    const beta = resolveScopedFieldRange(doc, "foo", "beta", "right");
    expect(alpha.status).toBe("ok");
    expect(beta.status).toBe("ok");
  });
});
