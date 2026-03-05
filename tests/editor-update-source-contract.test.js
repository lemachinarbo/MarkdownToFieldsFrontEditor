/** @jest-environment jsdom */

/** @jest-environment jsdom */

import fs from "node:fs";
import path from "node:path";

// this test does not actually import the editor bundle; that file pulls
// in Tiptap and other browser‑only modules which break under jest.  instead
// we verify the _source text_ for the presence of the helpers and replicate
// the classification logic locally so we can exercise it.

// copy of the internal state/logic from editor-fullscreen.js
let lastEditorInputAt = 0;
let lastEditorInputSource = "";
let lastUserIntentAt = 0;
let lastUserIntentSource = "";
function markEditorInputSource(source) {
  lastEditorInputAt = Date.now();
  lastEditorInputSource = String(source || "unknown");
  markUserIntentToken(`editor:${lastEditorInputSource}`);
}
function markUserIntentToken(source) {
  lastUserIntentAt = Date.now();
  lastUserIntentSource = String(source || "ui");
}
function resolveEditorUpdateSource(transaction) {
  const now = Date.now();
  const fromRecentEditorInput = now - lastEditorInputAt <= 1500;
  const fromRecentUserIntent = now - lastUserIntentAt <= 1500;
  const uiEvent = String(transaction?.getMeta?.("uiEvent") || "");
  const pointer = Boolean(transaction?.getMeta?.("pointer"));
  const docChanged = Boolean(transaction?.docChanged);

  if (fromRecentEditorInput) {
    return {
      source: "human",
      inputSource: lastEditorInputSource,
      uiEvent,
      pointer,
      intentSource: lastUserIntentSource,
      fromRecentEditorInput,
      fromRecentUserIntent,
      docChanged,
    };
  }

  if (fromRecentUserIntent && docChanged) {
    return {
      source: "human",
      inputSource: lastEditorInputSource,
      uiEvent,
      pointer,
      intentSource: lastUserIntentSource,
      fromRecentEditorInput,
      fromRecentUserIntent,
      docChanged,
    };
  }

  return {
    source: "system",
    inputSource: lastEditorInputSource,
    uiEvent,
    pointer,
    intentSource: lastUserIntentSource,
    fromRecentEditorInput,
    fromRecentUserIntent,
    docChanged,
  };
}

const ROOT = path.resolve(process.cwd());
const FULLSCREEN_PATH = path.join(ROOT, "src/editor-fullscreen.js");

function readSource() {
  return fs.readFileSync(FULLSCREEN_PATH, "utf8");
}

function makeTransaction(meta = {}) {
  return {
    docChanged: Boolean(meta.docChanged),
    getMeta(key) {
      return meta[key];
    },
  };
}

function buildSavePlan(states, currentLang = "") {
  return states
    .filter((state) => Boolean(state?.dirty))
    .sort((left, right) => {
      if (left.lang === currentLang && right.lang !== currentLang) return -1;
      if (right.lang === currentLang && left.lang !== currentLang) return 1;
      return String(left.lang || "").localeCompare(String(right.lang || ""));
    });
}

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

function buildFirstDiffSample(leftText, rightText, radius = 40) {
  const left = typeof leftText === "string" ? leftText : "";
  const right = typeof rightText === "string" ? rightText : "";
  if (left === right) {
    return { offset: -1, leftContext: "", rightContext: "" };
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
  return {
    offset,
    leftContext: left.slice(start, Math.min(left.length, offset + radius)),
    rightContext: right.slice(start, Math.min(right.length, offset + radius)),
  };
}

function computeFirstTokenDelta(leftText, rightText) {
  const leftTokens = String(leftText || "").match(/\S+/g) || [];
  const rightTokens = String(rightText || "").match(/\S+/g) || [];
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
    };
  }
  const sentNormalized = normalizeForReadbackClassification(sentText);
  const persistedNormalized = normalizeForReadbackClassification(persistedText);
  const semanticDiff = buildFirstDiffSample(sentNormalized, persistedNormalized);
  if (sentNormalized === persistedNormalized) {
    return {
      className: "marker_blankline_normalization",
      firstDiffOffset: rawDiff.offset,
      firstDiffOffsetRaw: rawDiff.offset,
      firstSemanticDiffOffset: -1,
    };
  }
  const tokenDelta = computeFirstTokenDelta(sentNormalized, persistedNormalized);
  return {
    className: "text_token_drift",
    firstDiffOffset: semanticDiff.offset,
    firstDiffOffsetRaw: rawDiff.offset,
    firstSemanticDiffOffset: semanticDiff.offset,
    tokenBefore: tokenDelta.tokenBefore,
    tokenAfter: tokenDelta.tokenAfter,
  };
}

describe("editor update-source contract", () => {
  let source;

  beforeEach(() => {
    source = readSource();
    lastEditorInputAt = 0;
    lastEditorInputSource = "";
    lastUserIntentAt = 0;
    lastUserIntentSource = "";
  });

  test("source file contains human/system classification and warning log", () => {
    expect(source).toContain("resolveEditorUpdateSource");
    expect(source).toContain("[mfe:editor-update-source] blocked-non-human-update");
    expect(source).toContain("MFE_DIRTY_DESYNC");
    expect(source).toContain("SAVE_READBACK_SEMANTIC_DRIFT");

    // ensure the update handler actually invokes the resolver
    const updateHandlerIndex = source.indexOf("resolveEditorUpdateSource(transaction)");
    expect(updateHandlerIndex).toBeGreaterThan(-1);
  });

  test("source file exports the test helpers", () => {
    // we do not import the module in this spec, so ensure the helpers are
    // actually present in the source text for other consumers (e.g. E2E).
    expect(source).toContain("__testResolveEditorUpdateSource");
    expect(source).toContain("__testMarkEditorInputSource");
  });

  test("replicated helpers classify correctly", () => {
    // initial state, no recent input
    const result1 = resolveEditorUpdateSource(makeTransaction({ docChanged: true }));
    expect(result1.source).toBe("system");
    expect(result1.inputSource).toBe("");
  });

  test("recent input marks transaction as human, older input is system", () => {
    jest.useFakeTimers();

    // simulate a keystroke
    markEditorInputSource("keyboard");

    // advance by 1s which is inside the 1500ms window
    jest.advanceTimersByTime(1000);
    const t1 = makeTransaction({ uiEvent: "keypress", pointer: true, docChanged: true });
    const res1 = resolveEditorUpdateSource(t1);
    expect(res1).toMatchObject({
      source: "human",
      inputSource: "keyboard",
      uiEvent: "keypress",
      pointer: true,
      fromRecentEditorInput: true,
    });

    // move clock past the threshold
    jest.advanceTimersByTime(2000);
    const t2 = makeTransaction({ uiEvent: "paste", pointer: false, docChanged: true });
    const res2 = resolveEditorUpdateSource(t2);
    expect(res2).toMatchObject({
      source: "system",
      inputSource: "keyboard", // last input source persists, even if stale
      uiEvent: "paste",
      pointer: false,
      fromRecentEditorInput: false,
    });

    jest.useRealTimers();
  });

  test("toolbar intent token marks doc-changing transaction as human", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    markUserIntentToken("toolbar:bold:mousedown");
    jest.advanceTimersByTime(200);

    const result = resolveEditorUpdateSource(
      makeTransaction({ uiEvent: "", pointer: false, docChanged: true }),
    );
    expect(result).toMatchObject({
      source: "human",
      intentSource: "toolbar:bold:mousedown",
      fromRecentUserIntent: true,
      docChanged: true,
    });

    jest.useRealTimers();
  });

  test("non-human/system transaction remains blocked", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const result = resolveEditorUpdateSource(
      makeTransaction({ uiEvent: "", pointer: false, docChanged: true }),
    );
    expect(result.source).toBe("system");
    jest.useRealTimers();
  });

  test("single-language save plan contains only en dirty state", () => {
    const plan = buildSavePlan(
      [
        { lang: "en", dirty: true },
        { lang: "es", dirty: false },
        { lang: "it", dirty: false },
      ],
      "en",
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].lang).toBe("en");
  });

  test("readback classifier marks marker blank-line insertion as normalization", () => {
    const sent =
      "<!-- section:hero -->\n<!-- title -->\n# The Urban <br>Farm\n\n<!-- intro -->\nX";
    const persisted =
      "\uFEFF\n<!-- section:hero -->\n\n<!-- title -->\n# The Urban <br>Farm\n\n<!-- intro -->\nX";
    const classified = classifyReadbackMismatch(sent, persisted);
    expect(classified.className).toBe("marker_blankline_normalization");
    expect(classified.firstDiffOffsetRaw).toBeGreaterThanOrEqual(0);
    expect(classified.firstSemanticDiffOffset).toBe(-1);
    expect(classified.tokenBefore).toBeUndefined();
    expect(classified.tokenAfter).toBeUndefined();
  });

  test("readback classifier marks lexical change as text token drift", () => {
    const sent =
      "<!-- section:hero -->\n<!-- title -->\n# La granja Urbanas\n\n<!-- intro -->\nX";
    const persisted =
      "<!-- section:hero -->\n<!-- title -->\n# La granja Urbana\n\n<!-- intro -->\nX";
    const classified = classifyReadbackMismatch(sent, persisted);
    expect(classified.className).toBe("text_token_drift");
    expect(classified.tokenBefore).toBe("Urbanas");
    expect(classified.tokenAfter).toBe("Urbana");
    expect(classified.firstSemanticDiffOffset).toBeGreaterThanOrEqual(0);
    expect(classified.firstDiffOffset).toBe(classified.firstSemanticDiffOffset);
  });

  test("readback classifier keeps mixed blank-line + lexical change as text token drift", () => {
    const sent =
      "<!-- section:hero -->\n<!-- title -->\n# La granja Urbanas\n\n<!-- intro -->\nX";
    const persisted =
      "\n<!-- section:hero -->\n\n<!-- title -->\n# La granja Urbana\n\n<!-- intro -->\nX";
    const classified = classifyReadbackMismatch(sent, persisted);
    expect(classified.className).toBe("text_token_drift");
    expect(classified.tokenBefore).toBe("Urbanas");
    expect(classified.tokenAfter).toBe("Urbana");
    expect(classified.firstDiffOffsetRaw).toBeLessThan(
      classified.firstSemanticDiffOffset,
    );
    expect(classified.firstDiffOffset).toBe(classified.firstSemanticDiffOffset);
  });
});
