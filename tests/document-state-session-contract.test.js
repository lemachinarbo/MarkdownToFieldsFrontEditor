import { getDocumentState, listDocumentStates } from "../src/document-state.js";

describe("document-state session contract", () => {
  const payloadA = {
    pageId: "5",
    fieldScope: "field",
    fieldSection: "hero",
    fieldSubsection: "",
    fieldName: "title",
    fieldId: "5:field:hero:title",
  };

  const payloadB = {
    pageId: "5",
    fieldScope: "field",
    fieldSection: "hero",
    fieldSubsection: "",
    fieldName: "subtitle",
    fieldId: "5:field:hero:subtitle",
  };

  test("scope navigation keeps state-map cardinality stable", () => {
    const store = new Map();

    const first = getDocumentState(store, payloadA, "de", {
      initialPersistedMarkdown: "Hallo",
    });
    first.setDraft("Hallo Welt", {
      reason: "test:user-edit",
      trigger: "user-edit-transaction",
    });

    const sizeBeforeNavigation = listDocumentStates(store).length;

    getDocumentState(store, payloadA, "de");
    getDocumentState(store, payloadA, "de");

    const sizeAfterNavigation = listDocumentStates(store).length;
    expect(sizeAfterNavigation).toBe(sizeBeforeNavigation);
    expect(sizeAfterNavigation).toBe(1);
  });

  test("secondary draft survives open/close/reopen and save cycle", () => {
    const store = new Map();

    const secondary = getDocumentState(store, payloadB, "fr", {
      initialPersistedMarkdown: "bonjour",
    });

    secondary.setDraft("bonjour à tous", {
      reason: "test:secondary-edit",
      trigger: "user-edit-transaction",
    });
    expect(secondary.isDirty()).toBe(true);

    const reopened = getDocumentState(store, payloadB, "fr");
    expect(reopened.getDraft()).toBe("bonjour à tous");
    expect(reopened.isDirty()).toBe(true);

    reopened.markSaved("bonjour à tous", {
      reason: "test:secondary-save",
      trigger: "save-commit",
    });

    const reopenedAfterSave = getDocumentState(store, payloadB, "fr");
    expect(reopenedAfterSave.getDraft()).toBe("bonjour à tous");
    expect(reopenedAfterSave.isDirty()).toBe(false);
  });
});
