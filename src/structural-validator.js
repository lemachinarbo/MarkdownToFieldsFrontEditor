function normalizeText(value) {
  return typeof value === "string" ? value : "";
}

const MARKER_LINE_RE = /^[\t ]*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->[\t ]*$/;

function arrayEquals(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function extractStructuralGraph(markdown) {
  const text = normalizeText(markdown)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = text.split("\n");

  const markerGraph = [];
  const markerLineIndices = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = String(lines[i] || "").match(MARKER_LINE_RE);
    if (!match) continue;
    markerGraph.push(String(match[1] || ""));
    markerLineIndices.push(i);
  }

  const boundaryGapGraph = [];
  for (let i = 0; i < markerLineIndices.length - 1; i += 1) {
    const currentLine = markerLineIndices[i];
    const nextLine = markerLineIndices[i + 1];
    if (nextLine <= currentLine + 1) continue;

    let blankCount = 0;
    let allBlank = true;
    for (
      let lineIndex = currentLine + 1;
      lineIndex < nextLine;
      lineIndex += 1
    ) {
      if (String(lines[lineIndex] || "").trim() === "") {
        blankCount += 1;
      } else {
        allBlank = false;
        break;
      }
    }

    if (allBlank && blankCount > 0) {
      boundaryGapGraph.push(blankCount);
    }
  }

  return {
    markerGraph,
    markerPositions: markerLineIndices,
    boundaryGapGraph,
  };
}

export function validateStructuralTransition(previousMarkdown, nextMarkdown) {
  const previous = extractStructuralGraph(previousMarkdown);
  const next = extractStructuralGraph(nextMarkdown);

  const hasNextMarkers = next.markerGraph.length > 0;
  const hasPreviousMarkers = previous.markerGraph.length > 0;

  if (!hasNextMarkers) {
    return {
      ok: false,
      reason: "missing-next-markers",
      previous,
      next,
    };
  }

  if (!hasPreviousMarkers) {
    return {
      ok: true,
      reason: "seeded-next-graph",
      previous,
      next,
    };
  }

  if (!arrayEquals(previous.markerGraph, next.markerGraph)) {
    return {
      ok: false,
      reason: "marker-graph-mismatch",
      previous,
      next,
    };
  }

  if (!arrayEquals(previous.boundaryGapGraph, next.boundaryGapGraph)) {
    return {
      ok: false,
      reason: "gap-graph-mismatch",
      previous,
      next,
    };
  }

  return {
    ok: true,
    reason: "graph-match",
    previous,
    next,
  };
}
