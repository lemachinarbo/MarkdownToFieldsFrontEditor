import { normalizeScopeKind } from "./scope-slice.js";
import {
  assertStructuralMarkerGraphEqual,
  hasStructuralMarkerBoundaryViolations,
  parseStructuralDocument,
  resolveStructuralScopeRange,
  serializeStructuralDocument,
} from "./structural-document.js";
import {
  projectCanonicalSlice,
  recomputeEditableBoundariesFromSegmentMap,
  resolveCanonicalScopeSlice,
  unprojectDisplayToCanonicalSlice,
  validateProtectedSpansUnchanged,
} from "./canonical-scope-session.js";
import {
  selectEditableBoundaries,
} from "./canonical-boundary-selection.js";

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeReplacementForBoundary({
  replacement,
  originalSlice,
  hasNextMarker,
}) {
  let next = normalizeText(replacement);
  const current = normalizeText(originalSlice);
  const leadingNewlines = (current.match(/^\n+/) || [""])[0];
  const trailingNewlines = hasNextMarker ? (current.match(/\n+$/) || [""])[0] : "";

  if (leadingNewlines && !next.startsWith("\n")) {
    next = `${leadingNewlines}${next.replace(/^\n+/, "")}`;
  }
  if (trailingNewlines) {
    next = `${next.replace(/\n+$/g, "")}${trailingNewlines}`;
  } else if (hasNextMarker && !/\n$/.test(next)) {
    next = `${next}\n`;
  }

  return next;
}

function normalizeDisplayForScopedProjection({ replacement, baselineDisplay }) {
  let next = normalizeText(replacement);
  const baseline = normalizeText(baselineDisplay);
  const leadingNewlines = (baseline.match(/^\n+/) || [""])[0];
  const trailingNewlines = (baseline.match(/\n+$/) || [""])[0];

  if (leadingNewlines && !next.startsWith("\n")) {
    next = `${leadingNewlines}${next.replace(/^\n+/, "")}`;
  }
  if (trailingNewlines) {
    next = `${next.replace(/\n+$/g, "")}${trailingNewlines}`;
  }

  return next;
}

function enforceMarkerBlankLineSeparation(markdown) {
  const text = normalizeText(markdown);
  // Keep marker lines on structural boundaries to avoid rendering marker comments
  // as escaped inline text when preceding prose collapses to a single newline.
  return text.replace(
    /([^\n])\n(?=[\t ]*<!--\s*[a-zA-Z0-9_:.\/-]+\s*-->)/g,
    "$1\n\n",
  );
}

function computeFirstDiffIndex(beforeText, afterText) {
  const before = String(beforeText || "");
  const after = String(afterText || "");
  const max = Math.min(before.length, after.length);
  for (let index = 0; index < max; index += 1) {
    if (before.charAt(index) !== after.charAt(index)) return index;
  }
  return before.length === after.length ? -1 : max;
}

function readEditablePartsFromSegmentMap(segmentMap, displayText) {
  const parts = [];
  const segments = Array.isArray(segmentMap) ? segmentMap : [];
  const display = String(displayText || "");
  let cursor = 0;
  for (const segment of segments) {
    if (String(segment?.kind || "") !== "editable") continue;
    const start = Number(segment?.displayStart || 0);
    const end = Number(segment?.displayEnd || start);
    const safeStart = Math.max(0, Math.min(display.length, start));
    const safeEnd = Math.max(safeStart, Math.min(display.length, end));
    const text = display.slice(safeStart, safeEnd);
    parts.push({
      index: parts.length,
      startOffset: cursor,
      endOffset: cursor + text.length,
      text,
    });
    cursor += text.length;
  }
  return parts;
}

function isEmptyBaselineEditablePart(part) {
  const displayStart = Number(part?.displayStart || 0);
  const displayEnd = Number(part?.displayEnd || 0);
  const canonicalStart = Number(part?.canonicalStart || 0);
  const canonicalEnd = Number(part?.canonicalEnd || 0);
  return displayStart === displayEnd && canonicalStart === canonicalEnd;
}

function countNonEmptyEditableParts(segmentMap) {
  const parts = Array.isArray(segmentMap) ? segmentMap : [];
  const editableParts = parts.filter((part) => String(part?.kind || "") === "editable");
  return editableParts.filter((part) => !isEmptyBaselineEditablePart(part)).length;
}

function remapBoundariesFromProtectedSlots(boundaries, segmentMap, displayLength) {
  const parts = Array.isArray(segmentMap) ? segmentMap : [];
  const editableParts = parts.filter((part) => String(part?.kind || "") === "editable");
  if (!editableParts.length) return [];

  const clampedStarts = [];
  for (let index = 0; index < editableParts.length; index += 1) {
    const rawStart =
      index === 0
        ? 0
        : Number(
            boundaries[index - 1] ??
              boundaries[boundaries.length - 1] ??
              0,
          );
    clampedStarts.push(
      Math.max(0, Math.min(Number(displayLength || 0), Math.round(rawStart))),
    );
  }

  const projected = [];
  for (let index = 0; index < editableParts.length; index += 1) {
    if (isEmptyBaselineEditablePart(editableParts[index])) continue;
    projected.push(clampedStarts[index]);
  }
  return projected;
}

function countConsecutiveNewlinesBeforeOffset(text, offset) {
  const value = String(text || "");
  const start = Math.max(0, Math.min(value.length, Number(offset || 0)));
  let cursor = start - 1;
  let count = 0;
  while (cursor >= 0 && value.charAt(cursor) === "\n") {
    count += 1;
    cursor -= 1;
  }
  return count;
}

function repairProtectedMarkerLeadingNewlines(canonicalEditedSlice, scopeSlice) {
  const baselineRaw = String(
    scopeSlice?.baselineCanonicalSliceRaw || scopeSlice?.canonicalSlice || "",
  );
  const spans = Array.isArray(scopeSlice?.protectedSpans)
    ? scopeSlice.protectedSpans
        .slice()
        .sort((left, right) => Number(left.startCu || 0) - Number(right.startCu || 0))
    : [];
  if (!spans.length) return String(canonicalEditedSlice || "");

  let edited = String(canonicalEditedSlice || "");
  let searchFrom = 0;
  for (const span of spans) {
    const startCu = Math.max(0, Number(span?.startCu || 0));
    const endCu = Math.max(startCu, Number(span?.endCu || startCu));
    const markerText = baselineRaw.slice(startCu, endCu);
    if (!markerText) continue;
    const markerIndex = edited.indexOf(markerText, searchFrom);
    if (markerIndex < 0) return null;

    const requiredBefore = countConsecutiveNewlinesBeforeOffset(
      baselineRaw,
      startCu,
    );
    if (requiredBefore > 0) {
      const currentBefore = countConsecutiveNewlinesBeforeOffset(
        edited,
        markerIndex,
      );
      const missing = requiredBefore - currentBefore;
      if (missing > 0) {
        edited = `${edited.slice(0, markerIndex)}${"\n".repeat(missing)}${edited.slice(markerIndex)}`;
        searchFrom = markerIndex + missing + markerText.length;
        continue;
      }
    }
    searchFrom = markerIndex + markerText.length;
  }

  return edited;
}

function selectSinglePartEditedTexts(baselineParts, editedDisplay) {
  const display = String(editedDisplay || "");
  const baselineTexts = baselineParts.map((part) => String(part?.text || ""));
  const baselineJoined = baselineTexts.join("");
  if (display === baselineJoined) return baselineTexts.slice();

  const firstDiff = computeFirstDiffIndex(baselineJoined, display);
  const preferredPartIndex = baselineParts.findIndex(
    (part) =>
      firstDiff >= 0 &&
      firstDiff >= Number(part.startOffset || 0) &&
      firstDiff <= Number(part.endOffset || 0),
  );
  const candidates = [];

  for (let index = 0; index < baselineTexts.length; index += 1) {
    const prefix = baselineTexts.slice(0, index).join("");
    const suffix = baselineTexts.slice(index + 1).join("");
    if (!display.startsWith(prefix) || !display.endsWith(suffix)) continue;
    const middleStart = prefix.length;
    const middleEnd = display.length - suffix.length;
    if (middleEnd < middleStart) continue;
    const replacement = display.slice(middleStart, middleEnd);
    const candidate = baselineTexts.slice();
    candidate[index] = replacement;
    candidates.push({
      index,
      editedTexts: candidate,
      delta: Math.abs(replacement.length - baselineTexts[index].length),
      preferred:
        preferredPartIndex >= 0 && preferredPartIndex === index ? 1 : 0,
    });
  }

  if (!candidates.length) return null;
  candidates.sort((left, right) => {
    if (right.preferred !== left.preferred) return right.preferred - left.preferred;
    return left.delta - right.delta;
  });
  return candidates[0].editedTexts;
}

function rebuildCanonicalSliceFromEditableTexts({
  scopeSlice,
  segmentMap,
  editableTexts,
}) {
  const spans = Array.isArray(scopeSlice?.protectedSpans)
    ? scopeSlice.protectedSpans
    : [];
  const baselineCanonicalSliceRaw = String(
    scopeSlice?.baselineCanonicalSliceRaw || scopeSlice?.canonicalSlice || "",
  );
  let rebuilt = "";
  let editableIndex = 0;
  let protectedIndex = 0;
  const segments = Array.isArray(segmentMap) ? segmentMap : [];
  for (const segment of segments) {
    if (String(segment?.kind || "") === "protected") {
      const span = spans[protectedIndex];
      protectedIndex += 1;
      if (!span) continue;
      rebuilt += baselineCanonicalSliceRaw.slice(
        Number(span?.startCu || 0),
        Number(span?.endCu || Number(span?.startCu || 0)),
      );
      continue;
    }
    rebuilt += String(editableTexts[editableIndex] || "");
    editableIndex += 1;
  }
  return rebuilt;
}

function buildLcsDiffOperations(beforeText, afterText) {
  const before = String(beforeText || "");
  const after = String(afterText || "");
  const beforeLength = before.length;
  const afterLength = after.length;
  const width = afterLength + 1;
  const table = new Uint16Array((beforeLength + 1) * width);

  for (let beforeIndex = 1; beforeIndex <= beforeLength; beforeIndex += 1) {
    const beforeCode = before.charCodeAt(beforeIndex - 1);
    const rowOffset = beforeIndex * width;
    const previousRowOffset = (beforeIndex - 1) * width;
    for (let afterIndex = 1; afterIndex <= afterLength; afterIndex += 1) {
      if (beforeCode === after.charCodeAt(afterIndex - 1)) {
        table[rowOffset + afterIndex] =
          table[previousRowOffset + (afterIndex - 1)] + 1;
      } else {
        const left = table[rowOffset + (afterIndex - 1)];
        const up = table[previousRowOffset + afterIndex];
        table[rowOffset + afterIndex] = left >= up ? left : up;
      }
    }
  }

  let beforeIndex = beforeLength;
  let afterIndex = afterLength;
  const reverseSteps = [];
  while (beforeIndex > 0 || afterIndex > 0) {
    if (
      beforeIndex > 0 &&
      afterIndex > 0 &&
      before.charCodeAt(beforeIndex - 1) === after.charCodeAt(afterIndex - 1)
    ) {
      reverseSteps.push({ kind: "equal", char: before.charAt(beforeIndex - 1) });
      beforeIndex -= 1;
      afterIndex -= 1;
      continue;
    }
    const up =
      beforeIndex > 0 ? table[(beforeIndex - 1) * width + afterIndex] : -1;
    const left =
      afterIndex > 0 ? table[beforeIndex * width + (afterIndex - 1)] : -1;
    if (afterIndex > 0 && left >= up) {
      reverseSteps.push({ kind: "insert", char: after.charAt(afterIndex - 1) });
      afterIndex -= 1;
    } else {
      reverseSteps.push({ kind: "delete", char: before.charAt(beforeIndex - 1) });
      beforeIndex -= 1;
    }
  }

  reverseSteps.reverse();
  const operations = [];
  for (const step of reverseSteps) {
    const last = operations[operations.length - 1];
    if (last && last.kind === step.kind) {
      last.text += step.char;
      continue;
    }
    operations.push({
      kind: step.kind,
      text: step.char,
    });
  }
  return operations;
}

function projectEditedDisplayIntoEditableTextsByLcs({
  segmentMap,
  baselineDisplay,
  editedDisplay,
}) {
  const baseline = String(baselineDisplay || "");
  const edited = String(editedDisplay || "");
  const editableParts = readEditablePartsFromSegmentMap(segmentMap, baseline);
  if (!editableParts.length) return [];

  const partIndexByBaselineOffset = new Int32Array(baseline.length);
  partIndexByBaselineOffset.fill(-1);
  for (const part of editableParts) {
    const start = Math.max(0, Number(part?.startOffset || 0));
    const end = Math.max(start, Number(part?.endOffset || start));
    for (let offset = start; offset < end && offset < baseline.length; offset += 1) {
      partIndexByBaselineOffset[offset] = Number(part?.index || 0);
    }
  }

  const chunkByPart = editableParts.map(() => []);
  const resolveInsertPartIndex = (baselineCursor) => {
    if (baseline.length <= 0) return 0;
    const clampedCursor = Math.max(0, Math.min(baseline.length, baselineCursor));
    if (clampedCursor > 0) {
      const previousPart = partIndexByBaselineOffset[clampedCursor - 1];
      if (previousPart >= 0) return previousPart;
    }
    if (clampedCursor < baseline.length) {
      const nextPart = partIndexByBaselineOffset[clampedCursor];
      if (nextPart >= 0) return nextPart;
    }
    return Math.max(0, editableParts.length - 1);
  };

  const operations = buildLcsDiffOperations(baseline, edited);
  let baselineCursor = 0;
  for (const operation of operations) {
    const kind = String(operation?.kind || "");
    const text = String(operation?.text || "");
    if (!text) continue;

    if (kind === "equal") {
      for (let index = 0; index < text.length; index += 1) {
        const partIndex =
          baselineCursor >= 0 && baselineCursor < partIndexByBaselineOffset.length
            ? partIndexByBaselineOffset[baselineCursor]
            : -1;
        if (partIndex >= 0) {
          chunkByPart[partIndex].push(text.charAt(index));
        }
        baselineCursor += 1;
      }
      continue;
    }

    if (kind === "delete") {
      baselineCursor += text.length;
      continue;
    }

    if (kind === "insert") {
      const partIndex = resolveInsertPartIndex(baselineCursor);
      chunkByPart[partIndex].push(text);
    }
  }

  if (baselineCursor !== baseline.length) {
    return null;
  }

  return chunkByPart.map((chunks) => chunks.join(""));
}

function selectScopedEditableBoundaries({
  baselineProjection,
  scopeSlice,
  editedDisplay,
  runtimeProjection,
}) {
  const deterministicBoundariesDiffWindow = normalizeBoundaryCandidate({
    boundaries: mapBaselineBoundariesThroughDiffWindow(
      baselineProjection.editableBoundaries,
      baselineProjection.displayText,
      editedDisplay,
    ),
    displayLength: editedDisplay.length,
    segmentMap: baselineProjection.segmentMap,
    boundarySlotCount: countNonEmptyEditableParts(baselineProjection.segmentMap),
  });
  const deterministicBoundariesProportional = recomputeEditableBoundariesFromSegmentMap(
    baselineProjection.segmentMap,
    editedDisplay,
  );
  const deterministicBoundaries = deterministicBoundariesDiffWindow.length
    ? deterministicBoundariesDiffWindow
    : deterministicBoundariesProportional;
  const runtimeBoundaries = Array.isArray(runtimeProjection?.editableBoundaries)
    ? runtimeProjection.editableBoundaries.map((value) =>
        Math.max(0, Number(value || 0)),
      )
    : [];
  const runtimeMeta =
    runtimeProjection?.projectionMeta &&
    typeof runtimeProjection.projectionMeta === "object"
      ? runtimeProjection.projectionMeta
      : {};
  const runtimeTrusted = Boolean(
    runtimeMeta.runtimeBoundariesTrusted &&
      [
        "tr-mapping",
        "runtime-boundaries-preserved",
        "runtime-boundaries-docpos-projected",
        "no-op-preserve",
      ].includes(String(runtimeMeta.updateMode || "")),
  );
  const protectedSpanCount = Array.isArray(scopeSlice?.protectedSpans)
    ? scopeSlice.protectedSpans.length
    : 0;
  const boundarySlotCount = countNonEmptyEditableParts(
    baselineProjection.segmentMap,
  );
  const selected = selectEditableBoundaries({
    runtimeBoundaries,
    deterministicBoundaries,
    displayLength: editedDisplay.length,
    protectedSpanCount: boundarySlotCount,
    runtimeTrusted,
    divergenceThreshold: 0,
  });
  return {
    selectedBoundaries: selected.selectedBoundaries,
    selectedBoundarySource: selected.selectedBoundarySource,
    deterministicBoundaries,
    deterministicBoundariesProportional,
    deterministicBoundariesDiffWindow,
    runtimeBoundaries,
    protectedSpanCount,
    boundarySlotCount,
  };
}

function normalizeBoundaryCandidate({
  boundaries,
  displayLength,
  segmentMap,
  boundarySlotCount,
}) {
  if (!Array.isArray(boundaries) || boundaries.length === 0) return [];
  const normalized = boundaries.map((value) => Math.max(0, Number(value || 0)));
  const expectedCount = Math.max(0, Number(boundarySlotCount || 0));
  const protectedPartCount = Array.isArray(segmentMap)
    ? segmentMap.filter((part) => String(part?.kind || "") === "protected").length
    : 0;

  let candidate = normalized;
  if (
    expectedCount > 0 &&
    candidate.length !== expectedCount &&
    protectedPartCount > 0 &&
    candidate.length === protectedPartCount
  ) {
    candidate = remapBoundariesFromProtectedSlots(
      candidate,
      segmentMap,
      displayLength,
    );
  }

  const isIntegerArray = candidate.every((value) => Number.isInteger(value));
  const withinDisplayRange = candidate.every(
    (value) => value >= 0 && value <= Number(displayLength || 0),
  );
  const isNonDecreasing = candidate.every((value, index) =>
    index === 0 ? true : value >= candidate[index - 1],
  );
  const matchesExpectedCount = candidate.length === expectedCount;
  if (
    !isIntegerArray ||
    !withinDisplayRange ||
    !isNonDecreasing ||
    !matchesExpectedCount
  ) {
    return [];
  }
  return candidate;
}

function computeDiffWindow(beforeText, afterText) {
  const before = String(beforeText || "");
  const after = String(afterText || "");
  const start = computeFirstDiffIndex(before, after);
  if (start < 0) {
    return {
      changed: false,
      start: -1,
      endBefore: before.length,
      endAfter: after.length,
      delta: 0,
    };
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before.charAt(endBefore - 1) === after.charAt(endAfter - 1)
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return {
    changed: true,
    start,
    endBefore,
    endAfter,
    delta: endAfter - endBefore,
  };
}

function mapBaselineBoundariesThroughDiffWindow(
  baselineBoundaries,
  baselineDisplay,
  editedDisplay,
) {
  const boundaries = Array.isArray(baselineBoundaries) ? baselineBoundaries : [];
  if (!boundaries.length) return [];
  const baseline = String(baselineDisplay || "");
  const edited = String(editedDisplay || "");
  const window = computeDiffWindow(baseline, edited);
  if (!window.changed) return boundaries.slice();
  const spanBefore = Math.max(0, window.endBefore - window.start);
  const spanAfter = Math.max(0, window.endAfter - window.start);
  const mapped = boundaries.map((boundary) => {
    const value = Math.max(0, Number(boundary || 0));
    if (value <= window.start) return value;
    if (value >= window.endBefore) return value + window.delta;
    if (spanBefore <= 0) return window.start;
    const ratio = (value - window.start) / spanBefore;
    return window.start + Math.round(spanAfter * ratio);
  });
  let floor = 0;
  for (let index = 0; index < mapped.length; index += 1) {
    const next = Math.max(floor, mapped[index]);
    mapped[index] = next;
    floor = next;
  }
  return mapped;
}

function unprojectWithBoundaryCandidate({
  editedDisplay,
  scopeSlice,
  baselineProjection,
  boundaries,
}) {
  let canonicalEditedSlice = unprojectDisplayToCanonicalSlice(
    editedDisplay,
    scopeSlice,
    {
      ...baselineProjection,
      displayText: editedDisplay,
      editableBoundaries: boundaries,
    },
  );
  let protectedValidation = validateProtectedSpansUnchanged(
    canonicalEditedSlice,
    scopeSlice,
  );
  if (
    !protectedValidation.ok &&
    String(protectedValidation.reason || "") === "protected-span-count-mismatch"
  ) {
    const repaired = repairProtectedMarkerLeadingNewlines(
      canonicalEditedSlice,
      scopeSlice,
    );
    if (typeof repaired === "string") {
      const repairedValidation = validateProtectedSpansUnchanged(
        repaired,
        scopeSlice,
      );
      if (repairedValidation.ok) {
        canonicalEditedSlice = repaired;
        protectedValidation = repairedValidation;
      }
    }
  }
  return {
    canonicalEditedSlice,
    protectedValidation,
  };
}

function tryBoundaryNeighborhoodSearch({
  seedBoundaries,
  source,
  editedDisplay,
  scopeSlice,
  baselineProjection,
  maxAttempts = 12000,
  radius = 2,
}) {
  const seed = Array.isArray(seedBoundaries) ? seedBoundaries.slice() : [];
  if (!seed.length) {
    return { ok: false, reason: `${source}:search-seed-empty` };
  }
  const deltas = [0];
  for (let step = 1; step <= Number(radius || 0); step += 1) {
    deltas.push(-step, step);
  }
  const displayLength = editedDisplay.length;
  const current = new Array(seed.length).fill(0);
  let attempts = 0;
  let failureReason = `${source}:search-exhausted`;

  const dfs = (index, floor) => {
    if (attempts >= maxAttempts) return null;
    if (index >= seed.length) {
      attempts += 1;
      try {
        const unprojected = unprojectWithBoundaryCandidate({
          editedDisplay,
          scopeSlice,
          baselineProjection,
          boundaries: current,
        });
        if (unprojected.protectedValidation.ok) {
          return unprojected.canonicalEditedSlice;
        }
        failureReason = `${source}:search:${String(unprojected.protectedValidation.reason || "protected-invalid")}`;
      } catch (error) {
        failureReason = `${source}:search:unproject:${String(error?.message || error || "unknown")}`;
      }
      return null;
    }
    const target = Number(seed[index] || 0);
    for (const delta of deltas) {
      if (attempts >= maxAttempts) return null;
      const raw = target + delta;
      const clamped = Math.max(
        floor,
        Math.min(displayLength, Number.isFinite(raw) ? raw : floor),
      );
      current[index] = clamped;
      const found = dfs(index + 1, clamped);
      if (found) return found;
    }
    return null;
  };

  const found = dfs(0, 0);
  if (found != null) {
    return { ok: true, canonicalEditedSlice: found, attempts };
  }
  return {
    ok: false,
    reason: failureReason,
    attempts,
  };
}

function applyProjectedScopeEdit({
  beforeBody,
  scopeMeta,
  editorContent,
  runtimeProjection = null,
}) {
  const scopeSlice = resolveCanonicalScopeSlice(beforeBody, scopeMeta);
  const baselineProjection = projectCanonicalSlice(scopeSlice);
  const baselineDisplay = String(baselineProjection.displayText || "");
  const editedDisplay = normalizeDisplayForScopedProjection({
    replacement: editorContent,
    baselineDisplay,
  });
  if (editedDisplay === baselineDisplay) {
    return {
      canonicalBody: beforeBody,
      editedDisplay,
      canonicalEditedSlice: String(scopeSlice.canonicalSlice || ""),
    };
  }
  const baselineEditableParts = readEditablePartsFromSegmentMap(
    baselineProjection.segmentMap,
    baselineDisplay,
  );
  const singlePartEditedTexts = selectSinglePartEditedTexts(
    baselineEditableParts,
    editedDisplay,
  );
  if (singlePartEditedTexts) {
    const canonicalEditedSlice = rebuildCanonicalSliceFromEditableTexts({
      scopeSlice,
      segmentMap: baselineProjection.segmentMap,
      editableTexts: singlePartEditedTexts,
    });
    const protectedValidation = validateProtectedSpansUnchanged(
      canonicalEditedSlice,
      scopeSlice,
    );
    if (protectedValidation.ok) {
      const canonicalBody = `${beforeBody.slice(0, Number(scopeSlice.sliceStartCu || 0))}${canonicalEditedSlice}${beforeBody.slice(Number(scopeSlice.sliceEndCu || 0))}`;
      return {
        canonicalBody,
        editedDisplay,
        canonicalEditedSlice,
      };
    }
  }
  const lcsProjectedEditableTexts = projectEditedDisplayIntoEditableTextsByLcs({
    segmentMap: baselineProjection.segmentMap,
    baselineDisplay,
    editedDisplay,
  });
  if (Array.isArray(lcsProjectedEditableTexts)) {
    const canonicalEditedSlice = rebuildCanonicalSliceFromEditableTexts({
      scopeSlice,
      segmentMap: baselineProjection.segmentMap,
      editableTexts: lcsProjectedEditableTexts,
    });
    const protectedValidation = validateProtectedSpansUnchanged(
      canonicalEditedSlice,
      scopeSlice,
    );
    if (protectedValidation.ok) {
      const canonicalBody = `${beforeBody.slice(0, Number(scopeSlice.sliceStartCu || 0))}${canonicalEditedSlice}${beforeBody.slice(Number(scopeSlice.sliceEndCu || 0))}`;
      return {
        canonicalBody,
        editedDisplay,
        canonicalEditedSlice,
      };
    }
  }
  const boundarySelection = selectScopedEditableBoundaries({
    baselineProjection,
    scopeSlice,
    editedDisplay,
    runtimeProjection,
  });
  const boundaryCandidates = [];
  const seen = new Set();
  const addBoundaryCandidate = (source, boundaries) => {
    const normalized = normalizeBoundaryCandidate({
      boundaries,
      displayLength: editedDisplay.length,
      segmentMap: baselineProjection.segmentMap,
      boundarySlotCount: boundarySelection.boundarySlotCount,
    });
    if (!normalized.length) return;
    const key = normalized.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    boundaryCandidates.push({ source: String(source || "candidate"), boundaries: normalized });
  };
  addBoundaryCandidate(
    boundarySelection.selectedBoundarySource,
    boundarySelection.selectedBoundaries,
  );
  addBoundaryCandidate(
    "baseline-diff-window-map",
    mapBaselineBoundariesThroughDiffWindow(
      baselineProjection.editableBoundaries,
      baselineDisplay,
      editedDisplay,
    ),
  );
  addBoundaryCandidate("baseline-projection", baselineProjection.editableBoundaries);
  addBoundaryCandidate(
    "deterministic-recompute",
    boundarySelection.deterministicBoundaries,
  );
  addBoundaryCandidate(
    "deterministic-recompute-proportional",
    boundarySelection.deterministicBoundariesProportional,
  );
  addBoundaryCandidate(
    "deterministic-diff-window-map",
    boundarySelection.deterministicBoundariesDiffWindow,
  );
  addBoundaryCandidate("runtime-projection", boundarySelection.runtimeBoundaries);

  const validationErrors = [];
  for (const candidate of boundaryCandidates) {
    try {
      const unprojected = unprojectWithBoundaryCandidate({
        editedDisplay,
        scopeSlice,
        baselineProjection,
        boundaries: candidate.boundaries,
      });
      if (!unprojected.protectedValidation.ok) {
        validationErrors.push(
          `${candidate.source}:${String(unprojected.protectedValidation.reason || "invalid")}`,
        );
        continue;
      }
      const canonicalEditedSlice = String(unprojected.canonicalEditedSlice || "");
      const canonicalBody = `${beforeBody.slice(0, Number(scopeSlice.sliceStartCu || 0))}${canonicalEditedSlice}${beforeBody.slice(Number(scopeSlice.sliceEndCu || 0))}`;
      return {
        canonicalBody,
        editedDisplay,
        canonicalEditedSlice,
      };
    } catch (error) {
      validationErrors.push(
        `${candidate.source}:unproject:${String(error?.message || error || "unknown")}`,
      );
      continue;
    }
  }
  for (const candidate of boundaryCandidates) {
    const searchResult = tryBoundaryNeighborhoodSearch({
      seedBoundaries: candidate.boundaries,
      source: candidate.source,
      editedDisplay,
      scopeSlice,
      baselineProjection,
    });
    if (!searchResult.ok) {
      validationErrors.push(String(searchResult.reason || `${candidate.source}:search-failed`));
      continue;
    }
    const canonicalEditedSlice = String(searchResult.canonicalEditedSlice || "");
    const canonicalBody = `${beforeBody.slice(0, Number(scopeSlice.sliceStartCu || 0))}${canonicalEditedSlice}${beforeBody.slice(Number(scopeSlice.sliceEndCu || 0))}`;
    return {
      canonicalBody,
      editedDisplay,
      canonicalEditedSlice,
    };
  }
  const failureReason = validationErrors.length
    ? validationErrors[0]
    : "protected-span-count-mismatch";
  throw new Error(
    `[mfe] mutation-plan-v2: protected spans changed (${failureReason})`,
  );
}

export function applyScopedEditV2({
  session,
  structuralDocument,
  editorContent,
  runtimeProjection = null,
}) {
  if (!session || typeof session !== "object") {
    throw new Error("[mfe] mutation-plan-v2: session is required");
  }
  const scopeMeta = session.scopeMeta || {};
  const scopeKind = normalizeScopeKind(scopeMeta.scopeKind || "field");
  const structural =
    structuralDocument && typeof structuralDocument === "object"
      ? structuralDocument
      : parseStructuralDocument("");
  const beforeBody = serializeStructuralDocument(structural);
  const normalizedEditorContent = normalizeText(editorContent);

  if (scopeKind === "document") {
    const graphAgainstEditor = assertStructuralMarkerGraphEqual(
      beforeBody,
      normalizedEditorContent,
    );
    if (graphAgainstEditor.ok) {
      const normalizedDocumentOutput = enforceMarkerBlankLineSeparation(
        normalizedEditorContent,
      );
      if (hasStructuralMarkerBoundaryViolations(normalizedDocumentOutput)) {
        throw new Error(
          "[mfe] mutation-plan-v2: document marker boundary violation",
        );
      }
      return {
        scopeKind,
        ok: true,
        canonicalBody: normalizedDocumentOutput,
        scopedComparableMarkdown: normalizedDocumentOutput,
        scopedOutboundMarkdown: normalizedDocumentOutput,
        replacementMarkdown: normalizedDocumentOutput,
        startOffset: 0,
        endOffset: normalizedDocumentOutput.length,
        safety: {
          hasNextMarker: false,
          boundaryViolation: false,
        },
      };
    }

    const projectedEdit = applyProjectedScopeEdit({
      beforeBody,
      scopeMeta,
      editorContent: normalizedEditorContent,
      runtimeProjection,
    });
    const canonicalBody = String(projectedEdit.canonicalBody || beforeBody);
    const graphAfterProjection = assertStructuralMarkerGraphEqual(
      beforeBody,
      canonicalBody,
    );
    if (!graphAfterProjection.ok) {
      throw new Error(
        `[mfe] mutation-plan-v2: document marker topology changed (${graphAfterProjection.reason})`,
      );
    }
    const normalizedDocumentOutput = enforceMarkerBlankLineSeparation(
      canonicalBody,
    );
    if (hasStructuralMarkerBoundaryViolations(normalizedDocumentOutput)) {
      throw new Error(
        "[mfe] mutation-plan-v2: document marker boundary violation",
      );
    }
    return {
      scopeKind,
      ok: true,
      canonicalBody: normalizedDocumentOutput,
      scopedComparableMarkdown: normalizedDocumentOutput,
      scopedOutboundMarkdown: normalizedDocumentOutput,
      replacementMarkdown: String(projectedEdit.canonicalEditedSlice || ""),
      startOffset: 0,
      endOffset: normalizedDocumentOutput.length,
      safety: {
        hasNextMarker: false,
        boundaryViolation: false,
      },
    };
  }

  const rangeBefore = resolveStructuralScopeRange(structural, scopeMeta);
  let canonicalBody = beforeBody;
  let replacementMarkdown = normalizedEditorContent;

  if (scopeKind === "field") {
    const originalSlice = beforeBody.slice(
      rangeBefore.contentStart,
      rangeBefore.contentEnd,
    );
    replacementMarkdown = normalizeReplacementForBoundary({
      replacement: normalizedEditorContent,
      originalSlice,
      hasNextMarker: rangeBefore.hasNextMarker,
    });
    canonicalBody = `${beforeBody.slice(0, rangeBefore.contentStart)}${replacementMarkdown}${beforeBody.slice(rangeBefore.contentEnd)}`;
  } else if (scopeKind === "section" || scopeKind === "subsection") {
    const projectedEdit = applyProjectedScopeEdit({
      beforeBody,
      scopeMeta,
      editorContent: normalizedEditorContent,
      runtimeProjection,
    });
    canonicalBody = String(projectedEdit.canonicalBody || beforeBody);
    replacementMarkdown = String(projectedEdit.canonicalEditedSlice || "");
  } else {
    return {
      scopeKind,
      ok: false,
      reason: "unsupported-scope-v2",
      canonicalBody: beforeBody,
    };
  }

  if (scopeKind === "section" || scopeKind === "subsection") {
    canonicalBody = enforceMarkerBlankLineSeparation(canonicalBody);
  }

  const boundaryViolation = hasStructuralMarkerBoundaryViolations(canonicalBody);
  if (boundaryViolation) {
    throw new Error(
      "[mfe] mutation-plan-v2: marker boundary violation after scoped patch",
    );
  }

  const structuralAfter = parseStructuralDocument(canonicalBody);
  const afterRange = resolveStructuralScopeRange(structuralAfter, scopeMeta);
  const scopedComparableMarkdown = canonicalBody.slice(
    afterRange.contentStart,
    afterRange.trimmedContentEnd,
  );
  const scopedOutboundMarkdown = buildOutboundPayloadV2({
    canonicalBody,
    scopeMeta,
  });

  return {
    scopeKind,
    ok: true,
    canonicalBody,
    scopedComparableMarkdown,
    scopedOutboundMarkdown,
    replacementMarkdown,
    startOffset: rangeBefore.contentStart,
    endOffset:
      scopeKind === "field"
        ? rangeBefore.contentStart + replacementMarkdown.length
        : rangeBefore.contentEnd,
    safety: {
      hasNextMarker: rangeBefore.hasNextMarker,
      boundaryViolation: false,
    },
  };
}

export function buildOutboundPayloadV2({
  canonicalBody,
  scopeMeta,
}) {
  const body = normalizeText(canonicalBody);
  const scopeKind = normalizeScopeKind(scopeMeta?.scopeKind || "field");
  if (scopeKind === "document") return body;
  const structural = parseStructuralDocument(body);
  const range = resolveStructuralScopeRange(structural, scopeMeta);
  if (scopeKind === "field") {
    return body.slice(range.contentStart, range.trimmedContentEnd);
  }
  let outbound = body.slice(range.contentStart, range.contentEnd);
  if (/^\n(?=[\t ]*<!--\s*[a-zA-Z0-9_:.\/-]+\s*-->)/.test(outbound)) {
    outbound = outbound.slice(1);
  }
  return outbound;
}
