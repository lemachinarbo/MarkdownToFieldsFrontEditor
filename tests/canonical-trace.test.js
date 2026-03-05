import { assertCanonicalStateShape } from "../src/canonical-contract.js";

describe("canonical trace sanitization", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = global.window;
    global.window = global.window || {};
    delete global.window.__MFE_CONTRACT_VIOLATIONS__;
  });

  afterEach(() => {
    global.window = originalWindow;
    jest.restoreAllMocks();
  });

  test("trace entries never include runtime timestamp keys", () => {
    global.window.MarkdownFrontEditorConfig = { debugAssert: true };
    jest.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 3; i += 1) {
      try {
        assertCanonicalStateShape({ markdown: "# doc" }, `trace:${i}`);
      } catch (_e) {
        // expected invariant throw
      }
    }

    const trace = global.window.__MFE_CONTRACT_VIOLATIONS__;
    expect(trace).toBeTruthy();
    expect(trace.count).toBeGreaterThan(0);

    const entries = trace.entries.filter(Boolean);
    entries.forEach((entry) => {
      expect(Object.prototype.hasOwnProperty.call(entry, "ts")).toBe(false);
    });
  });
});
