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
        params.hashStateIdentity(String(state.getDraft() || "")),
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
