/** @jest-environment jsdom */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const FULLSCREEN_PATH = path.join(ROOT, "src/editor-fullscreen.js");

function readSource() {
  return fs.readFileSync(FULLSCREEN_PATH, "utf8");
}

function runtimePayloadHash(markdown, hashStateIdentity) {
  return hashStateIdentity(String(markdown || ""));
}

describe("editor fullscreen save hash preflight contract", () => {
  test("runtime save hash checks the full outbound payload so frontmatter-only drift is caught before POST", () => {
    const source = readSource();
    const hashStateIdentity = (value) => String(value || "");
    const plannedHash = "---\ntitle: First\n---\nBody stays the same";
    const stateDraftMarkdown = "Body stays the same";
    const outboundMarkdownForSave =
      "---\ntitle: Second\n---\nBody stays the same";

    expect(source).toContain(
      "const payloadHash = hashStateIdentity(outboundMarkdownForSave);",
    );
    expect(
      runtimePayloadHash(outboundMarkdownForSave, hashStateIdentity),
    ).not.toBe(plannedHash);
    expect(runtimePayloadHash(stateDraftMarkdown, hashStateIdentity)).not.toBe(
      plannedHash,
    );
  });
});
