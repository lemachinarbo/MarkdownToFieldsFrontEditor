import { normalizeScopeKind } from "./scope-slice.js";
import { recomputeEditableBoundariesFromSegmentMap } from "./canonical-scope-session.js";
import { normalizeLineEndingsToLf } from "./markdown-text-utils.js";

function buildCanonicalSessionScopeMeta(scopeMeta = {}) {
  const scopeKind = normalizeScopeKind(scopeMeta.scopeKind || "field");
  const section = String(scopeMeta.section || "");
  const subsection = String(scopeMeta.subsection || "");
  const name = String(scopeMeta.name || "");
  if (scopeKind === "document") {
    return {
      scopeKind: "document",
      section: "",
      subsection: "",
      name: "document",
    };
  }
  return { scopeKind, section, subsection, name };
}

function buildCanonicalScopeKey(scopeMeta = {}) {
  const normalized = buildCanonicalSessionScopeMeta(scopeMeta);
  if (normalized.scopeKind === "document") return "document";
  if (normalized.scopeKind === "section") {
    return `section:${normalized.name || normalized.section || ""}`;
  }
  if (normalized.scopeKind === "subsection") {
    return `subsection:${normalized.section || ""}:${normalized.name || normalized.subsection || ""}`;
  }
  return `field:${normalized.section || ""}:${normalized.subsection || ""}:${normalized.name || ""}`;
}

function canonicalizeForCompareAndUnproject(value) {
  const normalized = normalizeLineEndingsToLf(String(value || ""));
  let text = normalized;
  let strippedLeadingSingleNewline = false;
  if (text.startsWith("\n")) {
    text = text.slice(1);
    strippedLeadingSingleNewline = true;
  }
  const trimmedTrailing = text.replace(/\n+$/g, "");
  const strippedTrailingNewlineCount = text.length - trimmedTrailing.length;
  return {
    text: trimmedTrailing,
    strippedLeadingSingleNewline,
    strippedTrailingNewlineCount,
  };
}

function buildProjectionForCanonicalizedDisplay(
  projection,
  canonicalMeta,
  canonicalDisplayText,
) {
  const baseProjection = projection && typeof projection === "object" ? projection : {};
  const shiftLeft = canonicalMeta?.strippedLeadingSingleNewline ? 1 : 0;
  const nextDisplay = String(canonicalDisplayText || "");
  const nextLength = nextDisplay.length;
  const baselineSegmentMap = Array.isArray(baseProjection.segmentMap)
    ? baseProjection.segmentMap
    : [];
  const nextSegmentMap = baselineSegmentMap.map((part) => {
    const rawStart = Number(part?.displayStart || 0) - shiftLeft;
    const rawEnd = Number(part?.displayEnd || 0) - shiftLeft;
    const nextDisplayStart = Math.max(0, Math.min(nextLength, rawStart));
    const nextDisplayEnd = Math.max(nextDisplayStart, Math.min(nextLength, rawEnd));
    return {
      ...part,
      displayStart: nextDisplayStart,
      displayEnd: nextDisplayEnd,
    };
  });
  const nextBoundaries = recomputeEditableBoundariesFromSegmentMap(
    nextSegmentMap,
    nextDisplay,
  );
  return {
    ...baseProjection,
    displayText: nextDisplay,
    segmentMap: nextSegmentMap,
    editableBoundaries: nextBoundaries,
  };
}

export {
  buildCanonicalSessionScopeMeta,
  buildCanonicalScopeKey,
  canonicalizeForCompareAndUnproject,
  buildProjectionForCanonicalizedDisplay,
};
