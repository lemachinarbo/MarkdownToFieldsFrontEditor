import {
  projectCanonicalSlice,
  resolveCanonicalScopeSlice,
} from "./canonical-scope-session.js";
import { normalizeScopeKind } from "./scope-slice.js";
import { normalizeLineEndingsToLf } from "./markdown-text-utils.js";

// Restore escaped markdown syntax (unescapes \# to # and \[ to [)
function restoreEscapedMarkdownSyntax(markdown) {
  const current = String(markdown || "");
  if (!current) return current;

  const normalized = current
    .split(/\r?\n/)
    .map((line) => {
      let nextLine = String(line || "");

      if (/^[ \t]*\\#{1,6}[ \t]+\S/.test(nextLine)) {
        nextLine = nextLine.replace(/^([ \t]*)\\(#{1,6}[ \t]+)/, "$1$2");
      }

      if (/^[ \t]*!\\\[[^\]]*\\\]\([^\)]+\)/.test(nextLine)) {
        nextLine = nextLine.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
      }

      return nextLine;
    })
    .join("\n");

  return normalized;
}

function getStatePreComposeComparableMarkdown(state) {
  const bodyDraft = String(state?.getDraft?.() || "");
  if (typeof state?.recomposeMarkdownForSave === "function") {
    const recomposed = String(state.recomposeMarkdownForSave(bodyDraft) || "");
    // Keep plan-time hash aligned with dispatch pre-compose hash stage.
    // Do not apply final document composition at this point.
    const restored = restoreEscapedMarkdownSyntax(recomposed);
    return normalizeLineEndingsToLf(restored);
  }
  const restored = restoreEscapedMarkdownSyntax(bodyDraft);
  return normalizeLineEndingsToLf(restored);
}

export function detectDirtyDesync(params = {}) {
  const {
    sessionStates = [],
    currentLang = "",
    secondaryLang = "",
    primaryEditor = null,
    secondaryEditor = null,
    applyScopeMeta = {},
    getMarkdownFromEditor,
    readScopeSliceFromMarkdown,
    normalizeComparableMarkdown,
    normalizeDocumentComparableMarkdown,
    normalizeScopedComparableMarkdown,
    normalizeLangValue,
    hashStateIdentity,
  } = params;

  const assertNoDirtyDesync = (editor, lang, channel) => {
    const normalizedLang = normalizeLangValue(lang);
    if (!editor || !normalizedLang) return null;
    const state = sessionStates.find((entry) => entry.lang === normalizedLang);
    if (!state || state.isDirty()) return null;
    const editorMarkdown = String(getMarkdownFromEditor(editor) || "");
    const stateScopedMarkdown = readScopeSliceFromMarkdown(
      String(state.getDraft() || ""),
      applyScopeMeta,
    );
    const isDocumentScope =
      String(applyScopeMeta?.scopeKind || state?.scopeKind || "") ===
      "document";
    const isStructuralScope =
      String(applyScopeMeta?.scopeKind || state?.scopeKind || "") ===
        "section" ||
      String(applyScopeMeta?.scopeKind || state?.scopeKind || "") ===
        "subsection";
    const normalizeStructuralLeadingBoundary = (markdown) => {
      const normalized = String(markdown || "").replace(/\r\n?|\r/g, "\n");
      return normalized.replace(/^\n+(?=[\t ]{0,3}#)/, "");
    };
    let editorInput = isStructuralScope
      ? normalizeStructuralLeadingBoundary(editorMarkdown)
      : editorMarkdown;
    let stateInput = isStructuralScope
      ? normalizeStructuralLeadingBoundary(stateScopedMarkdown)
      : stateScopedMarkdown;
    if (typeof normalizeScopedComparableMarkdown === "function") {
      editorInput = normalizeScopedComparableMarkdown(editorInput, {
        scopeKind: applyScopeMeta?.scopeKind || state?.scopeKind || "field",
        channel,
        source: "editor",
      });
      stateInput = normalizeScopedComparableMarkdown(stateInput, {
        scopeKind: applyScopeMeta?.scopeKind || state?.scopeKind || "field",
        channel,
        source: "state",
      });
    }
    const normalizeForCompare =
      isDocumentScope &&
      typeof normalizeDocumentComparableMarkdown === "function"
        ? normalizeDocumentComparableMarkdown
        : normalizeComparableMarkdown;
    const editorComparable = normalizeForCompare(editorInput);
    const stateComparable = normalizeForCompare(stateInput);
    if (editorComparable === stateComparable) {
      return null;
    }
    return {
      state,
      channel: String(channel || "primary"),
      editorHash: hashStateIdentity(editorMarkdown),
      stateHash: hashStateIdentity(stateScopedMarkdown),
      editorComparableHash: hashStateIdentity(editorComparable),
      stateComparableHash: hashStateIdentity(stateComparable),
    };
  };

  return (
    assertNoDirtyDesync(primaryEditor, currentLang, "primary") ||
    assertNoDirtyDesync(secondaryEditor, secondaryLang, "secondary")
  );
}

export function resolveFallbackSaveEditorMarkdown(params = {}) {
  const fallbackMarkdown = String(params.fallbackMarkdown || "");
  if (!fallbackMarkdown) return "";

  const scopeMeta =
    params.scopeMeta && typeof params.scopeMeta === "object"
      ? params.scopeMeta
      : {};
  const canonicalBody = String(params.canonicalBody || "");
  const scopeKind = normalizeScopeKind(scopeMeta.scopeKind || "field");
  const markerBearingInput =
    fallbackMarkdown.includes("<!--") || canonicalBody.includes("<!--");

  if (!markerBearingInput) {
    return fallbackMarkdown;
  }

  try {
    const scopeSlice = resolveCanonicalScopeSlice(
      canonicalBody || fallbackMarkdown,
      scopeMeta,
    );
    const projection = projectCanonicalSlice(scopeSlice);
    const displayText = String(projection?.displayText || "");
    if (scopeKind === "document" || displayText) {
      return displayText;
    }
    throw new Error(
      "marker-bearing projection resolved empty display text for non-document scope",
    );
  } catch (error) {
    throw new Error(
      `[mfe] fallback save blocked: marker-bearing projection failed (${error?.message || "unknown error"})`,
    );
  }

  return fallbackMarkdown;
}

export function buildSavePlan(params = {}) {
  const {
    sessionStateKey = "",
    currentLang = "",
    activeFieldScope = "",
    listStatesForActiveSession,
    emitDocStateLog,
    isStateDirtyForSave = null,
    isStateExcludedFromSave = null,
  } = params;

  const deriveDirty =
    typeof isStateDirtyForSave === "function"
      ? isStateDirtyForSave
      : (state) => Boolean(state?.isDirty?.());
  const isExcluded =
    typeof isStateExcludedFromSave === "function"
      ? isStateExcludedFromSave
      : (state) => Boolean(state?.isUnreplayable?.());

  const sessionStates = listStatesForActiveSession(sessionStateKey);
  const derivedDirtyStates = sessionStates.filter((state) =>
    deriveDirty(state),
  );
  const saveCandidates = sessionStates
    .filter((state) => deriveDirty(state) && !isExcluded(state))
    .sort((left, right) => {
      if (left.lang === currentLang && right.lang !== currentLang) return -1;
      if (right.lang === currentLang && left.lang !== currentLang) return 1;
      return String(left.lang || "").localeCompare(String(right.lang || ""));
    });

  emitDocStateLog("SAVE_PLAN_BUILT", {
    stateId: saveCandidates.map((state) => state.id).join(","),
    stateIds: saveCandidates.map((state) => state.id),
    langs: saveCandidates.map((state) => state.lang),
    language: currentLang || "*",
    originKey: sessionStateKey || "",
    currentScope: activeFieldScope || "",
    reason: "saveAllEditors:plan",
    trigger: "save-commit",
    dirtyBefore: derivedDirtyStates.length > 0,
    dirtyAfter: derivedDirtyStates.length > 0,
    hashBefore: "save-plan",
    hashAfter: "save-plan",
  });

  return {
    saveCandidates,
    plannedHashesByStateId: new Map(
      saveCandidates.map((state) => [
        state.id,
        params.hashStateIdentity(getStatePreComposeComparableMarkdown(state)),
      ]),
    ),
  };
}

export function summarizeSaveResults(results = []) {
  const succeeded = results.filter((entry) => entry.ok);
  const failed = results.filter((entry) => !entry.ok);
  const savedStateIds = succeeded.map((entry) => entry.state.id);
  const hasFragments = Array.isArray(results)
    ? results.some((entry) => Boolean(entry?.hasFragments))
    : false;
  return {
    succeeded,
    failed,
    savedStateIds,
    hasFragments,
  };
}
