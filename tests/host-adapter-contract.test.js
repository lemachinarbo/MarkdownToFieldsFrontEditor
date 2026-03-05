import fs from "node:fs";
import path from "node:path";
import {
  __resetHostEnvForTests,
  ensureHostConfigObject,
  getHostApi,
  getHostConfig,
  getHostWindow,
  initHostEnv,
  isHostFlagEnabled,
} from "../src/host-env.js";

const ROOT = path.resolve(process.cwd());

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Host adapter contract", () => {
  afterEach(() => {
    __resetHostEnvForTests();
    delete global.window;
  });

  test("throws when runtime window is unavailable", () => {
    expect(() => getHostWindow()).toThrow(
      "[mfe] host runtime window is unavailable.",
    );
  });

  test("throws when required host API is missing", () => {
    global.window = {};
    expect(() =>
      getHostApi("MarkdownFrontEditor", ["openForElementFromCanonical"]),
    ).toThrow('[mfe] host API "MarkdownFrontEditor" is unavailable.');
  });

  test("throws when host config is mutated to a non-object", () => {
    global.window = {
      MarkdownFrontEditorConfig: "broken",
    };
    expect(() => getHostConfig()).toThrow(
      "[mfe] host config MarkdownFrontEditorConfig is invalid.",
    );
    expect(() => isHostFlagEnabled("debug")).toThrow(
      "[mfe] host config MarkdownFrontEditorConfig is invalid.",
    );
  });

  test("ensures config object exists and stays mutable object", () => {
    global.window = {};
    const cfg = ensureHostConfigObject();
    expect(cfg).toEqual({});
    cfg.debug = true;
    expect(isHostFlagEnabled("debug")).toBe(true);
  });

  test("host env flags are snapshotted once per runtime", () => {
    global.window = {
      __MFE_DEV: true,
      localStorage: {
        getItem: jest.fn((key) => (key === "mfeDebugLabels" ? "1" : null)),
      },
      MarkdownFrontEditorConfig: {
        debug: false,
        debugAssert: false,
      },
    };

    const first = initHostEnv();
    global.window.__MFE_DEV = false;
    global.window.MarkdownFrontEditorConfig.debug = true;
    const second = initHostEnv();

    expect(first).toBe(second);
    expect(first.devMode).toBe(true);
    expect(first.debug).toBe(false);
    expect(first.debugLabels).toBe(true);
  });

  test("router/editor boundary files avoid direct window reads", () => {
    const hostRouter = readSource("src/host-router.js");
    const sharedHelpers = readSource("src/editor-shared-helpers.js");
    const canonicalContract = readSource("src/canonical-contract.js");

    expect(hostRouter.includes("window.")).toBe(false);
    expect(sharedHelpers.includes("window.")).toBe(false);
    expect(canonicalContract.includes("window.")).toBe(false);
  });

  test("env debug flags are only read via host-env boundary", () => {
    const srcRoot = path.join(ROOT, "src");
    const stack = [srcRoot];
    const jsFiles = [];

    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      entries.forEach((entry) => {
        const nextPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(nextPath);
          return;
        }
        if (entry.isFile() && nextPath.endsWith(".js")) {
          jsFiles.push(nextPath);
        }
      });
    }

    jsFiles.forEach((filePath) => {
      if (filePath.endsWith(path.join("src", "host-env.js"))) return;
      const source = fs.readFileSync(filePath, "utf8");
      expect(source.includes("window.__MFE_DEV")).toBe(false);
      expect(source.includes("localStorage")).toBe(false);
    });
  });
});
