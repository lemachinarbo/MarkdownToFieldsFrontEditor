import {
  CANONICAL_SCOPES,
  CANONICAL_SCOPE_SET,
  assertCanonicalStateShape,
  assertCanonicalPayloadSchema,
} from "../src/canonical-contract.js";

describe("canonical contract", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = global.window;
    global.window = global.window || {};
  });

  afterEach(() => {
    global.window = originalWindow;
    jest.restoreAllMocks();
  });

  test("exports canonical scopes and scope set", () => {
    expect(CANONICAL_SCOPES).toEqual([
      "document",
      "section",
      "subsection",
      "field",
    ]);
    expect(CANONICAL_SCOPE_SET.has("document")).toBe(true);
    expect(CANONICAL_SCOPE_SET.has("field")).toBe(true);
    expect(CANONICAL_SCOPE_SET.has("unknown")).toBe(false);
  });

  describe("assertCanonicalStateShape", () => {
    test("accepts full canonical state", () => {
      expect(() =>
        assertCanonicalStateShape({
          markdown: "# doc",
          applied: [],
        }),
      ).not.toThrow();
    });

    test("throws when state is missing", () => {
      expect(() => assertCanonicalStateShape(null, "state:missing")).toThrow(
        /invalid state \(state:missing\)/,
      );
    });

    test("throws when markdown is not string", () => {
      expect(() =>
        assertCanonicalStateShape({ markdown: 123, applied: [] }, "state:type"),
      ).toThrow(/markdown must be string \(state:type\)/);
    });

    test("throws when applied is missing in strict mode", () => {
      expect(() =>
        assertCanonicalStateShape({ markdown: "# doc" }, "state:applied"),
      ).toThrow(/applied must be array \(state:applied\)/);
    });

    test("debugAssert emits console error and still throws", () => {
      global.window.MarkdownFrontEditorConfig = { debugAssert: true };
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() =>
        assertCanonicalStateShape({ markdown: "# doc" }, "state:debug"),
      ).toThrow(/applied must be array \(state:debug\)/);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe("[mfe] canonical assert");
    });

    test("tracer ring overwrites oldest entry at cap", () => {
      global.window.MarkdownFrontEditorConfig = { debugAssert: true };
      jest.spyOn(console, "error").mockImplementation(() => {});

      for (let i = 0; i < 52; i += 1) {
        try {
          assertCanonicalStateShape({ markdown: "# doc" }, `state:ring:${i}`);
        } catch (_e) {
          // expected invariant throw
        }
      }

      const trace = global.window.__MFE_CONTRACT_VIOLATIONS__;
      expect(trace).toBeTruthy();
      expect(trace.cap).toBe(50);
      expect(trace.count).toBe(50);

      const cap = trace.cap;
      const start = (trace.cursor - trace.count + cap) % cap;
      const ordered = [];
      for (let i = 0; i < trace.count; i += 1) {
        ordered.push(trace.entries[(start + i) % cap]);
      }

      expect(ordered[0].context).toBe("state:ring:2");
      expect(ordered[ordered.length - 1].context).toBe("state:ring:51");
    });
  });

  describe("assertCanonicalPayloadSchema", () => {
    function createPayload(overrides = {}) {
      return {
        element: {},
        markdownContent: "# field",
        fieldScope: "field",
        fieldName: "title",
        fieldSection: "hero",
        fieldSubsection: "",
        pageId: "123",
        canonicalHydrated: true,
        ...overrides,
      };
    }

    test("accepts valid field payload", () => {
      expect(() =>
        assertCanonicalPayloadSchema(createPayload(), "payload:field"),
      ).not.toThrow();
    });

    test("accepts valid document payload without fieldName", () => {
      expect(() =>
        assertCanonicalPayloadSchema(
          createPayload({ fieldScope: "document", fieldName: "" }),
          "payload:document",
        ),
      ).not.toThrow();
    });

    test("throws on missing payload", () => {
      expect(() =>
        assertCanonicalPayloadSchema(null, "payload:missing"),
      ).toThrow(/missing payload \(payload:missing\)/);
    });

    test("throws on missing canonicalHydrated", () => {
      expect(() =>
        assertCanonicalPayloadSchema(
          createPayload({ canonicalHydrated: false }),
          "payload:hydrated",
        ),
      ).toThrow(/canonicalHydrated required \(payload:hydrated\)/);
    });

    test("throws on invalid scope", () => {
      expect(() =>
        assertCanonicalPayloadSchema(
          createPayload({ fieldScope: "invalid" }),
          "payload:scope",
        ),
      ).toThrow(/invalid scope "invalid" \(payload:scope\)/);
    });

    test("throws on missing fieldName for non-document scope", () => {
      expect(() =>
        assertCanonicalPayloadSchema(
          createPayload({ fieldScope: "field", fieldName: "" }),
          "payload:name",
        ),
      ).toThrow(/fieldName required \(payload:name\)/);
    });

    test("throws on missing pageId", () => {
      expect(() =>
        assertCanonicalPayloadSchema(
          createPayload({ pageId: "" }),
          "payload:page",
        ),
      ).toThrow(/pageId required \(payload:page\)/);
    });

    test("localStorage toggle emits console error and still throws", () => {
      global.window.MarkdownFrontEditorConfig = {};
      global.window.localStorage = {
        getItem(key) {
          return key === "mfeDebugAssert" ? "1" : null;
        },
      };
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() =>
        assertCanonicalPayloadSchema(
          createPayload({ fieldScope: "invalid" }),
          "payload:debug-toggle",
        ),
      ).toThrow(/invalid scope "invalid" \(payload:debug-toggle\)/);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe("[mfe] canonical assert");
    });
  });
});
