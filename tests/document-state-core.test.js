import {
  DocumentState,
  buildPayloadFieldId,
  getDocumentState,
  clearDocumentState,
  listDocumentStates,
  emitStatesSavedBatch,
  __testResetDocStateSeq,
} from "../src/document-state.js";

describe("document-state core", () => {
  const payload = {
    pageId: "1",
    fieldScope: "field",
    fieldSection: "hero",
    fieldSubsection: "",
    fieldName: "title",
    fieldId: "1:field:hero:title",
  };

  test("buildPayloadFieldId is deterministic", () => {
    const idA = buildPayloadFieldId(payload);
    const idB = buildPayloadFieldId({ ...payload });
    expect(idA).toBe(idB);
  });

  test("getDocumentState returns same instance for same payload and lang", () => {
    const store = new Map();
    const a = getDocumentState(store, payload, "de", {
      initialPersistedMarkdown: "eins",
    });
    const b = getDocumentState(store, payload, "de", {
      initialPersistedMarkdown: "zwei",
    });

    expect(a).toBe(b);
    expect(store.size).toBe(1);
    expect(a.getDraft()).toBe("eins");
  });

  test("setDraft and markSaved are the only dirty state transitions", () => {
    const state = new DocumentState(payload, "fr", {
      initialPersistedMarkdown: "bonjour",
    });

    expect(state.isDirty()).toBe(false);

    state.setDraft("salut", {
      reason: "test:setDraft",
      trigger: "user-edit-transaction",
    });
    expect(state.isDirty()).toBe(true);

    state.markSaved("salut", {
      reason: "test:markSaved",
      trigger: "save-commit",
    });
    expect(state.isDirty()).toBe(false);
    expect(state.getDraft()).toBe("salut");
  });

  test("scope-navigation mutation attempts fail fast", () => {
    const state = new DocumentState(payload, "es", {
      initialPersistedMarkdown: "hola",
    });

    expect(() =>
      state.setDraft("adios", {
        reason: "test:forbidden",
        trigger: "scope-navigation",
      }),
    ).toThrow("unsupported trigger");
  });

  test("clearDocumentState removes entry only on explicit call", () => {
    const store = new Map();
    const state = getDocumentState(store, payload, "it", {
      initialPersistedMarkdown: "ciao",
    });

    state.setDraft("ciao mondo", {
      reason: "test:setDraft",
      trigger: "user-command",
    });

    expect(listDocumentStates(store).length).toBe(1);
    expect(clearDocumentState(store, state.id)).toBe(true);
    expect(listDocumentStates(store).length).toBe(0);
  });

  test("logs required state-event payload fields", () => {
    __testResetDocStateSeq();
    globalThis.__MFE_DOC_STATE_LOGS = [];

    const state = new DocumentState(payload, "en", {
      reason: "test:open",
      trigger: "session-open",
    });
    state.setDraft("image ![x](a.jpg)", {
      reason: "test:update",
      trigger: "user-command",
    });
    state.markSaved("image ![x](a.jpg)", {
      reason: "test:save",
      trigger: "save-commit",
    });
    emitStatesSavedBatch([state.id], {
      language: "en",
      originKey: payload.fieldId,
      currentScope: payload.fieldScope,
      reason: "test:batch",
      trigger: "save-commit",
    });

    const logs = Array.isArray(globalThis.__MFE_DOC_STATE_LOGS)
      ? globalThis.__MFE_DOC_STATE_LOGS
      : [];
    const event = logs.find((entry) => entry?.type === "STATE_UPDATED") || {};

    [
      "stateId",
      "language",
      "originKey",
      "currentScope",
      "reason",
      "trigger",
      "dirtyBefore",
      "dirtyAfter",
      "hashBefore",
      "hashAfter",
      "ts",
      "seq",
    ].forEach((field) => {
      expect(event).toHaveProperty(field);
    });

    const batchEvent =
      logs.find((entry) => entry?.type === "STATES_SAVED_BATCH") || {};
    expect(batchEvent.stateIds).toEqual([state.id]);
  });

  test("document shape validation keeps marker graph under mixed line endings", () => {
    const previousConfig = globalThis.MarkdownFrontEditorConfig;
    globalThis.MarkdownFrontEditorConfig = {
      ...(previousConfig || {}),
      debug: true,
    };

    const documentPayload = {
      pageId: "1",
      fieldScope: "document",
      fieldSection: "",
      fieldSubsection: "",
      fieldName: "document",
      fieldId: "1:document::document",
    };

    const persisted =
      "<!-- section:columns -->\r\n### How we work\r\n<!-- subsection:right -->\r\nBody";
    const edited =
      "<!-- section:columns -->\r\n### How we works\r<!-- subsection:right -->\r\nBody";

    const state = new DocumentState(documentPayload, "en", {
      initialPersistedMarkdown: persisted,
      currentScope: "section",
      reason: "test:open-document",
      trigger: "scope-navigation",
    });

    expect(() =>
      state.setDraft(edited, {
        reason: "test:mixed-line-endings-edit",
        trigger: "user-command",
      }),
    ).not.toThrow();

    globalThis.MarkdownFrontEditorConfig = previousConfig;
  });
});
