import {
  getDocumentState,
  __testResetDocStateSeq,
} from "../src/document-state.js";

function readTraceTypes() {
  const entries = Array.isArray(globalThis.__MFE_DOC_STATE_LOGS)
    ? globalThis.__MFE_DOC_STATE_LOGS
    : [];
  return entries.map((entry) => String(entry?.type || ""));
}

describe("phase0 kill-switch trace checkpoint", () => {
  beforeEach(() => {
    globalThis.__MFE_DOC_STATE_LOGS = [];
    __testResetDocStateSeq();
  });

  test("open -> edit -> scope-switch -> save emits stable trace", () => {
    const store = new Map();
    const payloadField = {
      pageId: "1",
      fieldScope: "field",
      fieldSection: "hero",
      fieldSubsection: "",
      fieldName: "title",
      fieldId: "1:field:hero:title",
      originKey: "field:hero:title",
      sessionId: "session:trace",
    };

    const state = getDocumentState(store, payloadField, "en", {
      reason: "trace:open",
      trigger: "scope-navigation",
      currentScope: "field",
      initialPersistedMarkdown: "Old",
      initialDraftMarkdown: "Old",
    });
    state.setDraft("New", {
      reason: "trace:edit",
      trigger: "user-edit-transaction",
    });

    getDocumentState(
      store,
      {
        ...payloadField,
        fieldScope: "section",
        fieldName: "hero",
        fieldId: "1:section::hero",
      },
      "en",
      {
        reason: "trace:scopeSwitch",
        trigger: "scope-navigation",
        currentScope: "section",
      },
    );

    state.markSaved(state.getDraft(), {
      reason: "trace:save",
      trigger: "save-commit",
    });

    expect(readTraceTypes()).toEqual([
      "STATE_OPENED",
      "STATE_UPDATED",
      "STATE_REBOUND",
      "STATE_SAVED",
    ]);
  });

  test("multilanguage session traces remain isolated per lang", () => {
    const store = new Map();
    const payload = {
      pageId: "1",
      fieldScope: "field",
      fieldSection: "hero",
      fieldSubsection: "",
      fieldName: "title",
      fieldId: "1:field:hero:title",
      originKey: "field:hero:title",
      sessionId: "session:trace-lang",
    };

    const en = getDocumentState(store, payload, "en", {
      reason: "trace:open-en",
      trigger: "scope-navigation",
      currentScope: "field",
      initialPersistedMarkdown: "Hello",
    });
    const es = getDocumentState(store, payload, "es", {
      reason: "trace:open-es",
      trigger: "scope-navigation",
      currentScope: "field",
      initialPersistedMarkdown: "Hola",
    });

    en.setDraft("Hello X", {
      reason: "trace:edit-en",
      trigger: "user-edit-transaction",
    });
    es.setDraft("Hola Y", {
      reason: "trace:edit-es",
      trigger: "user-edit-transaction",
    });
    en.markSaved(en.getDraft(), {
      reason: "trace:save-en",
      trigger: "save-commit",
    });

    const entries = Array.isArray(globalThis.__MFE_DOC_STATE_LOGS)
      ? globalThis.__MFE_DOC_STATE_LOGS
      : [];
    const enEvents = entries.filter((entry) => entry.language === "en");
    const esEvents = entries.filter((entry) => entry.language === "es");

    expect(enEvents.map((entry) => entry.type)).toEqual([
      "STATE_OPENED",
      "STATE_UPDATED",
      "STATE_SAVED",
    ]);
    expect(esEvents.map((entry) => entry.type)).toEqual([
      "STATE_OPENED",
      "STATE_UPDATED",
    ]);
  });
});
