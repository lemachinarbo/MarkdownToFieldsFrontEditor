import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());

describe("async scheduling contract", () => {
  test("runtime source avoids setTimeout(..., 0) and legacy writerLock", () => {
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

    const zeroTimeoutPattern = /setTimeout\s*\([\s\S]*?,\s*0\s*\)/;
    jsFiles.forEach((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      expect(zeroTimeoutPattern.test(source)).toBe(false);
    });

    const hostRouterSource = fs.readFileSync(
      path.join(srcRoot, "host-router.js"),
      "utf8",
    );
    expect(hostRouterSource.includes("writerLock")).toBe(false);
    expect(hostRouterSource.includes('withLock("host-router:writer"')).toBe(
      true,
    );
  });
});
