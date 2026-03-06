import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

const DOCUMENT_BOUNDARY_PLUGIN_KEY = new PluginKey("documentBoundary");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mapDisplayOffsetToDocPos(offset, displayLength, docSize) {
  if (docSize <= 0) return 1;
  if (displayLength <= 0) return clamp(1, 1, docSize);
  const ratio = clamp(Number(offset || 0) / displayLength, 0, 1);
  return clamp(Math.round(ratio * docSize), 1, docSize);
}

function mapDocPosToDisplayOffset(docPos, docSize, displayLength) {
  if (docSize <= 0 || displayLength <= 0) return 0;
  const ratio = clamp(Number(docPos || 0) / docSize, 0, 1);
  return clamp(Math.round(ratio * displayLength), 0, displayLength);
}

function mapBoundaryDocPositionsWithTransaction(
  boundaryDocPositions,
  tr,
  docSize,
) {
  const source = Array.isArray(boundaryDocPositions)
    ? boundaryDocPositions
    : [];
  const mapped = source.map((position) => {
    const mappedPosition = tr.mapping.map(Number(position || 1), 1);
    return clamp(mappedPosition, 1, Math.max(1, docSize));
  });
  let floor = 1;
  for (let index = 0; index < mapped.length; index += 1) {
    const next = Math.max(floor, mapped[index]);
    mapped[index] = next;
    floor = next;
  }
  return mapped;
}

function mapMarkerDocAnchorsWithTransaction(markerDocAnchors, tr, docSize) {
  const source = Array.isArray(markerDocAnchors) ? markerDocAnchors : [];
  const mapped = source.map((position) => {
    const mappedPosition = tr.mapping.map(Number(position || 0), 1);
    return clamp(mappedPosition, 0, Math.max(1, docSize));
  });
  return mapped;
}

function normalizeStrictIncreasingBoundaries(boundaries, maxOffset) {
  const source = Array.isArray(boundaries) ? boundaries : [];
  const max = Math.max(0, Number(maxOffset || 0));
  const count = source.length;
  if (!count) return [];
  const normalized = new Array(count).fill(0);
  normalized[0] = 0;
  for (let index = 1; index < count; index += 1) {
    const raw = Math.max(0, Number(source[index] || 0));
    const minAllowed = normalized[index - 1] + 1;
    const maxAllowed = Math.max(minAllowed, max - (count - 1 - index));
    normalized[index] = clamp(raw, minAllowed, maxAllowed);
  }
  return normalized;
}

export function mapEditableBoundariesWithTransaction(
  editableBoundaries,
  tr,
  maxDisplayLength,
) {
  const source = Array.isArray(editableBoundaries) ? editableBoundaries : [];
  const mapped = source.map((boundary, index) => {
    if (index === 0) return 0;
    const mappedBoundary = tr?.mapping?.map
      ? tr.mapping.map(Number(boundary || 0), 1)
      : Number(boundary || 0);
    return Math.max(0, Number(mappedBoundary || 0));
  });
  return normalizeStrictIncreasingBoundaries(mapped, maxDisplayLength);
}

function normalizeProjectionPayload(projection, doc) {
  const payload =
    projection && typeof projection === "object" ? projection : {};
  const displayText = String(payload.displayText || "");
  const displayLength = displayText.length;
  const docSize = Math.max(1, Number(doc?.content?.size || 0));
  const inputEditableBoundaries = Array.isArray(payload.editableBoundaries)
    ? payload.editableBoundaries
    : [];
  const editableBoundaries = Array.isArray(payload.editableBoundaries)
    ? payload.editableBoundaries.map((value) => Math.max(0, Number(value || 0)))
    : [];
  const boundaryDocPositions =
    Array.isArray(payload.boundaryDocPositions) &&
    payload.boundaryDocPositions.length === editableBoundaries.length
      ? payload.boundaryDocPositions.map((value) =>
          clamp(Number(value || 1), 1, docSize),
        )
      : editableBoundaries.map((offset) =>
          mapDisplayOffsetToDocPos(offset, displayLength, docSize),
        );
  const markerDocAnchors = Array.isArray(payload.markerDocAnchors)
    ? payload.markerDocAnchors.map((value) =>
        clamp(Number(value || 0), 0, docSize),
      )
    : [];
  const nextProjectionMeta =
    payload.projectionMeta && typeof payload.projectionMeta === "object"
      ? payload.projectionMeta
      : {};
  return {
    ...payload,
    displayText,
    editableBoundaries,
    boundaryDocPositions,
    markerDocAnchors,
    projectionMeta: {
      updateMode: String(
        nextProjectionMeta.updateMode || "deterministic-recompute",
      ),
      deterministicRecomputeCount: Number(
        nextProjectionMeta.deterministicRecomputeCount || 0,
      ),
      mappingUpdateCount: Number(nextProjectionMeta.mappingUpdateCount || 0),
      boundaryInputCount: Number(
        nextProjectionMeta.boundaryInputCount || inputEditableBoundaries.length,
      ),
      boundaryNormalizedCount: Number(
        nextProjectionMeta.boundaryNormalizedCount || editableBoundaries.length,
      ),
      boundaryDedupeOccurred: Boolean(
        nextProjectionMeta.boundaryDedupeOccurred || false,
      ),
      runtimeBoundariesTrusted: Boolean(
        nextProjectionMeta.runtimeBoundariesTrusted || false,
      ),
      stateId: String(nextProjectionMeta.stateId || ""),
      scopeKey: String(nextProjectionMeta.scopeKey || ""),
      lastDocChangeTrace:
        nextProjectionMeta.lastDocChangeTrace &&
        typeof nextProjectionMeta.lastDocChangeTrace === "object"
          ? nextProjectionMeta.lastDocChangeTrace
          : null,
    },
    projectionUtils: {
      displayLength,
      docSize,
      mapDocPosToDisplayOffset,
    },
  };
}

export function readDocumentBoundaryProjection(editorOrState) {
  const state =
    editorOrState?.state && typeof editorOrState.state === "object"
      ? editorOrState.state
      : editorOrState;
  if (!state || typeof state !== "object") return null;
  const pluginState = DOCUMENT_BOUNDARY_PLUGIN_KEY.getState(state);
  if (!pluginState || typeof pluginState !== "object") return null;
  return pluginState.canonicalProjection || null;
}

export function writeDocumentBoundaryProjection(editor, projection) {
  const view = editor?.view;
  if (!view?.state || typeof view.dispatch !== "function") return false;
  const tr = view.state.tr.setMeta(DOCUMENT_BOUNDARY_PLUGIN_KEY, {
    type: "setCanonicalProjection",
    projection: projection || null,
  });
  view.dispatch(tr);
  return true;
}

function parseMarkerContext(name, ctx) {
  const value = String(name || "").trim();
  const lower = value.toLowerCase();

  if (!value) return ctx;

  if (lower.startsWith("section:")) {
    const section = value.slice(8).trim();
    return {
      section,
      subsection: "",
      field: "",
      fieldIsContainer: false,
    };
  }

  if (lower.startsWith("sub:") || lower.startsWith("subsection:")) {
    const raw = value.includes(":") ? value.split(":").slice(1).join(":") : "";
    const parts = raw
      .split(":")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      return {
        section: parts[0],
        subsection: parts[1],
        field: "",
        fieldIsContainer: false,
      };
    }

    if (parts.length === 1) {
      return {
        section: ctx.section || "",
        subsection: parts[0],
        field: "",
        fieldIsContainer: false,
      };
    }

    return {
      section: ctx.section || "",
      subsection: "",
      field: "",
      fieldIsContainer: false,
    };
  }

  if (lower === "/" || lower.startsWith("/")) {
    return {
      section: ctx.section || "",
      subsection: ctx.subsection || "",
      field: "",
      fieldIsContainer: false,
    };
  }

  const fieldIsContainer = lower.endsWith("...");
  return {
    section: ctx.section || "",
    subsection: ctx.subsection || "",
    field: value,
    fieldIsContainer,
  };
}

function buildLabel(ctx) {
  if (ctx.field) {
    if (ctx.section && ctx.subsection) {
      return `field:${ctx.section}/${ctx.subsection}/${ctx.field}`;
    }
    if (ctx.section) {
      return `field:${ctx.section}/${ctx.field}`;
    }
    return `field:${ctx.field}`;
  }
  if (ctx.subsection) {
    return ctx.section
      ? `subsection:${ctx.section}/${ctx.subsection}`
      : `subsection:${ctx.subsection}`;
  }
  if (ctx.section) {
    return `section:${ctx.section}`;
  }
  return "document";
}

function buildShortMarkerLabel(ctx) {
  if (ctx.field) {
    return String(ctx.field || "");
  }
  if (ctx.subsection) {
    return `subsection:${ctx.subsection}`;
  }
  if (ctx.section) {
    return `section:${ctx.section}`;
  }
  return "document";
}

function buildClassName(ctx) {
  if (ctx.field) return "mfe-doc-segment mfe-doc-segment--field";
  if (ctx.subsection) return "mfe-doc-segment mfe-doc-segment--subsection";
  if (ctx.section) return "mfe-doc-segment mfe-doc-segment--section";
  return "mfe-doc-segment mfe-doc-segment--document";
}

function buildMarkerClassName(ctx) {
  if (ctx.field) return "mfe-doc-marker mfe-doc-marker--field";
  if (ctx.subsection) return "mfe-doc-marker mfe-doc-marker--subsection";
  if (ctx.section) return "mfe-doc-marker mfe-doc-marker--section";
  return "mfe-doc-marker mfe-doc-marker--document";
}

function resolveMarkerContextFromProtectedSpan(span, fallbackContext) {
  const fallback =
    fallbackContext && typeof fallbackContext === "object"
      ? fallbackContext
      : {
          section: "",
          subsection: "",
          field: "",
          fieldIsContainer: false,
        };
  const rawName = String(span?.markerRawName || "").trim();
  if (rawName) {
    return parseMarkerContext(rawName, fallback);
  }

  const kind = String(span?.markerKind || "")
    .trim()
    .toLowerCase();
  const markerName = String(span?.markerName || "").trim();
  const markerSection = String(span?.markerSection || "").trim();
  const markerSubsection = String(span?.markerSubsection || "").trim();
  const markerFieldIsContainer = Boolean(span?.markerFieldIsContainer);

  if (kind === "section") {
    const section = markerName || markerSection;
    return {
      section,
      subsection: "",
      field: "",
      fieldIsContainer: false,
    };
  }
  if (kind === "subsection") {
    return {
      section: markerSection || fallback.section || "",
      subsection: markerName || markerSubsection,
      field: "",
      fieldIsContainer: false,
    };
  }
  if (kind === "field") {
    return {
      section: markerSection || fallback.section || "",
      subsection: markerSubsection || fallback.subsection || "",
      field: markerName,
      fieldIsContainer: markerFieldIsContainer,
    };
  }
  return fallback;
}

function contextsEqual(left, right) {
  return (
    String(left?.section || "") === String(right?.section || "") &&
    String(left?.subsection || "") === String(right?.subsection || "") &&
    String(left?.field || "") === String(right?.field || "") &&
    Boolean(left?.fieldIsContainer) === Boolean(right?.fieldIsContainer)
  );
}

function contextKey(ctx) {
  return [
    String(ctx?.section || ""),
    String(ctx?.subsection || ""),
    String(ctx?.field || ""),
    String(Boolean(ctx?.fieldIsContainer)),
  ].join("\u241f");
}

export function createDocumentBoundaryExtension(getMode) {
  return Extension.create({
    name: "documentBoundary",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: DOCUMENT_BOUNDARY_PLUGIN_KEY,
          state: {
            init() {
              return {
                canonicalProjection: null,
              };
            },
            apply(tr, pluginState, oldState, newState) {
              const prev =
                pluginState && typeof pluginState === "object"
                  ? pluginState
                  : { canonicalProjection: null };
              const meta = tr.getMeta(DOCUMENT_BOUNDARY_PLUGIN_KEY);
              if (
                meta &&
                typeof meta === "object" &&
                meta.type === "setCanonicalProjection"
              ) {
                const nextProjection = normalizeProjectionPayload(
                  meta.projection || null,
                  tr.doc,
                );
                if (
                  typeof console !== "undefined" &&
                  typeof console.info === "function"
                ) {
                  console.info(
                    "MFE_RUNTIME_BOUNDARY_WRITE_TRACE",
                    JSON.stringify({
                      reason: "document-boundary:setCanonicalProjection",
                      mode: String(
                        nextProjection?.projectionMeta?.updateMode || "",
                      ),
                      trDocChanged: Boolean(tr.docChanged),
                      selectionFrom: Number(newState?.selection?.from ?? -1),
                      selectionTo: Number(newState?.selection?.to ?? -1),
                      previousRuntimeBoundaries: Array.isArray(
                        prev?.canonicalProjection?.editableBoundaries,
                      )
                        ? prev.canonicalProjection.editableBoundaries
                        : [],
                      newRuntimeBoundaries: Array.isArray(
                        nextProjection?.editableBoundaries,
                      )
                        ? nextProjection.editableBoundaries
                        : [],
                      deterministicBoundaries: [],
                      stateId: String(
                        nextProjection?.projectionMeta?.stateId || "",
                      ),
                      scopeKey: String(
                        nextProjection?.projectionMeta?.scopeKey || "",
                      ),
                      runtimeBoundariesTrusted: Boolean(
                        nextProjection?.projectionMeta
                          ?.runtimeBoundariesTrusted || false,
                      ),
                    }),
                  );
                }
                return {
                  ...prev,
                  canonicalProjection: nextProjection,
                };
              }
              if (tr.docChanged && prev.canonicalProjection) {
                const previousProjection =
                  prev.canonicalProjection &&
                  typeof prev.canonicalProjection === "object"
                    ? prev.canonicalProjection
                    : null;
                const previousDisplayLength = String(
                  previousProjection?.displayText || "",
                ).length;
                const oldDocSize = Math.max(
                  1,
                  Number(oldState?.doc?.content?.size || 0),
                );
                const newDocSize = Math.max(
                  1,
                  Number(
                    newState?.doc?.content?.size || tr.doc?.content?.size || 0,
                  ),
                );
                const estimatedDisplayLength = Math.max(
                  0,
                  previousDisplayLength + (newDocSize - oldDocSize),
                );
                const currentProjection = normalizeProjectionPayload(
                  previousProjection,
                  tr.doc,
                );
                const mappedBoundaryDocPositions =
                  mapBoundaryDocPositionsWithTransaction(
                    currentProjection.boundaryDocPositions,
                    tr,
                    Math.max(1, Number(tr.doc?.content?.size || 0)),
                  );
                const mappedMarkerDocAnchors =
                  mapMarkerDocAnchorsWithTransaction(
                    currentProjection.markerDocAnchors,
                    tr,
                    Math.max(1, Number(tr.doc?.content?.size || 0)),
                  );
                const mappedEditableBoundaries =
                  mapEditableBoundariesWithTransaction(
                    currentProjection.editableBoundaries,
                    tr,
                    estimatedDisplayLength,
                  );
                const prevMetaProjection =
                  currentProjection.projectionMeta &&
                  typeof currentProjection.projectionMeta === "object"
                    ? currentProjection.projectionMeta
                    : {};
                const metaObject =
                  tr.meta && typeof tr.meta === "object" ? tr.meta : {};
                const metaKeys = Object.keys(metaObject)
                  .map((key) => String(key || ""))
                  .filter(Boolean)
                  .slice(0, 12);
                if (
                  typeof console !== "undefined" &&
                  typeof console.info === "function"
                ) {
                  console.info(
                    "MFE_RUNTIME_BOUNDARY_WRITE_TRACE",
                    JSON.stringify({
                      reason: "document-boundary:tr-mapping",
                      mode: "tr-mapping",
                      trDocChanged: Boolean(tr.docChanged),
                      selectionFrom: Number(newState?.selection?.from ?? -1),
                      selectionTo: Number(newState?.selection?.to ?? -1),
                      previousRuntimeBoundaries: Array.isArray(
                        currentProjection?.editableBoundaries,
                      )
                        ? currentProjection.editableBoundaries
                        : [],
                      newRuntimeBoundaries: Array.isArray(
                        mappedEditableBoundaries,
                      )
                        ? mappedEditableBoundaries
                        : [],
                      deterministicBoundaries: [],
                      stateId: String(prevMetaProjection.stateId || ""),
                      scopeKey: String(prevMetaProjection.scopeKey || ""),
                      runtimeBoundariesTrusted: true,
                    }),
                  );
                }
                return {
                  ...prev,
                  canonicalProjection: {
                    ...currentProjection,
                    boundaryDocPositions: mappedBoundaryDocPositions,
                    markerDocAnchors: mappedMarkerDocAnchors,
                    editableBoundaries: mappedEditableBoundaries,
                    projectionMeta: {
                      updateMode: "tr-mapping",
                      deterministicRecomputeCount: Number(
                        prevMetaProjection.deterministicRecomputeCount || 0,
                      ),
                      mappingUpdateCount:
                        Number(prevMetaProjection.mappingUpdateCount || 0) + 1,
                      boundaryInputCount: Number(
                        prevMetaProjection.boundaryInputCount ||
                          mappedBoundaryDocPositions.length,
                      ),
                      boundaryNormalizedCount: Number(
                        Array.isArray(mappedEditableBoundaries)
                          ? mappedEditableBoundaries.length
                          : 0,
                      ),
                      boundaryDedupeOccurred: false,
                      runtimeBoundariesTrusted: true,
                      stateId: String(prevMetaProjection.stateId || ""),
                      scopeKey: String(prevMetaProjection.scopeKey || ""),
                      lastDocChangeTrace: {
                        stepsLength: Array.isArray(tr.steps)
                          ? tr.steps.length
                          : 0,
                        mappingMapsLength:
                          tr.mapping && Array.isArray(tr.mapping.maps)
                            ? tr.mapping.maps.length
                            : 0,
                        docSize: Number(tr.doc?.content?.size || 0),
                        metaKeys,
                      },
                    },
                  },
                };
              }
              return prev;
            },
          },
          props: {
            decorations(state) {
              const mode =
                typeof getMode === "function" ? String(getMode() || "") : "";
              if (mode !== "document") {
                return DecorationSet.empty;
              }

              const decorations = [];
              const segmentNodes = [];
              const markerNodes = [];
              const pluginState = DOCUMENT_BOUNDARY_PLUGIN_KEY.getState(state);
              const canonicalProjection =
                pluginState && typeof pluginState === "object"
                  ? pluginState.canonicalProjection
                  : null;
              const projectionProtectedSpans = Array.isArray(
                canonicalProjection?.protectedSpans,
              )
                ? canonicalProjection.protectedSpans
                : [];
              const projectionMarkerDocAnchors = Array.isArray(
                canonicalProjection?.markerDocAnchors,
              )
                ? canonicalProjection.markerDocAnchors
                : [];
              const firstFieldSegmentFromByKey = new Map();
              let context = {
                section: "",
                subsection: "",
                field: "",
                fieldIsContainer: false,
              };
              const selectionPos = state.selection?.from || 0;
              const selectionHeadPos =
                state.selection?.$head?.pos || selectionPos;

              state.doc.forEach((node, offset) => {
                const from = offset;
                const to = offset + node.nodeSize;

                if (node.type?.name === "mfeMarker") {
                  context = parseMarkerContext(node.attrs?.name || "", context);
                  markerNodes.push({
                    from,
                    to,
                    context: { ...context },
                  });
                  return;
                }

                if (!node.type?.isBlock) {
                  return;
                }

                segmentNodes.push({
                  from,
                  to,
                  context: { ...context },
                });

                if (context.field && !context.fieldIsContainer) {
                  const key = contextKey(context);
                  if (!firstFieldSegmentFromByKey.has(key)) {
                    firstFieldSegmentFromByKey.set(key, from);
                  }
                }
              });

              if (!markerNodes.length && projectionProtectedSpans.length) {
                let syntheticContext = {
                  section: "",
                  subsection: "",
                  field: "",
                  fieldIsContainer: false,
                };
                for (
                  let markerOrdinal = 0;
                  markerOrdinal < projectionProtectedSpans.length;
                  markerOrdinal += 1
                ) {
                  const span = projectionProtectedSpans[markerOrdinal] || null;
                  const hasMarkerMeta =
                    String(span?.markerRawName || "").trim().length > 0 ||
                    String(span?.markerKind || "").trim().length > 0 ||
                    String(span?.markerName || "").trim().length > 0;
                  if (!hasMarkerMeta) continue;
                  syntheticContext = resolveMarkerContextFromProtectedSpan(
                    span,
                    syntheticContext,
                  );
                  const anchoredMarkerPos = clamp(
                    Number(projectionMarkerDocAnchors[markerOrdinal] || 0),
                    0,
                    Math.max(1, Number(state.doc?.content?.size || 1)),
                  );
                  markerNodes.push({
                    from: anchoredMarkerPos,
                    to: anchoredMarkerPos,
                    context: { ...syntheticContext },
                    synthetic: true,
                    index: markerOrdinal,
                    rawName: String(span?.markerRawName || ""),
                  });
                }
              }

              const resolvedActiveIndex = segmentNodes.findIndex(
                (segment) =>
                  selectionPos >= segment.from && selectionPos < segment.to,
              );
              const resolvedHeadIndex =
                resolvedActiveIndex >= 0
                  ? resolvedActiveIndex
                  : segmentNodes.findIndex(
                      (segment) =>
                        selectionHeadPos >= segment.from &&
                        selectionHeadPos < segment.to,
                    );
              const topLevelFrom =
                state.selection?.$from && state.selection.$from.depth >= 1
                  ? state.selection.$from.before(1)
                  : -1;
              const resolvedTopLevelIndex =
                resolvedHeadIndex >= 0
                  ? resolvedHeadIndex
                  : segmentNodes.findIndex(
                      (segment) => segment.from === topLevelFrom,
                    );
              const activeSegmentIndex =
                resolvedTopLevelIndex >= 0
                  ? resolvedTopLevelIndex
                  : segmentNodes.length > 0
                    ? 0
                    : -1;
              const activeSegment =
                activeSegmentIndex >= 0
                  ? segmentNodes[activeSegmentIndex]
                  : null;
              const activeContext = activeSegment
                ? activeSegment.context
                : {
                    section: "",
                    subsection: "",
                    field: "",
                    fieldIsContainer: false,
                  };

              const segmentActiveFlags = segmentNodes.map(
                (_segment, index) => index === activeSegmentIndex,
              );

              segmentNodes.forEach((segment, index) => {
                const isActive = Boolean(segmentActiveFlags[index]);
                let runClass = "";
                if (isActive) {
                  const prevActive = Boolean(segmentActiveFlags[index - 1]);
                  const nextActive = Boolean(segmentActiveFlags[index + 1]);
                  if (!prevActive && !nextActive) {
                    runClass = "mfe-doc-segment--group-single";
                  } else if (!prevActive && nextActive) {
                    runClass = "mfe-doc-segment--group-start";
                  } else if (prevActive && nextActive) {
                    runClass = "mfe-doc-segment--group-middle";
                  } else {
                    runClass = "mfe-doc-segment--group-end";
                  }
                }
                const className = `${buildClassName(segment.context)} ${
                  isActive ? "mfe-doc-segment--active" : "mfe-doc-segment--dim"
                }${runClass ? ` ${runClass}` : ""}`;

                decorations.push(
                  Decoration.node(segment.from, segment.to, {
                    class: className,
                    "data-mfe-doc-label": buildLabel(segment.context),
                  }),
                );
              });

              markerNodes.forEach((marker) => {
                const isActive = marker.context.field
                  ? Boolean(
                      marker.context.fieldIsContainer
                        ? contextsEqual(marker.context, activeContext)
                        : activeSegment &&
                            activeContext.field &&
                            contextsEqual(marker.context, activeContext) &&
                            firstFieldSegmentFromByKey.get(
                              contextKey(marker.context),
                            ) === activeSegment.from,
                    )
                  : contextsEqual(marker.context, activeContext);
                const className = `${buildMarkerClassName(marker.context)} ${
                  isActive ? "mfe-doc-marker--active" : "mfe-doc-marker--dim"
                }`;
                const markerLabelFull = buildLabel(marker.context);
                const markerLabelShort = buildShortMarkerLabel(marker.context);
                if (marker.synthetic) {
                  decorations.push(
                    Decoration.widget(
                      marker.from,
                      () => {
                        const markerEl = document.createElement("div");
                        markerEl.className = `mfe-marker ${className}`;
                        markerEl.setAttribute(
                          "data-mfe-doc-label",
                          markerLabelShort,
                        );
                        markerEl.setAttribute(
                          "data-mfe-marker",
                          marker.rawName || markerLabelShort,
                        );

                        markerEl.setAttribute("data-mfe-marker-synth", "1");
                        return markerEl;
                      },
                      {
                        side: -1,
                        key: `mfe-doc-marker:${marker.from}:${marker.index || 0}:${markerLabelFull}`,
                      },
                    ),
                  );
                  return;
                }
                const nodeAttrs = {
                  class: className,
                  "data-mfe-doc-label": markerLabelShort,
                  "data-mfe-marker": markerLabelShort,
                };

                decorations.push(
                  Decoration.node(marker.from, marker.to, nodeAttrs),
                );
              });

              if (!decorations.length) {
                return DecorationSet.empty;
              }
              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
}
