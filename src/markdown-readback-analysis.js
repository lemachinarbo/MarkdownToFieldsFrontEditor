import { parseMarkdownToDoc } from "./editor-core.js";
import {
  computeChangedRanges,
  escapeMarkdownPreview,
} from "./markdown-text-utils.js";

function normalizeForReadbackClassification(value) {
  const text = String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/^[\n]+/, "");
  return text.replace(
    /(<!--\s*[a-zA-Z0-9_:.\/-]+\s*-->)[ \t]*\n(?:[ \t]*\n)+(?=[ \t]*<!--\s*[a-zA-Z0-9_:.\/-]+\s*-->)/g,
    "$1\n",
  );
}

function normalizeForStyleOnlyComparison(value) {
  const normalized = normalizeForReadbackClassification(value)
    .replace(/^(\s*)[\*\+\-](?=\s+\S)/gm, "$1-")
    .replace(/(^|[^\w])__([^\n_]+?)__(?=[^\w]|$)/g, "$1**$2**")
    .replace(/(^|[^\w])_([^\n_]+?)_(?=[^\w]|$)/g, "$1*$2*");
  return normalized.replace(
    /^(\s*[-*+]\s+[^\n]+)\n{2,}(?=\s*[-*+]\s+)/gm,
    "$1\n",
  );
}

function isStyleOnlyDrift(leftText, rightText) {
  return (
    normalizeForStyleOnlyComparison(leftText) ===
    normalizeForStyleOnlyComparison(rightText)
  );
}

function buildFirstDiffSample(leftText, rightText, radius = 40) {
  const left = typeof leftText === "string" ? leftText : "";
  const right = typeof rightText === "string" ? rightText : "";
  if (left === right) {
    return {
      offset: -1,
      leftContext: "",
      rightContext: "",
    };
  }
  let offset = 0;
  while (
    offset < left.length &&
    offset < right.length &&
    left[offset] === right[offset]
  ) {
    offset += 1;
  }
  const start = Math.max(0, offset - radius);
  const leftContext = left.slice(start, Math.min(left.length, offset + radius));
  const rightContext = right.slice(
    start,
    Math.min(right.length, offset + radius),
  );
  return {
    offset,
    leftContext,
    rightContext,
  };
}

function computeFirstTokenDelta(leftText, rightText) {
  const left = String(leftText || "");
  const right = String(rightText || "");
  const leftTokens = left.match(/\S+/g) || [];
  const rightTokens = right.match(/\S+/g) || [];
  const max = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < max; index += 1) {
    const tokenBefore = leftTokens[index] || "";
    const tokenAfter = rightTokens[index] || "";
    if (tokenBefore !== tokenAfter) {
      return { tokenIndex: index, tokenBefore, tokenAfter };
    }
  }
  return { tokenIndex: -1, tokenBefore: "", tokenAfter: "" };
}

function hasListIndentationShapeDrift(leftText, rightText) {
  const left = String(leftText || "");
  const right = String(rightText || "");
  if (!left || !right || left === right) return false;

  const linePattern = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/gm;
  const collectShape = (text) => {
    const shape = [];
    let match = linePattern.exec(text);
    while (match) {
      const indent = String(match[1] || "").replace(/\t/g, "  ").length;
      const marker = String(match[2] || "-");
      const content = String(match[3] || "")
        .replace(/\s+/g, " ")
        .trim();
      shape.push(`${indent}|${marker}|${content}`);
      match = linePattern.exec(text);
    }
    return shape;
  };

  const leftShape = collectShape(left);
  const rightShape = collectShape(right);
  if (!leftShape.length || !rightShape.length) return false;
  if (leftShape.join("\n") === rightShape.join("\n")) return false;

  const tokenDelta = computeFirstTokenDelta(
    normalizeForReadbackClassification(left),
    normalizeForReadbackClassification(right),
  );
  return tokenDelta.tokenIndex < 0;
}

function hasListTopologyDrift(leftText, rightText) {
  const collectItems = (text) => {
    const lines = String(text || "").split("\n");
    const items = [];
    const linePattern = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/;
    for (const line of lines) {
      const match = line.match(linePattern);
      if (!match) continue;
      const indent = String(match[1] || "").replace(/\t/g, "  ").length;
      const content = String(match[3] || "")
        .replace(/\\([\[\]])/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
      if (!content) continue;
      items.push({ content, depth: Math.floor(indent / 2) });
    }
    return items;
  };

  const leftItems = collectItems(leftText);
  const rightItems = collectItems(rightText);
  if (!leftItems.length || !rightItems.length) return false;
  if (leftItems.length !== rightItems.length) return false;

  for (let index = 0; index < leftItems.length; index += 1) {
    if (leftItems[index].content !== rightItems[index].content) {
      return false;
    }
  }

  for (let index = 0; index < leftItems.length; index += 1) {
    if (leftItems[index].depth !== rightItems[index].depth) {
      return true;
    }
  }
  return false;
}

function classifyReadbackMismatch(sent, persisted) {
  const sentText = String(sent || "");
  const persistedText = String(persisted || "");
  const rawDiff = buildFirstDiffSample(sentText, persistedText);

  if (sentText === persistedText) {
    return {
      className: "exact",
      firstDiffOffset: -1,
      firstDiffOffsetRaw: -1,
      firstSemanticDiffOffset: -1,
      sentContext: "",
      persistedContext: "",
      rawSentContext: "",
      rawPersistedContext: "",
      semanticContextSent: "",
      semanticContextPersisted: "",
      tokenBefore: "",
      tokenAfter: "",
    };
  }

  const sentNormalized = normalizeForReadbackClassification(sentText);
  const persistedNormalized = normalizeForReadbackClassification(persistedText);
  const semanticDiff = buildFirstDiffSample(
    sentNormalized,
    persistedNormalized,
  );

  if (semanticDiff.offset < 0) {
    return {
      className: "marker_blankline_normalization",
      firstDiffOffset: rawDiff.offset,
      firstDiffOffsetRaw: rawDiff.offset,
      firstSemanticDiffOffset: -1,
      sentContext: rawDiff.leftContext,
      persistedContext: rawDiff.rightContext,
      rawSentContext: rawDiff.leftContext,
      rawPersistedContext: rawDiff.rightContext,
      semanticContextSent: "",
      semanticContextPersisted: "",
      tokenBefore: "",
      tokenAfter: "",
    };
  }

  if (hasListTopologyDrift(sentText, persistedText)) {
    return {
      className: "list_topology_drift",
      firstDiffOffset: rawDiff.offset,
      firstDiffOffsetRaw: rawDiff.offset,
      firstSemanticDiffOffset: semanticDiff.offset,
      sentContext: semanticDiff.leftContext,
      persistedContext: semanticDiff.rightContext,
      rawSentContext: rawDiff.leftContext,
      rawPersistedContext: rawDiff.rightContext,
      semanticContextSent: semanticDiff.leftContext,
      semanticContextPersisted: semanticDiff.rightContext,
      tokenBefore: "",
      tokenAfter: "",
    };
  }

  if (isStyleOnlyDrift(sentText, persistedText)) {
    return {
      className: "style_only_normalization",
      firstDiffOffset: rawDiff.offset,
      firstDiffOffsetRaw: rawDiff.offset,
      firstSemanticDiffOffset: -1,
      sentContext: rawDiff.leftContext,
      persistedContext: rawDiff.rightContext,
      rawSentContext: rawDiff.leftContext,
      rawPersistedContext: rawDiff.rightContext,
      semanticContextSent: "",
      semanticContextPersisted: "",
      tokenBefore: "",
      tokenAfter: "",
    };
  }

  const tokenDelta = computeFirstTokenDelta(
    sentNormalized,
    persistedNormalized,
  );
  if (tokenDelta.tokenIndex < 0) {
    return {
      className: "style_only_normalization",
      firstDiffOffset: rawDiff.offset,
      firstDiffOffsetRaw: rawDiff.offset,
      firstSemanticDiffOffset: -1,
      sentContext: rawDiff.leftContext,
      persistedContext: rawDiff.rightContext,
      rawSentContext: rawDiff.leftContext,
      rawPersistedContext: rawDiff.rightContext,
      semanticContextSent: "",
      semanticContextPersisted: "",
      tokenBefore: "",
      tokenAfter: "",
    };
  }
  return {
    className: "text_token_drift",
    firstDiffOffset: semanticDiff.offset,
    firstDiffOffsetRaw: rawDiff.offset,
    firstSemanticDiffOffset: semanticDiff.offset,
    sentContext: semanticDiff.leftContext,
    persistedContext: semanticDiff.rightContext,
    rawSentContext: rawDiff.leftContext,
    rawPersistedContext: rawDiff.rightContext,
    semanticContextSent: semanticDiff.leftContext,
    semanticContextPersisted: semanticDiff.rightContext,
    tokenBefore: tokenDelta.tokenBefore || "",
    tokenAfter: tokenDelta.tokenAfter || "",
  };
}

function compareReadbackMarkdown({ sent, persisted }) {
  const classification = classifyReadbackMismatch(sent, persisted);
  if (classification.className === "exact") {
    return { matches: true, normalizedBy: "exact", className: "exact" };
  }
  return {
    matches: false,
    normalizedBy: "none",
    className: classification.className,
  };
}

function buildDisplayDiffTrace(beforeText, afterText, contextRadius = 32) {
  const before = String(beforeText || "");
  const after = String(afterText || "");
  const ranges = computeChangedRanges(before, after);
  const first = ranges[0] || null;
  if (!first) {
    return {
      firstDiffStart: -1,
      beforeWindowEscaped: "",
      afterWindowEscaped: "",
    };
  }
  const start = Math.max(0, Number(first.start || 0));
  const beforeStart = Math.max(0, start - contextRadius);
  const beforeEnd = Math.min(
    before.length,
    Number(first.endBefore || start) + contextRadius,
  );
  const afterStart = Math.max(0, start - contextRadius);
  const afterEnd = Math.min(
    after.length,
    Number(first.endAfter || start) + contextRadius,
  );
  return {
    firstDiffStart: start,
    beforeWindowEscaped: escapeMarkdownPreview(before.slice(beforeStart, beforeEnd)),
    afterWindowEscaped: escapeMarkdownPreview(after.slice(afterStart, afterEnd)),
  };
}

function buildEdgePreview(text, windowSize = 200) {
  const value = String(text || "");
  return {
    firstEscaped: escapeMarkdownPreview(value.slice(0, windowSize)),
    lastEscaped: escapeMarkdownPreview(
      value.slice(Math.max(0, value.length - windowSize)),
    ),
  };
}

function detectUnsupportedMarkdownFeatures(markdown) {
  const text = String(markdown || "");
  const features = [];
  if (/\^\[[^\]]+\]/.test(text)) {
    features.push("inline_footnote");
  }
  return features;
}

function buildSemanticAstFingerprint(markdown, schema) {
  if (!schema) {
    return {
      ok: false,
      reason: "missing-schema",
      fingerprint: "",
      textNodes: [],
    };
  }
  let doc;
  try {
    doc = parseMarkdownToDoc(String(markdown || ""), schema);
  } catch (error) {
    return {
      ok: false,
      reason: `parse-failed:${String(error?.message || error || "unknown")}`,
      fingerprint: "",
      textNodes: [],
    };
  }
  const tokens = [];
  const textNodes = [];
  let textCursor = 0;
  const walk = (node, path) => {
    if (!node) return;
    const nodeType = String(node.type?.name || "unknown");
    const marks = Array.isArray(node.marks)
      ? node.marks.map((mark) => String(mark?.type?.name || "")).sort()
      : [];
    if (node.isText) {
      const rawText = String(node.text || "");
      const normalizedText = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      tokens.push(`t:${normalizedText}|m:${marks.join(",")}`);
      const start = textCursor;
      const end = start + normalizedText.length;
      textNodes.push({
        path: path.join("/"),
        nodeType,
        start,
        end,
        text: normalizedText,
      });
      textCursor = end;
      return;
    }
    const attrs = node.attrs && typeof node.attrs === "object" ? node.attrs : {};
    const attrsKey = Object.keys(attrs)
      .sort()
      .map((key) => `${key}:${JSON.stringify(attrs[key])}`)
      .join(",");
    tokens.push(`<${nodeType}|a:${attrsKey}|m:${marks.join(",")}>`);
    for (let index = 0; index < node.childCount; index += 1) {
      walk(node.child(index), [...path, `${nodeType}[${index}]`]);
    }
    tokens.push(`</${nodeType}>`);
  };
  walk(doc, ["doc"]);
  return {
    ok: true,
    reason: "ok",
    fingerprint: tokens.join("\u241F"),
    textNodes,
  };
}

function findNearestSyntaxNode(textNodes, token, diffOffset) {
  const nodes = Array.isArray(textNodes) ? textNodes : [];
  const preferredToken = String(token || "").trim();
  if (preferredToken) {
    const byToken = nodes.find((entry) =>
      String(entry?.text || "").includes(preferredToken),
    );
    if (byToken) {
      return {
        path: String(byToken.path || ""),
        nodeType: String(byToken.nodeType || ""),
        start: Number(byToken.start || 0),
        end: Number(byToken.end || 0),
        previewEscaped: escapeMarkdownPreview(
          String(byToken.text || "").slice(0, 120),
        ),
      };
    }
  }
  const targetOffset = Math.max(0, Number(diffOffset || 0));
  const byOffset = nodes.find(
    (entry) =>
      targetOffset >= Number(entry?.start || 0) &&
      targetOffset <= Number(entry?.end || 0),
  );
  if (!byOffset) return null;
  return {
    path: String(byOffset.path || ""),
    nodeType: String(byOffset.nodeType || ""),
    start: Number(byOffset.start || 0),
    end: Number(byOffset.end || 0),
    previewEscaped: escapeMarkdownPreview(String(byOffset.text || "").slice(0, 120)),
  };
}

function compareReadbackSemanticAst(
  sentMarkdown,
  persistedMarkdown,
  schema,
  diffMeta = {},
) {
  const sentAst = buildSemanticAstFingerprint(sentMarkdown, schema);
  const persistedAst = buildSemanticAstFingerprint(persistedMarkdown, schema);
  const comparable = Boolean(sentAst.ok && persistedAst.ok);
  const equivalent = comparable && sentAst.fingerprint === persistedAst.fingerprint;
  const firstDiffOffset = Number(diffMeta?.firstDiffOffset || 0);
  const tokenBefore = String(diffMeta?.tokenBefore || "");
  const tokenAfter = String(diffMeta?.tokenAfter || "");
  return {
    comparable,
    equivalent,
    sentReason: String(sentAst.reason || ""),
    persistedReason: String(persistedAst.reason || ""),
    sentNearestSyntaxNode: findNearestSyntaxNode(
      sentAst.textNodes,
      tokenBefore,
      firstDiffOffset,
    ),
    persistedNearestSyntaxNode: findNearestSyntaxNode(
      persistedAst.textNodes,
      tokenAfter,
      firstDiffOffset,
    ),
  };
}

export {
  buildDisplayDiffTrace,
  buildEdgePreview,
  compareReadbackSemanticAst,
  classifyReadbackMismatch,
  compareReadbackMarkdown,
  detectUnsupportedMarkdownFeatures,
  hasListIndentationShapeDrift,
  hasListTopologyDrift,
  isStyleOnlyDrift,
  normalizeForReadbackClassification,
};
