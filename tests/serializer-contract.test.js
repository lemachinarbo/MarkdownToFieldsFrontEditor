import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());

describe("serializer contract", () => {
  test("MarkdownSerializer construction exists only in editor-core factory", () => {
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

        const source = fs.readFileSync(nextPath, "utf8");
        if (source.includes("new MarkdownSerializer(")) {
          const isCore = nextPath === path.join(srcRoot, "editor-core.js");
          if (!isCore) {
            offenders.push(path.relative(ROOT, nextPath));
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
