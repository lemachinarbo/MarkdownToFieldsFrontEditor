import {
  detectDirtyDesync,
  buildSavePlan,
  resolveFallbackSaveEditorMarkdown,
  summarizeSaveResults,
} from "../src/save-orchestration.js";

describe("save-orchestration helpers", () => {
  test("buildSavePlan sorts current language first and logs plan", () => {
    const events = [];
    const state = (id, lang, dirty) => ({
      id,
      lang,
      isDirty: () => dirty,
      isUnreplayable: () => false,
      getDraft: () => `${lang}-${id}`,
    });
    const listStatesForActiveSession = () => [
      state("a", "es", true),
      state("b", "en", true),
      state("c", "de", false),
    ];
    const { saveCandidates, plannedHashesByStateId } = buildSavePlan({
      sessionStateKey: "session:1",
      currentLang: "en",
      activeFieldScope: "field",
      listStatesForActiveSession,
      emitDocStateLog: (type, payload) => events.push({ type, payload }),
      hashStateIdentity: (value) => `h:${value.length}`,
    });

    expect(saveCandidates.map((entry) => entry.lang)).toEqual(["en", "es"]);
    expect(plannedHashesByStateId.get("b")).toBe("h:4");
    expect(events[0]?.type).toBe("SAVE_PLAN_BUILT");
  });

  test("detectDirtyDesync returns null when editor/state are equal", () => {
    const cleanState = {
      lang: "en",
      isDirty: () => false,
      getDraft: () => "hello",
    };
    const mismatch = detectDirtyDesync({
      sessionStates: [cleanState],
      currentLang: "en",
      secondaryLang: "",
      primaryEditor: { id: "editor" },
      applyScopeMeta: { scopeKind: "field" },
      getMarkdownFromEditor: () => "hello",
      readScopeSliceFromMarkdown: (markdown) => markdown,
      normalizeComparableMarkdown: (value) => String(value || "").trim(),
      normalizeLangValue: (value) => String(value || ""),
      hashStateIdentity: (value) => `h:${String(value || "").length}`,
    });
    expect(mismatch).toBeNull();
  });

  test("summarizeSaveResults returns expected aggregates", () => {
    const state = (id) => ({ id });
    const summary = summarizeSaveResults([
      { ok: true, state: state("a"), hasFragments: false },
      { ok: false, state: state("b"), hasFragments: false },
      { ok: true, state: state("c"), hasFragments: true },
    ]);
    expect(summary.savedStateIds).toEqual(["a", "c"]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.hasFragments).toBe(true);
  });

  test("document fallback save markdown is projected from canonical body when no editor is mounted", () => {
    const canonicalBody = [
      "<!-- section:hero -->",
      "",
      "<!-- title -->",
      "# The Urban <br>Farm",
      "",
      "<!-- intro... -->",
      "We grow food and ideas.",
    ].join("\n");

    const normalized = resolveFallbackSaveEditorMarkdown({
      fallbackMarkdown: canonicalBody,
      canonicalBody,
      scopeMeta: {
        scopeKind: "document",
        section: "",
        subsection: "",
        name: "document",
      },
    });

    expect(normalized).toContain("# The Urban <br>Farm");
    expect(normalized).toContain("We grow food and ideas.");
    expect(normalized).not.toContain("<!-- section:hero -->");
    expect(normalized.length).toBeLessThan(canonicalBody.length);
  });
});
