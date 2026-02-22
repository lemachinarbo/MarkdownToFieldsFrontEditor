import { Extension } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

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
              const firstFieldSegmentFromByKey = new Map();
              let context = {
                section: "",
                subsection: "",
                field: "",
                fieldIsContainer: false,
              };
              const selectionPos = state.selection?.from || 0;

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

              const activeSegment = segmentNodes.find(
                (segment) =>
                  selectionPos >= segment.from && selectionPos <= segment.to,
              );
              const activeContext = activeSegment
                ? activeSegment.context
                : {
                    section: "",
                    subsection: "",
                    field: "",
                    fieldIsContainer: false,
                  };

              const segmentActiveFlags = segmentNodes.map((segment) => {
                if (!activeSegment) return false;
                if (!segment.context.field) {
                  return contextsEqual(segment.context, activeContext);
                }
                if (segment.context.fieldIsContainer) {
                  return contextsEqual(segment.context, activeContext);
                }
                return segment.from === activeSegment.from;
              });

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
                decorations.push(
                  Decoration.node(marker.from, marker.to, {
                    class: className,
                    "data-mfe-doc-label": buildLabel(marker.context),
                  }),
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
