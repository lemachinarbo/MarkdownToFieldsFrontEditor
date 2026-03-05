import { getDocumentState, listDocumentStates } from "../src/document-state.js";

describe("future state authority", () => {
  test("there is exactly one writable draft source per session+language", () => {
    const store = new Map();

    const payload = {
      pageId: "5",
      fieldScope: "field",
      fieldSection: "hero",
      fieldSubsection: "",
      fieldName: "title",
      fieldId: "5:field:hero:title",
      originKey: "field:hero:title",
      sessionId: "session:single-authority",
    };

    const enOpen = getDocumentState(store, payload, "en", {
      reason: "future:state:open-en",
      trigger: "scope-navigation",
      initialPersistedMarkdown: "Hello",
    });

    enOpen.setDraft("Hello draft", {
      reason: "future:state:edit-en",
      trigger: "user-edit-transaction",
    });

    const enRebound = getDocumentState(
      store,
      {
        ...payload,
        fieldScope: "section",
        fieldName: "hero",
        fieldId: "5:section::hero",
      },
      "en",
      {
        reason: "future:state:rebind-en",
        trigger: "scope-navigation",
      },
    );

    expect(enRebound).toBe(enOpen);
    expect(enRebound.getDraft()).toBe("Hello draft");
    expect(
      listDocumentStates(store).filter((state) => state.lang === "en").length,
    ).toBe(1);

    const esOpen = getDocumentState(store, payload, "es", {
      reason: "future:state:open-es",
      trigger: "scope-navigation",
      initialPersistedMarkdown: "Hola",
    });

    esOpen.setDraft("Hola draft", {
      reason: "future:state:edit-es",
      trigger: "user-edit-transaction",
    });

    expect(listDocumentStates(store).length).toBe(2);
    expect(enOpen.getDraft()).toBe("Hello draft");
    expect(esOpen.getDraft()).toBe("Hola draft");

    const hydrateBlocked = enOpen.hydrateFromServer("Server overwrite", {
      reason: "future:state:blocked-hydrate",
      trigger: "system-rehydrate",
    });
    expect(hydrateBlocked).toBe(false);
    expect(enOpen.getDraft()).toBe("Hello draft");

    enOpen.markSaved("Hello draft", {
      reason: "future:state:save-en",
      trigger: "save-commit",
    });
    expect(enOpen.isDirty()).toBe(false);
  });
});
