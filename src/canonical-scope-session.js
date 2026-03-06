function normalizeScopeKind(scopeKind = "field") {
  const raw = String(scopeKind || "")
    .trim()
    .toLowerCase();
  if (raw === "doc") return "document";
  if (raw === "document") return "document";
  if (raw === "section") return "section";
  if (raw === "subsection" || raw === "sub") return "subsection";
  return "field";
}

function normalizeFieldMarkerName(name) {
  const value = String(name || "");
  return value.endsWith("...") ? value.slice(0, -3) : value;
}

function normalizeCanonicalText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function hashTextIdentity(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

function parseMarkersWithOffsets(markdown) {
  const text = normalizeCanonicalText(markdown);
  const markerRegex =
    /^[\t ]*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->[\t ]*(?:\n|$)/gm;
  const markers = [];
  let currentSection = "";
  let currentSubsection = "";
  let match;
  while ((match = markerRegex.exec(text))) {
    const rawName = String(match[1] || "");
    const lineStart = match.index;
    const lineEnd = markerRegex.lastIndex;
    let kind = "field";
    let name = rawName;
    if (rawName.startsWith("section:")) {
      kind = "section";
      name = rawName.slice("section:".length);
      currentSection = name;
      currentSubsection = "";
    } else if (rawName.startsWith("subsection:")) {
      kind = "subsection";
      name = rawName.slice("subsection:".length);
      currentSubsection = name;
    } else if (rawName.startsWith("sub:")) {
      kind = "subsection";
      name = rawName.slice("sub:".length);
      currentSubsection = name;
    } else {
      name = normalizeFieldMarkerName(rawName);
    }
    markers.push({
      rawName,
      kind,
      name,
      section: currentSection,
      subsection: currentSubsection,
      lineStart,
      lineEnd,
    });
  }
  return markers;
}

function parseSectionMarkersWithOffsets(markdown) {
  const text = normalizeCanonicalText(markdown);
  const markerRegex =
    /^[\t ]*<!--\s*section:([a-zA-Z0-9_:.\/-]+)\s*-->[\t ]*(?:\n|$)/gm;
  const markers = [];
  let match;
  while ((match = markerRegex.exec(text))) {
    markers.push({
      name: String(match[1] || ""),
      lineStart: match.index,
      lineEnd: markerRegex.lastIndex,
    });
  }
  return markers;
}

function codeUnitIndexToUtf8ByteOffset(text, codeUnitIndex) {
  const input = String(text || "");
  const index = Math.max(0, Math.min(input.length, Number(codeUnitIndex) || 0));
  return new TextEncoder().encode(input.slice(0, index)).length;
}

function countLeadingNewlines(text) {
  const value = String(text || "");
  let count = 0;
  while (count < value.length && value.charAt(count) === "\n") {
    count += 1;
  }
  return count;
}

function countTrailingNewlines(text) {
  const value = String(text || "");
  let count = 0;
  while (count < value.length && value.charAt(value.length - 1 - count) === "\n") {
    count += 1;
  }
  return count;
}

function countBaselineNewlinesBeforeOffset(text, offsetCu) {
  const value = String(text || "");
  const offset = Math.max(0, Math.min(value.length, Number(offsetCu || 0)));
  let cursor = offset - 1;
  let count = 0;
  while (cursor >= 0 && value.charAt(cursor) === "\n") {
    count += 1;
    cursor -= 1;
  }
  return count;
}

function buildFieldNameVariants(value) {
  const raw = String(value || "").trim();
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
      marker.section === normalizedSection &&
      marker.subsection === normalizedSubsection &&
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
        marker.section === normalizedSection &&
        variants.includes(String(marker.name || "")),
    );
  if (sectionMatches.length === 1) return sectionMatches[0].index;

  return -1;
}

export function resolveCanonicalScopeSlice(canonicalMarkdown, scopeMeta = {}) {
  const canonicalDoc = normalizeCanonicalText(canonicalMarkdown);
  const scopeKind = normalizeScopeKind(scopeMeta.scopeKind || "field");
  const markers = parseMarkersWithOffsets(canonicalDoc);

  if (scopeKind !== "document" && markers.length === 0) {
    throw new Error("[mfe] canonical-scope-session: no markers in canonical doc");
  }

  let sliceStartCu = 0;
  let sliceEndCu = canonicalDoc.length;
  let targetIndex = -1;

  if (scopeKind !== "document") {
    const section = String(scopeMeta.section || "");
    const subsection = String(scopeMeta.subsection || "");
    const scopeName = String(scopeMeta.name || "");
    const targetSection =
      scopeKind === "section" ? scopeName || section : section;
    const targetSubsection =
      scopeKind === "subsection" ? scopeName || subsection : subsection;

    if (scopeKind === "section") {
      const sectionMarkers = parseSectionMarkersWithOffsets(canonicalDoc);
      const sectionIndex = sectionMarkers.findIndex(
        (marker) => String(marker?.name || "") === targetSection,
      );
      if (sectionIndex < 0) {
        throw new Error(
          `[mfe] canonical-scope-session: section marker not found (${targetSection})`,
        );
      }
      sliceStartCu = Number(sectionMarkers[sectionIndex].lineStart || 0);
      sliceEndCu =
        sectionIndex + 1 < sectionMarkers.length
          ? Number(sectionMarkers[sectionIndex + 1].lineStart || canonicalDoc.length)
          : canonicalDoc.length;
    } else {
      for (let index = 0; index < markers.length; index += 1) {
        const marker = markers[index];
        if (scopeKind === "subsection") {
        if (
          marker.kind === "subsection" &&
          marker.section === section &&
          marker.name === targetSubsection
        ) {
          targetIndex = index;
          break;
        }
        }
      }
      if (scopeKind === "field") {
        targetIndex = findFieldMarkerIndex(markers, section, subsection, scopeName);
      }
      if (targetIndex < 0) {
        throw new Error(
          `[mfe] canonical-scope-session: scope marker not found (${scopeKind}:${section}:${subsection}:${scopeName})`,
        );
      }

      const targetMarker = markers[targetIndex];
      sliceStartCu = targetMarker.lineStart;
      sliceEndCu = canonicalDoc.length;
      for (let index = targetIndex + 1; index < markers.length; index += 1) {
        const marker = markers[index];
        if (
          marker.kind === "section" ||
          (scopeKind === "subsection" &&
            marker.kind === "subsection" &&
            marker.section === targetMarker.section) ||
          (scopeKind === "field" &&
            marker.kind === "subsection" &&
            marker.section === targetMarker.section) ||
          (scopeKind === "field" &&
            marker.kind === "field" &&
            marker.section === targetMarker.section &&
            marker.subsection === targetMarker.subsection)
        ) {
          sliceEndCu = marker.lineStart;
          break;
        }
      }
    }
  }

  const canonicalSlice = canonicalDoc.slice(sliceStartCu, sliceEndCu);
  if (scopeKind === "section") {
    const section = String(scopeMeta.section || "");
    const scopeName = String(scopeMeta.name || "");
    const targetSection = scopeName || section;
    const expectedStart = `<!-- section:${targetSection} -->`;
    if (!canonicalSlice.startsWith(expectedStart)) {
      throw new Error(
        `[mfe] invariant violation: section slice must start with defining marker (${expectedStart})`,
      );
    }
    const sectionMarkerCount = (canonicalSlice.match(/<!--\s*section:/g) || []).length;
    if (sectionMarkerCount !== 1) {
      throw new Error(
        `[mfe] invariant violation: section slice contains unexpected section markers (count=${sectionMarkerCount})`,
      );
    }
  }
  const baselineCanonicalSliceRaw = canonicalSlice;
  const protectedSpans = markers
    .filter(
      (marker) => marker.lineStart >= sliceStartCu && marker.lineEnd <= sliceEndCu,
    )
    .map((marker) => {
      const startCu = marker.lineStart - sliceStartCu;
      const endCu = marker.lineEnd - sliceStartCu;
      const text = baselineCanonicalSliceRaw.slice(startCu, endCu);
      const rawName = String(marker.rawName || "");
      return {
        kind: "structural-marker",
        start: codeUnitIndexToUtf8ByteOffset(baselineCanonicalSliceRaw, startCu),
        end: codeUnitIndexToUtf8ByteOffset(baselineCanonicalSliceRaw, endCu),
        startCu,
        endCu,
        sha256: hashTextIdentity(text),
        markerRawName: rawName,
        markerKind: String(marker.kind || ""),
        markerName: String(marker.name || ""),
        markerSection: String(marker.section || ""),
        markerSubsection: String(marker.subsection || ""),
        markerFieldIsContainer:
          String(marker.kind || "") === "field" && rawName.endsWith("..."),
      };
    });

  return {
    scopeKind,
    canonicalDoc,
    canonicalSlice,
    baselineCanonicalSliceRaw,
    markers,
    sliceStart: codeUnitIndexToUtf8ByteOffset(canonicalDoc, sliceStartCu),
    sliceEnd: codeUnitIndexToUtf8ByteOffset(canonicalDoc, sliceEndCu),
    sliceStartCu,
    sliceEndCu,
    protectedSpans,
  };
}

export function projectCanonicalSlice(scopeSlice) {
  const collectMarkdownBlockStarts = (text) => {
    const source = String(text || "");
    if (!source) return [];
    const starts = [];
    let lineStart = 0;
    let inBlock = false;
    for (let index = 0; index <= source.length; index += 1) {
      const atEnd = index === source.length;
      if (!atEnd && source.charAt(index) !== "\n") continue;
      const line = source.slice(lineStart, index);
      const hasContent = line.trim().length > 0;
      if (hasContent && !inBlock) {
        starts.push(lineStart);
        inBlock = true;
      } else if (!hasContent) {
        inBlock = false;
      }
      lineStart = index + 1;
    }
    return starts;
  };
  const findFirstBlockOrdinalInRange = (blockStarts, displayStart, displayEnd) => {
    const starts = Array.isArray(blockStarts) ? blockStarts : [];
    const start = Math.max(0, Number(displayStart || 0));
    const end = Math.max(start, Number(displayEnd || start));
    for (let index = 0; index < starts.length; index += 1) {
      const blockStart = Number(starts[index] || 0);
      if (blockStart < start) continue;
      if (blockStart >= end) break;
      return index;
    }
    return -1;
  };
  const canonicalSlice = String(scopeSlice?.canonicalSlice || "");
  const spans = Array.isArray(scopeSlice?.protectedSpans)
    ? scopeSlice.protectedSpans
        .slice()
        .sort((left, right) => Number(left.startCu || 0) - Number(right.startCu || 0))
    : [];
  const segmentMap = [];
  let cursorCu = 0;
  let displayText = "";
  let displayOffset = 0;
  const editableBoundaries = [];

  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    const startCu = Math.max(0, Number(span.startCu || 0));
    const endCu = Math.max(startCu, Number(span.endCu || 0));
    const editableText = canonicalSlice.slice(cursorCu, startCu);
    const editableStart = displayOffset;
    displayText += editableText;
    displayOffset += editableText.length;
    segmentMap.push({
      kind: "editable",
      canonicalStart: codeUnitIndexToUtf8ByteOffset(canonicalSlice, cursorCu),
      canonicalEnd: codeUnitIndexToUtf8ByteOffset(canonicalSlice, startCu),
      displayStart: editableStart,
      displayEnd: displayOffset,
    });
    editableBoundaries.push(displayOffset);
    segmentMap.push({
      kind: "protected",
      canonicalStart: codeUnitIndexToUtf8ByteOffset(canonicalSlice, startCu),
      canonicalEnd: codeUnitIndexToUtf8ByteOffset(canonicalSlice, endCu),
      displayStart: displayOffset,
      displayEnd: displayOffset,
    });
    cursorCu = endCu;
  }

  const tailEditableText = canonicalSlice.slice(cursorCu);
  const tailEditableStart = displayOffset;
  displayText += tailEditableText;
  displayOffset += tailEditableText.length;
  segmentMap.push({
    kind: "editable",
    canonicalStart: codeUnitIndexToUtf8ByteOffset(canonicalSlice, cursorCu),
    canonicalEnd: codeUnitIndexToUtf8ByteOffset(canonicalSlice, canonicalSlice.length),
    displayStart: tailEditableStart,
    displayEnd: displayOffset,
  });

  const markdownBlockStarts = collectMarkdownBlockStarts(displayText);
  const firstBlockOrdinalByEditablePartIndex = new Map();
  segmentMap.forEach((part, partIndex) => {
    if (String(part?.kind || "") !== "editable") return;
    const ordinal = findFirstBlockOrdinalInRange(
      markdownBlockStarts,
      Number(part?.displayStart || 0),
      Number(part?.displayEnd || 0),
    );
    if (ordinal >= 0) {
      firstBlockOrdinalByEditablePartIndex.set(partIndex, ordinal);
    }
  });
  const protectedSpanAnchorOrdinals = new Array(spans.length).fill(-1);
  let protectedPartCursor = 0;
  segmentMap.forEach((part, partIndex) => {
    if (String(part?.kind || "") !== "protected") return;
    let targetOrdinal = -1;
    for (
      let nextPartIndex = partIndex + 1;
      nextPartIndex < segmentMap.length;
      nextPartIndex += 1
    ) {
      if (!firstBlockOrdinalByEditablePartIndex.has(nextPartIndex)) continue;
      targetOrdinal = Number(firstBlockOrdinalByEditablePartIndex.get(nextPartIndex));
      break;
    }
    if (protectedPartCursor < protectedSpanAnchorOrdinals.length) {
      protectedSpanAnchorOrdinals[protectedPartCursor] = targetOrdinal;
    }
    protectedPartCursor += 1;
  });
  const annotatedSpans = spans.map((span, index) => ({
    ...span,
    anchorBlockOrdinal: Number(protectedSpanAnchorOrdinals[index] ?? -1),
  }));

  return {
    displayText,
    segmentMap,
    protectedSpans: annotatedSpans,
    editableBoundaries,
    editablePartCount: spans.length + 1,
  };
}

export function recomputeEditableBoundariesFromSegmentMap(
  segmentMap,
  currentDisplayText,
) {
  const parts = Array.isArray(segmentMap) ? segmentMap : [];
  const editableParts = parts.filter((part) => String(part?.kind || "") === "editable");
  const nonEmptyEditableParts = editableParts.filter((part) => {
    const displayStart = Number(part?.displayStart || 0);
    const displayEnd = Number(part?.displayEnd || 0);
    const canonicalStart = Number(part?.canonicalStart || 0);
    const canonicalEnd = Number(part?.canonicalEnd || 0);
    return !(displayStart === displayEnd && canonicalStart === canonicalEnd);
  });
  const boundaryCount = nonEmptyEditableParts.length;
  if (boundaryCount === 0) return [];
  const currentLength = String(currentDisplayText || "").length;
  const baselineLengths = nonEmptyEditableParts.map((part) =>
    Math.max(
      0,
      Number(part?.displayEnd || 0) - Number(part?.displayStart || 0),
    ),
  );
  const totalBaseline = baselineLengths.reduce((sum, len) => sum + len, 0);
  const boundaries = [0];
  let cumulative = baselineLengths[0] || 0;
  for (let index = 1; index < boundaryCount; index += 1) {
    const ratio =
      totalBaseline > 0
        ? cumulative / totalBaseline
        : index / boundaryCount;
    const start = Math.max(0, Math.min(currentLength, Math.round(currentLength * ratio)));
    boundaries.push(start);
    cumulative += baselineLengths[index] || 0;
  }
  let floor = 0;
  for (let index = 0; index < boundaries.length; index += 1) {
    const next = Math.max(floor, boundaries[index]);
    boundaries[index] = next;
    floor = next + 1;
  }
  boundaries[0] = 0;
  return boundaries;
}

export function unprojectDisplayToCanonicalSlice(displayText, scopeSlice, projection) {
  const editedDisplay = String(displayText || "");
  const baselineCanonicalSliceRaw = String(
    scopeSlice?.baselineCanonicalSliceRaw || scopeSlice?.canonicalSlice || "",
  );
  const parts = Array.isArray(projection?.segmentMap) ? projection.segmentMap : [];
  const spans = Array.isArray(scopeSlice?.protectedSpans)
    ? scopeSlice.protectedSpans
        .slice()
        .sort((left, right) => Number(left.startCu || 0) - Number(right.startCu || 0))
    : [];
  const boundaries = Array.isArray(projection?.editableBoundaries)
    ? projection.editableBoundaries.map((value) => Math.max(0, Number(value || 0)))
    : [];
  const editableParts = parts.filter((part) => String(part?.kind || "") === "editable");
  const nonEmptyEditableParts = editableParts.filter((part) => {
    const displayStart = Number(part?.displayStart || 0);
    const displayEnd = Number(part?.displayEnd || 0);
    const canonicalStart = Number(part?.canonicalStart || 0);
    const canonicalEnd = Number(part?.canonicalEnd || 0);
    return !(displayStart === displayEnd && canonicalStart === canonicalEnd);
  });
  if (boundaries.length !== nonEmptyEditableParts.length) {
    throw new Error(
      "[mfe] invariant violation: boundaries/nonEmptyEditable mismatch",
    );
  }

  const cutpoints = [...boundaries, editedDisplay.length];
  const nonEmptyEditableSegments = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    const rawStart = Number(cutpoints[index] || 0);
    const rawEnd = Number(cutpoints[index + 1] || 0);
    const start = Math.max(0, Math.min(editedDisplay.length, rawStart));
    const end = Math.max(start, Math.min(editedDisplay.length, rawEnd));
    nonEmptyEditableSegments.push(editedDisplay.slice(start, end));
  }

  const editableSegmentsByPart = [];
  let nonEmptyCursor = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (String(part?.kind || "") !== "editable") continue;
    const displayStart = Number(part?.displayStart || 0);
    const displayEnd = Number(part?.displayEnd || 0);
    const canonicalStart = Number(part?.canonicalStart || 0);
    const canonicalEnd = Number(part?.canonicalEnd || 0);
    const isEmptyBaselineEditable =
      displayStart === displayEnd && canonicalStart === canonicalEnd;
    editableSegmentsByPart[index] = isEmptyBaselineEditable
      ? ""
      : String(nonEmptyEditableSegments[nonEmptyCursor] || "");
    if (!isEmptyBaselineEditable) nonEmptyCursor += 1;
  }

  let spanIndexForBoundary = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (String(part?.kind || "") !== "protected") continue;
    const span = spans[spanIndexForBoundary];
    spanIndexForBoundary += 1;
    const requiredBefore = countBaselineNewlinesBeforeOffset(
      baselineCanonicalSliceRaw,
      Number(span?.startCu || 0),
    );
    if (requiredBefore <= 0) continue;

    let prevEditablePartIndex = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (String(parts[cursor]?.kind || "") === "editable") {
        prevEditablePartIndex = cursor;
        break;
      }
    }
    if (prevEditablePartIndex < 0) continue;

    let nextEditablePartIndex = -1;
    for (let cursor = index + 1; cursor < parts.length; cursor += 1) {
      if (String(parts[cursor]?.kind || "") === "editable") {
        nextEditablePartIndex = cursor;
        break;
      }
    }

    let prevText = String(editableSegmentsByPart[prevEditablePartIndex] || "");
    const trailingNewlineCount = countTrailingNewlines(prevText);
    const missing = requiredBefore - trailingNewlineCount;
    if (missing <= 0) continue;
    if (nextEditablePartIndex < 0) continue;

    let nextText = String(editableSegmentsByPart[nextEditablePartIndex] || "");
    const availableFromNext = countLeadingNewlines(nextText);
    const takeFromNext = Math.min(
      missing,
      availableFromNext,
      Math.max(0, prevText.length),
    );
    if (takeFromNext <= 0) continue;

    // Keep protected span offsets stable: swap equal-length tails/heads across the boundary.
    const replaceEnd = Math.max(0, prevText.length - trailingNewlineCount);
    const replaceStart = Math.max(0, replaceEnd - takeFromNext);
    const displacedTail = prevText.slice(replaceStart, replaceEnd);
    if (/[^\n]/.test(displacedTail)) continue;
    prevText = `${prevText.slice(0, replaceStart)}${"\n".repeat(takeFromNext)}${prevText.slice(replaceEnd)}`;
    nextText = `${displacedTail}${nextText.slice(takeFromNext)}`;

    editableSegmentsByPart[prevEditablePartIndex] = prevText;
    editableSegmentsByPart[nextEditablePartIndex] = nextText;
  }

  let rebuilt = "";
  let protectedIndex = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (String(part?.kind || "") === "protected") {
      const span = spans[protectedIndex];
      rebuilt += baselineCanonicalSliceRaw.slice(
        Number(span?.startCu || 0),
        Number(span?.endCu || Number(span?.startCu || 0)),
      );
      protectedIndex += 1;
      continue;
    }
    const displayStart = Number(part?.displayStart || 0);
    const displayEnd = Number(part?.displayEnd || 0);
    const canonicalStart = Number(part?.canonicalStart || 0);
    const canonicalEnd = Number(part?.canonicalEnd || 0);
    const isEmptyBaselineEditable =
      displayStart === displayEnd && canonicalStart === canonicalEnd;
    if (isEmptyBaselineEditable) {
      rebuilt += "";
      continue;
    }
    rebuilt += String(editableSegmentsByPart[index] || "");
  }
  return rebuilt;
}

export function validateProtectedSpansUnchanged(canonicalEditedSlice, scopeSlice) {
  const edited = String(canonicalEditedSlice || "");
  const baselineRaw = String(
    scopeSlice?.baselineCanonicalSliceRaw || scopeSlice?.canonicalSlice || "",
  );
  const spans = Array.isArray(scopeSlice?.protectedSpans) ? scopeSlice.protectedSpans : [];
  const baselineHashes = spans.map((span) => {
    const startCu = Number(span?.startCu || 0);
    const endCu = Number(span?.endCu || startCu);
    return hashTextIdentity(baselineRaw.slice(startCu, endCu));
  });
  const editedMarkerHashes = parseMarkersWithOffsets(edited).map((marker) =>
    hashTextIdentity(edited.slice(marker.lineStart, marker.lineEnd)),
  );
  if (baselineHashes.length !== editedMarkerHashes.length) {
    return {
      ok: false,
      reason: "protected-span-count-mismatch",
      expected: baselineHashes.length,
      actual: editedMarkerHashes.length,
    };
  }
  for (let index = 0; index < spans.length; index += 1) {
    const baselineHash = String(baselineHashes[index] || "");
    const editedHash = String(editedMarkerHashes[index] || "");
    if (baselineHash !== editedHash) {
      return {
        ok: false,
        reason: "protected-span-hash-mismatch",
        index,
        baselineHash,
        editedHash,
      };
    }
  }
  return {
    ok: true,
    reason: "ok",
  };
}
