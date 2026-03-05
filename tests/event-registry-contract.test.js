import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());

describe("event registry contract", () => {
  test("no runtime file declares global let *Handler listener anchors", () => {
    const srcRoot = path.join(ROOT, "src");
    const stack = [srcRoot];
    const offenders = [];

    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      entries.forEach((entry) => {
        const nextPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(nextPath);
          return;
        }
        if (!entry.isFile() || !nextPath.endsWith(".js")) {
          return;
        }
        if (nextPath.endsWith(path.join("src", "event-registry.js"))) {
          return;
        }

        const source = fs.readFileSync(nextPath, "utf8");
        const hasGlobalHandlerVar = /^\s*let\s+[A-Za-z0-9_]*Handler\b/m.test(
          source,
        );
        if (hasGlobalHandlerVar) {
          offenders.push(path.relative(ROOT, nextPath));
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  test("raw add/removeEventListener calls exist only in event-registry", () => {
    const srcRoot = path.join(ROOT, "src");
    const stack = [srcRoot];
    const offenders = [];
    const owner = path.join(srcRoot, "event-registry.js");

    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      entries.forEach((entry) => {
        const nextPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(nextPath);
          return;
        }
        if (!entry.isFile() || !nextPath.endsWith(".js")) {
          return;
        }

        if (nextPath === owner) {
          return;
        }

        const source = fs.readFileSync(nextPath, "utf8");
        if (
          source.includes("addEventListener(") ||
          source.includes("removeEventListener(")
        ) {
          offenders.push(path.relative(ROOT, nextPath));
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
