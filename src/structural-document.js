import { normalizeScopeKind } from "./scope-slice.js";

const MARKER_LINE_RE =
  /^[\t ]*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->[\t ]*(?:\n|$)/gm;

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeFieldMarkerName(name) {
  const value = String(name || "");
  return value.endsWith("...") ? value.slice(0, -3) : value;
}

function resolveFieldIdentity(rawName, fallbackSection, fallbackSubsection) {
  const normalized = String(rawName || "").replace(/^field:/i, "");
  const parts = normalized
    .split(/[/:]/)
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (parts.length >= 3) {
    return {
      section: parts[0],
      subsection: parts[1],
      name: parts[2],
    };
  }
  if (parts.length === 2) {
    return {
      section: parts[0],
      subsection: "",
      name: parts[1],
    };
  }
  if (parts.length === 1) {
    return {
      section: fallbackSection,
      subsection: fallbackSubsection,
      name: parts[0],
    };
  }
  return {
    section: fallbackSection,
    subsection: fallbackSubsection,
    name: normalizeFieldMarkerName(rawName),
  };
}

function buildFieldNameVariants(name) {
  const raw = String(name || "").trim();
  if (!raw) return [];
  const trimmed = raw.replace(/[\.\u2026]+$/g, "");
  const variants = new Set([raw]);
  if (trimmed) {
    variants.add(trimmed);
    variants.add(`${trimmed}...`);
    variants.add(`${trimmed}…`);
  }
  return Array.from(variants).filter(Boolean);
}

function findFieldMarkerIndex(markers, section, subsection, name) {
  const normalizedSection = String(section || "");
  const normalizedSubsection = String(subsection || "");
  const variants = buildFieldNameVariants(name);
  if (!variants.length) return -1;

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    if (
      marker.kind === "field" &&
      String(marker.section || "") === normalizedSection &&
      String(marker.subsection || "") === normalizedSubsection &&
      variants.includes(String(marker.name || ""))
    ) {
      return index;
    }
  }

  const sectionMatches = markers
    .map((marker, index) => ({ marker, index }))
    .filter(
      ({ marker }) =>
        marker.kind === "field" &&
        String(marker.section || "") === normalizedSection &&
        variants.includes(String(marker.name || "")),
    );
  if (sectionMatches.length === 1) return sectionMatches[0].index;

  return -1;
}

function findTargetMarkerIndex(markers, scopeMeta = {}) {
  const scopeKind = normalizeScopeKind(scopeMeta.scopeKind || "field");
  const section = String(scopeMeta.section || "");
  const subsection = String(scopeMeta.subsection || "");
  const name = String(scopeMeta.name || "");
  const targetSection = scopeKind === "section" ? name || section : section;
  const targetSubsection =
    scopeKind === "subsection" ? name || subsection : subsection;

  if (scopeKind === "section") {
    return markers.findIndex(
      (marker) =>
        marker.kind === "section" &&
        String(marker.name || "") === String(targetSection || ""),
    );
  }
  if (scopeKind === "subsection") {
    return markers.findIndex(
      (marker) =>
        marker.kind === "subsection" &&
        String(marker.section || "") === String(section || "") &&
        String(marker.name || "") === String(targetSubsection || ""),
    );
  }

  return findFieldMarkerIndex(markers, section, subsection, name);
}

export function parseStructuralDocument(markdown = "") {
  const text = normalizeText(markdown);
  const markers = [];
  let currentSection = "";
  let currentSubsection = "";
  let match;
  let markerIndex = 0;

  MARKER_LINE_RE.lastIndex = 0;
  while ((match = MARKER_LINE_RE.exec(text))) {
    const rawName = String(match[1] || "");
    const lineStart = Number(match.index || 0);
    const lineEnd = Number(MARKER_LINE_RE.lastIndex || lineStart);

    let kind = "field";
    let name = rawName;
    let markerSection = currentSection;
    let markerSubsection = currentSubsection;

    if (rawName.startsWith("section:")) {
      kind = "section";
      name = rawName.slice("section:".length);
      currentSection = name;
      currentSubsection = "";
      markerSection = currentSection;
      markerSubsection = currentSubsection;
    } else if (rawName.startsWith("subsection:")) {
      kind = "subsection";
      name = rawName.slice("subsection:".length);
      currentSubsection = name;
      markerSection = currentSection;
      markerSubsection = currentSubsection;
    } else if (rawName.startsWith("sub:")) {
      kind = "subsection";
      name = rawName.slice("sub:".length);
      currentSubsection = name;
      markerSection = currentSection;
      markerSubsection = currentSubsection;
    } else {
      const fieldIdentity = resolveFieldIdentity(
        rawName,
        currentSection,
        currentSubsection,
      );
      markerSection = fieldIdentity.section || markerSection;
      markerSubsection = fieldIdentity.subsection || "";
      name = fieldIdentity.name || normalizeFieldMarkerName(rawName);
    }

    markers.push({
      index: markerIndex,
      rawName,
      kind,
      name,
      section: markerSection,
      subsection: markerSubsection,
      lineStart,
      lineEnd,
    });
    markerIndex += 1;
  }

  const nodes = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const nextMarkerStart =
      index + 1 < markers.length
        ? Number(markers[index + 1].lineStart || text.length)
        : text.length;
    const contentStart = Number(marker.lineEnd || marker.lineStart);
    const contentEnd = Math.max(contentStart, nextMarkerStart);
    const content = text.slice(contentStart, contentEnd);
    const boundaryGapMatch = content.match(/\n+$/);
    const boundaryGap = boundaryGapMatch ? boundaryGapMatch[0] : "";
    const body =
      boundaryGap.length > 0
        ? content.slice(0, content.length - boundaryGap.length)
        : content;

    marker.contentStart = contentStart;
    marker.contentEnd = contentEnd;
    marker.boundaryGap = boundaryGap;
    marker.contentBody = body;

    nodes.push({
      type: "marker",
      markerIndex: index,
      rawName: marker.rawName,
      start: marker.lineStart,
      end: marker.lineEnd,
      text: text.slice(marker.lineStart, marker.lineEnd),
    });

    nodes.push({
      type: "content",
      markerIndex: index,
      start: contentStart,
      end: contentEnd - boundaryGap.length,
      text: body,
    });

    if (boundaryGap.length > 0) {
      nodes.push({
        type: "boundary-gap",
        markerIndex: index,
        start: contentEnd - boundaryGap.length,
        end: contentEnd,
        text: boundaryGap,
      });
    }
  }

  return {
    text,
    markers,
    nodes,
  };
}

export function serializeStructuralDocument(structuralDocument) {
  return normalizeText(String(structuralDocument?.text || ""));
}

export function hasStructuralMarkerBoundaryViolations(markdown = "") {
  const text = normalizeText(markdown);
  if (!text) return false;
  const markerTokenRe = /<!--\s*[^>]+?\s*-->/g;
  let match = markerTokenRe.exec(text);
  while (match) {
    const markerStart = Number(match.index || 0);
    const lineStart = Math.max(0, text.lastIndexOf("\n", markerStart - 1) + 1);
    const nextLineBreak = text.indexOf("\n", markerStart);
    const lineEnd = nextLineBreak >= 0 ? nextLineBreak : text.length;
    const line = text.slice(lineStart, lineEnd);
    if (!/^[\t ]*<!--\s*[^>]+?\s*-->[\t ]*$/.test(line)) {
      return true;
    }
    match = markerTokenRe.exec(text);
  }
  return false;
}

export function assertStructuralMarkerGraphEqual(beforeMarkdown, afterMarkdown) {
  const before = parseStructuralDocument(beforeMarkdown);
  const after = parseStructuralDocument(afterMarkdown);
  if (before.markers.length !== after.markers.length) {
    return {
      ok: false,
      reason: "marker-count-mismatch",
      beforeCount: before.markers.length,
      afterCount: after.markers.length,
    };
  }
  for (let index = 0; index < before.markers.length; index += 1) {
    const left = before.markers[index];
    const right = after.markers[index];
    if (
      String(left.rawName || "") !== String(right.rawName || "") ||
      String(left.kind || "") !== String(right.kind || "") ||
      String(left.section || "") !== String(right.section || "") ||
      String(left.subsection || "") !== String(right.subsection || "") ||
      String(left.name || "") !== String(right.name || "")
    ) {
      return {
        ok: false,
        reason: "marker-identity-mismatch",
        index,
      };
    }
  }
  return { ok: true, reason: "ok" };
}

export function resolveStructuralScopeRange(structuralDocument, scopeMeta = {}) {
  const structural =
    structuralDocument && typeof structuralDocument === "object"
      ? structuralDocument
      : parseStructuralDocument("");
  const scopeKind = normalizeScopeKind(scopeMeta.scopeKind || "field");
  const markers = Array.isArray(structural.markers) ? structural.markers : [];
  const text = String(structural.text || "");

  if (scopeKind === "document") {
    return {
      scopeKind,
      markerIndex: -1,
      contentStart: 0,
      contentEnd: text.length,
      trimmedContentEnd: text.replace(/\n+$/g, "").length,
      hasNextMarker: false,
    };
  }

  if (!markers.length) {
    throw new Error("[mfe] structural-document: no markers in canonical body");
  }

  const targetIndex = findTargetMarkerIndex(markers, scopeMeta);
  if (targetIndex < 0) {
    throw new Error(
      `[mfe] structural-document: scope marker not found (${scopeKind})`,
    );
  }

  const targetMarker = markers[targetIndex];
  const targetSection = String(targetMarker.section || "");
  const targetSubsection = String(targetMarker.subsection || "");

  let end = text.length;
  for (let index = targetIndex + 1; index < markers.length; index += 1) {
    const marker = markers[index];
    if (scopeKind === "section") {
      if (marker.kind === "section") {
        end = Number(marker.lineStart || text.length);
        break;
      }
      continue;
    }
    if (scopeKind === "subsection") {
      if (
        marker.kind === "section" ||
        (marker.kind === "subsection" &&
          String(marker.section || "") === targetSection)
      ) {
        end = Number(marker.lineStart || text.length);
        break;
      }
      continue;
    }
    if (
      marker.kind === "section" ||
      (marker.kind === "subsection" &&
        String(marker.section || "") === targetSection) ||
      (marker.kind === "field" &&
        String(marker.section || "") === targetSection &&
        String(marker.subsection || "") === targetSubsection)
    ) {
      end = Number(marker.lineStart || text.length);
      break;
    }
  }

  const start = Number(targetMarker.contentStart || targetMarker.lineEnd || 0);
  const rawSlice = text.slice(start, end);
  const trimmedSlice = rawSlice.replace(/\n+$/g, "");

  return {
    scopeKind,
    markerIndex: targetIndex,
    contentStart: start,
    contentEnd: end,
    trimmedContentEnd: start + trimmedSlice.length,
    hasNextMarker: end < text.length,
  };
}
