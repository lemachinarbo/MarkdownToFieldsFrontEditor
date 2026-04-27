function trimTrailingLineBreaks(markdown) {
  return String(markdown || "").replace(/\n+$/g, "");
}

function normalizeFieldMarkerName(name) {
  const value = String(name || "");
  return value.endsWith("...") ? value.slice(0, -3) : value;
}

function parseMarkdownMarkersWithRanges(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  const markerRegex = /^\s*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->\s*$/gm;
  const markers = [];
  let match;

  while ((match = markerRegex.exec(text))) {
    const marker = match[1] || "";
    const markerStart = match.index;
    const markerEnd = markerRegex.lastIndex;

    let lineEnd = text.indexOf("\n", markerEnd);
    if (lineEnd === -1) {
      lineEnd = text.length;
    } else {
      lineEnd += 1;
    }

    markers.push({
      marker,
      start: markerStart,
      afterLine: lineEnd,
    });
  }

  return markers;
}

function getParentScopeKey(scopeKey) {
  const key = String(scopeKey || "").trim();
  if (!key) return "";
  if (key.startsWith("section:")) return "";
  if (key.startsWith("subsection:")) {
    const parts = key.split(":");
    if (parts.length === 3) return `section:${parts[1] || ""}`;
    if (parts.length >= 4)
      return `subsection:${parts[1] || ""}:${parts[2] || ""}`;
  }
  if (key.startsWith("field:")) {
    const parts = key.split(":");
    if (parts.length >= 3) return `section:${parts[1] || ""}`;
  }
  return "";
}

function hasDescendantScopedCandidate(scopeKey, allKeys) {
  const current = String(scopeKey || "");
  if (!current) return false;
  for (const candidate of allKeys) {
    const next = String(candidate || "");
    if (!next || next === current) continue;
    let parent = getParentScopeKey(next);
    while (parent) {
      if (parent === current) return true;
      parent = getParentScopeKey(parent);
    }
  }
  return false;
}

function parseScopeKey(scopeKey) {
  const key = String(scopeKey || "").trim();
  if (!key) throw new Error("[mfe] canonical: empty scope key");
  const parts = key.split(":");
  const head = parts[0] || "";

  if (head === "section") {
    const section = parts[1] || "";
    if (!section)
      throw new Error(`[mfe] canonical: invalid section key \"${key}\"`);
    return {
      key,
      kind: "section",
      rank: 2,
      section,
      subsection: "",
      name: section,
    };
  }

  if (head === "subsection") {
    const section = parts[1] || "";
    const subsection = parts[2] || "";
    const name = parts[3] || "";
    if (!section || !subsection) {
      throw new Error(`[mfe] canonical: invalid subsection key \"${key}\"`);
    }
    if (name) {
      return { key, kind: "field", rank: 4, section, subsection, name };
    }
    return {
      key,
      kind: "subsection",
      rank: 3,
      section,
      subsection,
      name: subsection,
    };
  }

  if (head === "field") {
    const section = parts.length >= 3 ? parts[1] || "" : "";
    const rawName = parts.length >= 3 ? parts[2] || "" : parts[1] || "";
    const name = normalizeFieldMarkerName(rawName);
    if (!name) throw new Error(`[mfe] canonical: invalid field key \"${key}\"`);
    return { key, kind: "field", rank: 4, section, subsection: "", name };
  }

  throw new Error(`[mfe] canonical: unsupported scope key \"${key}\"`);
}

function getMarkerKind(markerName) {
  const marker = String(markerName || "");
  if (marker.startsWith("section:")) return "section";
  if (marker.startsWith("sub:") || marker.startsWith("subsection:"))
    return "subsection";
  return "field";
}

function buildCanonicalIdentityGraph(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  const markers = parseMarkdownMarkersWithRanges(text);
  const nodesByKey = new Map();

  let currentSection = "";
  let currentSubsection = "";

  const findBoundary = (startIndex, kind) => {
    for (let index = startIndex + 1; index < markers.length; index += 1) {
      const nextKind = getMarkerKind(markers[index].marker);
      if (kind === "section" && nextKind === "section")
        return markers[index].start;
      if (
        kind === "subsection" &&
        (nextKind === "section" || nextKind === "subsection")
      ) {
        return markers[index].start;
      }
      if (kind === "field") return markers[index].start;
    }
    return text.length;
  };

  for (let index = 0; index < markers.length; index += 1) {
    const markerEntry = markers[index];
    const markerName = markerEntry.marker;
    const markerKind = getMarkerKind(markerName);

    let nodeKey = "";
    let nodeSection = currentSection;
    let nodeSubsection = currentSubsection;
    let nodeName = markerName;

    if (markerKind === "section") {
      nodeSection = markerName.slice("section:".length);
      nodeSubsection = "";
      nodeName = nodeSection;
      nodeKey = `section:${nodeSection}`;
      currentSection = nodeSection;
      currentSubsection = "";
    } else if (markerKind === "subsection") {
      nodeSubsection = markerName.startsWith("sub:")
        ? markerName.slice("sub:".length)
        : markerName.slice("subsection:".length);
      nodeName = nodeSubsection;
      if (!currentSection) {
        throw new Error(
          `[mfe] canonical: subsection marker \"${markerName}\" without active section`,
        );
      }
      nodeKey = `subsection:${currentSection}:${nodeSubsection}`;
      currentSubsection = nodeSubsection;
    } else {
      nodeName = normalizeFieldMarkerName(markerName);
      if (currentSection && currentSubsection) {
        nodeKey = `subsection:${currentSection}:${currentSubsection}:${nodeName}`;
      } else if (currentSection) {
        nodeKey = `field:${currentSection}:${nodeName}`;
      } else {
        nodeKey = `field:${nodeName}`;
      }
    }

    if (!nodeKey)
      throw new Error(
        `[mfe] canonical: failed to resolve identity key for marker \"${markerName}\"`,
      );
    if (nodesByKey.has(nodeKey))
      throw new Error(`[mfe] canonical: duplicate identity key \"${nodeKey}\"`);

    const bodyStart = markerEntry.afterLine;
    const bodyEnd = findBoundary(index, markerKind);
    nodesByKey.set(nodeKey, {
      key: nodeKey,
      kind: markerKind,
      section: nodeSection,
      subsection: nodeSubsection,
      name: nodeName,
      marker: markerName,
      markerStart: markerEntry.start,
      markerEnd: markerEntry.afterLine,
      bodyStart,
      bodyEnd,
      body: trimTrailingLineBreaks(text.slice(bodyStart, bodyEnd)),
    });
  }

  return { markdown: text, markers, nodesByKey };
}

function resolveOverlayBodyForIdentity({ scopeKey, overlayMarkdown }) {
  const overlayText =
    typeof overlayMarkdown === "string"
      ? trimTrailingLineBreaks(overlayMarkdown)
      : "";
  const meta = parseScopeKey(scopeKey);
  if (!overlayText)
    throw new Error(`[mfe] canonical: empty overlay for key \"${scopeKey}\"`);

  let overlayGraph;
  try {
    overlayGraph = buildCanonicalIdentityGraph(overlayText);
  } catch (error) {
    const message = String(error?.message || "");
    const canInjectSectionContext =
      message.includes("without active section") &&
      Boolean(meta.section) &&
      (meta.kind === "section" ||
        meta.kind === "subsection" ||
        meta.kind === "field");
    if (!canInjectSectionContext) {
      throw error;
    }
    const normalizedOverlay = [
      `<!-- section:${meta.section} -->`,
      "",
      overlayText,
    ].join("\n");
    overlayGraph = buildCanonicalIdentityGraph(normalizedOverlay);
  }
  if (meta.kind === "field" && !overlayGraph.markers.length) return overlayText;

  const exact = overlayGraph.nodesByKey.get(scopeKey);
  if (exact) return exact.body;

  if (meta.kind === "field") {
    const sameNameCandidates = Array.from(
      overlayGraph.nodesByKey.values(),
    ).filter(
      (node) =>
        node.kind === "field" &&
        node.name === meta.name &&
        (!meta.subsection || node.subsection === meta.subsection),
    );
    if (sameNameCandidates.length === 1) return sameNameCandidates[0].body;
    if (sameNameCandidates.length > 1) {
      throw new Error(
        `[mfe] canonical: ambiguous field overlay for key \"${scopeKey}\"`,
      );
    }
    const subsectionCandidates = Array.from(
      overlayGraph.nodesByKey.values(),
    ).filter(
      (node) =>
        node.kind === "subsection" &&
        node.section === meta.section &&
        node.name === meta.name,
    );
    if (subsectionCandidates.length === 1) return subsectionCandidates[0].body;
    if (subsectionCandidates.length > 1) {
      throw new Error(
        `[mfe] canonical: ambiguous field overlay for key \"${scopeKey}\"`,
      );
    }
    if (!overlayGraph.markers.length) return overlayText;
  }

  if (
    (meta.kind === "section" || meta.kind === "subsection") &&
    !overlayGraph.markers.length
  ) {
    return overlayText;
  }

  if (meta.kind === "section" || meta.kind === "subsection") {
    const hasSameKindMarker = overlayGraph.markers.some((entry) => {
      const kind = getMarkerKind(entry.marker);
      return kind === meta.kind;
    });
    if (!hasSameKindMarker) {
      return overlayText;
    }
  }

  throw new Error(
    `[mfe] canonical: cannot resolve overlay body for key \"${scopeKey}\"`,
  );
}

export function resolveMarkdownForScopeFromCanonical({
  markdown,
  scope,
  section,
  subsection,
  name,
}) {
  const text = typeof markdown === "string" ? markdown : "";
  const wantedScope = String(scope || "field");
  const wantedSection = String(section || "");
  const wantedSubsection = String(subsection || "");
  const wantedName = String(name || "");
  const wantedFieldName = normalizeFieldMarkerName(wantedName);

  if (wantedScope === "document") {
    return text;
  }

  const markers = parseMarkdownMarkersWithRanges(text);
  if (!markers.length) {
    return "";
  }

  let currentSection = "";
  let currentSubsection = "";
  const fieldMatches = [];
  const nestedFieldMatches = [];

  const resolveSegmentEnd = (startIndex) => {
    for (
      let nextIndex = startIndex + 1;
      nextIndex < markers.length;
      nextIndex += 1
    ) {
      if (wantedScope === "section") {
        if (markers[nextIndex].marker.startsWith("section:")) {
          return markers[nextIndex].start;
        }
      } else if (wantedScope === "subsection") {
        const nextMarker = markers[nextIndex].marker;
        if (
          nextMarker.startsWith("section:") ||
          nextMarker.startsWith("sub:") ||
          nextMarker.startsWith("subsection:")
        ) {
          return markers[nextIndex].start;
        }
      } else {
        return markers[nextIndex].start;
      }
    }
    return text.length;
  };

  for (let index = 0; index < markers.length; index += 1) {
    const current = markers[index];
    const markerName = current.marker;

    if (markerName.startsWith("section:")) {
      currentSection = markerName.slice("section:".length);
      currentSubsection = "";
    } else if (markerName.startsWith("sub:")) {
      currentSubsection = markerName.slice("sub:".length);
    } else if (markerName.startsWith("subsection:")) {
      currentSubsection = markerName.slice("subsection:".length);
    }

    let matches = false;
    if (wantedScope === "section") {
      matches = markerName === `section:${wantedName || wantedSection}`;
    } else if (wantedScope === "subsection") {
      const expectedSection = wantedSection;
      const expectedSub = wantedName || wantedSubsection;
      matches =
        currentSection === expectedSection &&
        (markerName === `sub:${expectedSub}` ||
          markerName === `subsection:${expectedSub}`);
    } else if (wantedScope === "field") {
      const markerFieldName = normalizeFieldMarkerName(markerName);
      matches =
        markerFieldName === wantedFieldName && currentSection === wantedSection;

      if (matches) {
        if (wantedSubsection && currentSubsection !== wantedSubsection) {
          matches = false;
        } else {
          const end = resolveSegmentEnd(index);
          const candidate = {
            markerName,
            section: currentSection,
            subsection: currentSubsection,
            start: current.afterLine,
            end,
          };
          if (!wantedSubsection && currentSubsection) {
            nestedFieldMatches.push(candidate);
          } else {
            fieldMatches.push(candidate);
          }
          continue;
        }
      }
    }

    if (!matches) continue;

    const end = resolveSegmentEnd(index);

    return trimTrailingLineBreaks(text.slice(current.afterLine, end));
  }

  if (wantedScope === "field") {
    if (fieldMatches.length === 1) {
      const only = fieldMatches[0];
      return trimTrailingLineBreaks(text.slice(only.start, only.end));
    }
    if (fieldMatches.length > 1) {
      throw new Error(
        `[mfe] canonical: ambiguous field scope for ${wantedScope}:${wantedSection}:${wantedSubsection}:${wantedName}`,
      );
    }
    if (!wantedSubsection && nestedFieldMatches.length === 1) {
      const onlyNested = nestedFieldMatches[0];
      return trimTrailingLineBreaks(
        text.slice(onlyNested.start, onlyNested.end),
      );
    }
    if (!wantedSubsection && nestedFieldMatches.length > 1) {
      throw new Error(
        `[mfe] canonical: ambiguous field scope for ${wantedScope}:${wantedSection}:${wantedSubsection}:${wantedName}`,
      );
    }
  }

  return "";
}

export function assertCanonicalMarkerTopology(markdown) {
  const graph = buildCanonicalIdentityGraph(markdown);
  const markers = graph.markers || [];
  const nodes = Array.from(graph.nodesByKey.values());
  const markdownText = typeof markdown === "string" ? markdown : "";

  if (markers.length !== nodes.length)
    throw new Error("[mfe] canonical: marker topology mismatch");

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    if (
      marker.afterLine < marker.start ||
      marker.afterLine > markdownText.length
    ) {
      throw new Error("[mfe] canonical: marker bounds invalid");
    }
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.bodyStart < node.markerEnd || node.bodyEnd < node.bodyStart) {
      throw new Error(`[mfe] canonical: invalid node range for ${node.key}`);
    }
    if (node.bodyEnd > markdownText.length) {
      throw new Error(
        `[mfe] canonical: node range out of bounds for ${node.key}`,
      );
    }
    if (index > 0) {
      const previous = nodes[index - 1];
      if (node.markerStart < previous.markerStart) {
        throw new Error("[mfe] canonical: marker ordering changed");
      }
    }
  }
}

export function computeCanonicalMarkdownStateFromInputs({
  documentDraft,
  configDocument,
  scopedDraftEntries,
}) {
  const hasDocumentDraft =
    typeof documentDraft === "string" && documentDraft !== "";
  const documentBaseMarkdown = hasDocumentDraft
    ? documentDraft
    : configDocument;

  const baseGraph = buildCanonicalIdentityGraph(documentBaseMarkdown);
  const rawOverlays = (
    Array.isArray(scopedDraftEntries) ? scopedDraftEntries : []
  )
    .filter(
      (entry) =>
        Array.isArray(entry) &&
        entry.length >= 2 &&
        entry[0] &&
        typeof entry[1] === "string" &&
        entry[1] !== "",
    )
    .map(([key, value]) => {
      const scope = parseScopeKey(key);
      return { key, rank: scope.rank, kind: scope.kind, markdown: value };
    });

  const overlayKeys = rawOverlays.map((entry) => entry.key);
  const selectedOverlays = rawOverlays
    .filter((entry) => !hasDescendantScopedCandidate(entry.key, overlayKeys))
    .sort((left, right) => {
      if (left.rank !== right.rank) return right.rank - left.rank;
      return left.key.localeCompare(right.key);
    });

  const winnerByTargetKey = new Map();
  let needsRebuild = false;
  selectedOverlays.forEach((overlay) => {
    if (!baseGraph.nodesByKey.has(overlay.key)) {
      const meta = parseScopeKey(overlay.key);
      let toAppend = "";
      if (meta.section && !baseGraph.nodesByKey.has(`section:${meta.section}`)) {
        toAppend += `\n\n<!-- section:${meta.section} -->\n`;
        baseGraph.nodesByKey.set(`section:${meta.section}`, true);
      }
      if (meta.subsection && !baseGraph.nodesByKey.has(`subsection:${meta.section}:${meta.subsection}`)) {
        toAppend += `\n<!-- subsection:${meta.subsection} -->\n`;
        baseGraph.nodesByKey.set(`subsection:${meta.section}:${meta.subsection}`, true);
      }
      if (meta.kind === "field" && !baseGraph.nodesByKey.has(overlay.key)) {
        toAppend += `\n<!-- ${meta.name} -->\n`;
        baseGraph.nodesByKey.set(overlay.key, true);
      }
      documentBaseMarkdown += toAppend;
      needsRebuild = true;
    }
  });

  if (needsRebuild) {
    baseGraph = buildCanonicalIdentityGraph(documentBaseMarkdown);
  }

  const replacements = selectedOverlays.map((overlay) => {
    const baseNode = baseGraph.nodesByKey.get(overlay.key);
    if (!baseNode) {
      throw new Error(
        `[mfe] canonical: overlay key "${overlay.key}" not found in document graph`,
      );
    }
    const existing = winnerByTargetKey.get(baseNode.key);
    if (existing && existing.rank === overlay.rank) {
      throw new Error(
        `[mfe] canonical: same-rank collision for \"${baseNode.key}\"`,
      );
    }
    if (!existing || overlay.rank > existing.rank) {
      winnerByTargetKey.set(baseNode.key, {
        sourceKey: overlay.key,
        rank: overlay.rank,
      });
    }

    const body = resolveOverlayBodyForIdentity({
      scopeKey: overlay.key,
      overlayMarkdown: overlay.markdown,
    });
    return {
      key: overlay.key,
      rank: overlay.rank,
      start: baseNode.bodyStart,
      end: baseNode.bodyEnd,
      body,
      targetKey: baseNode.key,
    };
  });

  const orderedRanges = replacements.slice().sort((a, b) => a.start - b.start);
  for (let index = 1; index < orderedRanges.length; index += 1) {
    const previous = orderedRanges[index - 1];
    const current = orderedRanges[index];
    if (current.start < previous.end) {
      throw new Error(
        `[mfe] canonical: overlapping overlay ranges \"${previous.key}\" and \"${current.key}\"`,
      );
    }
  }

  let canonicalMarkdown = documentBaseMarkdown;
  replacements
    .slice()
    .sort((a, b) => b.start - a.start)
    .forEach((entry) => {
      canonicalMarkdown =
        canonicalMarkdown.slice(0, entry.start) +
        entry.body +
        canonicalMarkdown.slice(entry.end);
    });

  return {
    markdown: canonicalMarkdown,
    baseMarkdown: documentBaseMarkdown,
    source: hasDocumentDraft ? "documentDraft" : "configDocument",
    applied: replacements.map((entry) => ({
      key: entry.key,
      rank: entry.rank,
      targetKey: entry.targetKey,
      start: entry.start,
      end: entry.end,
      length: entry.body.length,
    })),
  };
}
