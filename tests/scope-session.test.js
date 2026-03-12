import {
  createScopeSession,
  doesScopeSessionMatch,
} from "../src/scope-session.js";
describe("scope-session", () => {
  test("creates immutable session with stable scope key", () => {
    const session = createScopeSession({
      stateId: "state-1|en",
      lang: "en",
      originKey: "field:hero:title",
      scopeMeta: {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
      },
    });

    expect(Object.isFrozen(session)).toBe(true);
    expect(session.scopeKey).toBe("field:hero:title");
    expect(
      doesScopeSessionMatch(session, {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
      }),
    ).toBe(true);
  });

  test("detects scope mismatch between locked session and attempted save scope", () => {
    const session = createScopeSession({
      stateId: "state-1|en",
      lang: "en",
      scopeMeta: {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "intro",
      },
    });

    expect(
      doesScopeSessionMatch(session, {
        scopeKind: "field",
        section: "hero",
        subsection: "",
        name: "title",
      }),
    ).toBe(false);
  });
});
