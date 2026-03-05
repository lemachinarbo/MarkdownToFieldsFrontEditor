import {
  resolveSessionIdentityEnvelope,
  buildTranslationHydrationKey,
} from "../src/session-identity.js";
import { getDocumentState, listDocumentStates } from "../src/document-state.js";

describe("future identity invariant", () => {
  test("session identity stays invariant across scope, language, and UI navigation paths", () => {
    const uiContexts = [
      { preserveActiveOrigin: false },
      { preserveActiveOrigin: true },
    ];

    const scopePayloads = [
      {
        pageId: "1",
        fieldId: "1:field:hero:title",
        originKey: "1:field:hero:title",
      },
      {
        pageId: "1",
        fieldId: "1:section::hero",
        originKey: "1:section::hero",
      },
      {
        pageId: "1",
        fieldId: "1:document::document",
        originKey: "1:document::document",
      },
    ];

    const envelopes = [];
    uiContexts.forEach((uiContext) => {
      scopePayloads.forEach((payload) => {
        envelopes.push(
          resolveSessionIdentityEnvelope(payload, {
            ...uiContext,
            activeSessionStateId: "session:stable",
            activePageId: "1",
            activeOriginFieldKey: "field:hero:title",
          }),
        );
      });
    });

    const sessionIds = new Set(envelopes.map((entry) => entry.sessionStateId));
    const originKeys = new Set(envelopes.map((entry) => entry.originFieldKey));

    expect(sessionIds.size).toBe(1);
    expect(Array.from(sessionIds)[0]).toBe("session:stable");
    expect(originKeys.size).toBe(1);
    expect(Array.from(originKeys)[0]).toBe("field:hero:title");

    const hydrationKeys = new Set(
      envelopes.map((entry) =>
        buildTranslationHydrationKey({
          sessionStateId: entry.sessionStateId,
          originKey: entry.originFieldKey,
          pageId: entry.pageId,
          scope: "field",
          section: "hero",
          subsection: "",
          name: "title",
        }),
      ),
    );
    expect(hydrationKeys.size).toBe(1);
    expect(Array.from(hydrationKeys)[0]).toBe("session:stable");

    const store = new Map();
    const stateFieldEn = getDocumentState(
      store,
      {
        pageId: "1",
        fieldScope: "field",
        fieldSection: "hero",
        fieldSubsection: "",
        fieldName: "title",
        fieldId: "1:field:hero:title",
        originKey: "field:hero:title",
        sessionId: "session:stable",
      },
      "en",
      {
        reason: "future:identity:open-field",
        trigger: "scope-navigation",
      },
    );

    const stateSectionEn = getDocumentState(
      store,
      {
        pageId: "1",
        fieldScope: "section",
        fieldSection: "hero",
        fieldSubsection: "",
        fieldName: "hero",
        fieldId: "1:section::hero",
        originKey: "field:hero:title",
        sessionId: "session:stable",
      },
      "en",
      {
        reason: "future:identity:open-section",
        trigger: "scope-navigation",
      },
    );

    const stateFieldEs = getDocumentState(
      store,
      {
        pageId: "1",
        fieldScope: "field",
        fieldSection: "hero",
        fieldSubsection: "",
        fieldName: "title",
        fieldId: "1:field:hero:title",
        originKey: "field:hero:title",
        sessionId: "session:stable",
      },
      "es",
      {
        reason: "future:identity:open-es",
        trigger: "scope-navigation",
      },
    );

    expect(stateSectionEn).toBe(stateFieldEn);
    expect(stateFieldEn.id).toBe("session:stable|en");
    expect(stateFieldEs.id).toBe("session:stable|es");
    expect(listDocumentStates(store).length).toBe(2);
  });

  test("identity remains deterministic across rebind-like metadata changes", () => {
    const payload = {
      pageId: "1",
      fieldScope: "field",
      fieldSection: "hero",
      fieldSubsection: "",
      fieldName: "title",
      fieldId: "1:field:hero:title",
      originKey: "field:hero:title",
    };

    const envelopes = [
      resolveSessionIdentityEnvelope(payload, {
        activeSessionStateId: "session:stable",
        activePageId: "1",
        activeOriginFieldKey: "field:hero:title",
        preserveActiveOrigin: false,
      }),
      resolveSessionIdentityEnvelope(
        {
          ...payload,
          fieldScope: "section",
          fieldName: "hero",
          fieldId: "1:section::hero",
          rawOriginKey: "1:section::hero",
        },
        {
          activeSessionStateId: "session:stable",
          activePageId: "1",
          activeOriginFieldKey: "field:hero:title",
          preserveActiveOrigin: true,
        },
      ),
    ];

    const sessionIds = new Set(envelopes.map((entry) => entry.sessionStateId));
    const originKeys = new Set(envelopes.map((entry) => entry.originFieldKey));
    const hydrationKeys = new Set(
      envelopes.map((entry) =>
        buildTranslationHydrationKey({
          sessionStateId: entry.sessionStateId,
          originKey: entry.originFieldKey,
          pageId: entry.pageId,
          scope: "field",
          section: "hero",
          subsection: "",
          name: "title",
        }),
      ),
    );

    expect(sessionIds.size).toBe(1);
    expect(originKeys.size).toBe(1);
    expect(hydrationKeys.size).toBe(1);
    expect(Array.from(sessionIds)[0]).toBe("session:stable");
    expect(Array.from(originKeys)[0]).toBe("field:hero:title");
    expect(Array.from(hydrationKeys)[0]).toBe("session:stable");
  });
});
