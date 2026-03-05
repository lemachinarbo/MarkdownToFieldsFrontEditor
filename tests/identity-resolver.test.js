/** @jest-environment jsdom */

import fs from "node:fs";
import path from "node:path";
import { buildSemanticLookup, scopedHtmlKeyFromMeta } from "../src/sync-by-key.js";
import {
  inferContextFromAncestors,
  parseDataMfe,
  resolveDataMfeCandidates,
  resolveDataMfeCandidatesWithContext,
  resolveDataMfeKeyWithContext,
} from "../src/identity-resolver.js";

const ROOT = path.resolve(process.cwd());

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("identity resolver", () => {
  test("scopedHtmlKeyFromMeta returns root key for document scope", () => {
    expect(scopedHtmlKeyFromMeta("document", "", "", "document")).toBe("");
    expect(scopedHtmlKeyFromMeta("document", "hero", "lead", "title")).toBe("");
  });

  test("parseDataMfe supports canonical and shorthand forms", () => {
    expect(parseDataMfe("field:hero/title")).toEqual({
      scope: "field",
      section: "hero",
      name: "title",
      subsection: "",
    });
    expect(parseDataMfe("section:hero")).toEqual({
      scope: "section",
      name: "hero",
      section: "",
    });
    expect(parseDataMfe("sub:hero/cta")).toEqual({
      scope: "subsection",
      section: "hero",
      name: "cta",
    });
    expect(parseDataMfe("hero/title")).toEqual({
      scope: "auto",
      section: "hero",
      name: "title",
      subsection: "",
    });
    expect(parseDataMfe("hero:cta")).toEqual({
      scope: "subsection",
      section: "hero",
      name: "cta",
    });
  });

  test("resolveDataMfeCandidates covers section/field/subsection mappings", () => {
    const lookup = buildSemanticLookup({
      sections: [{ name: "hero", subsections: [{ name: "cta" }] }],
      fields: [
        { name: "hero", section: "", subsection: "" },
        { name: "title", section: "hero", subsection: "" },
        { name: "cta", section: "hero", subsection: "" },
        { name: "title", section: "hero", subsection: "cta" },
      ],
    });

    expect(resolveDataMfeCandidates("section:hero", lookup)).toEqual([
      "section:hero",
    ]);
    expect(resolveDataMfeCandidates("field:hero/title", lookup)).toEqual([
      "field:hero:title",
    ]);
    expect(resolveDataMfeCandidates("subsection:hero/cta/title", lookup)).toEqual([
      "subsection:hero:cta:title",
    ]);
    expect(resolveDataMfeCandidates("hero", lookup)).toEqual([
      "section:hero",
      "field:hero",
    ]);
    expect(resolveDataMfeCandidates("hero/cta", lookup)).toEqual([
      "subsection:hero:cta",
      "field:hero:cta",
    ]);
    expect(resolveDataMfeCandidates("hero/cta/title", lookup)).toEqual([
      "subsection:hero:cta:title",
    ]);
  });

  test("context fallback resolves field/subsection keys from ancestors", () => {
    const lookup = buildSemanticLookup({
      sections: [{ name: "hero", subsections: [{ name: "cta" }] }],
      fields: [
        { name: "title", section: "hero", subsection: "" },
        { name: "title", section: "hero", subsection: "cta" },
      ],
    });

    const sectionHost = document.createElement("div");
    sectionHost.setAttribute("data-mfe", "section:hero");
    const sectionChild = document.createElement("span");
    sectionHost.appendChild(sectionChild);

    expect(inferContextFromAncestors(sectionChild, lookup)).toEqual({
      section: "hero",
      subsection: "",
    });
    expect(
      resolveDataMfeCandidatesWithContext("title", sectionChild, lookup),
    ).toEqual(["field:hero:title"]);
    expect(resolveDataMfeKeyWithContext("title", sectionChild, lookup)).toBe(
      "field:hero:title",
    );

    const subHost = document.createElement("div");
    subHost.setAttribute("data-mfe", "subsection:hero/cta");
    const subChild = document.createElement("span");
    subHost.appendChild(subChild);

    expect(inferContextFromAncestors(subChild, lookup)).toEqual({
      section: "hero",
      subsection: "cta",
    });
    expect(resolveDataMfeCandidatesWithContext("title", subChild, lookup)).toEqual([
      "subsection:hero:cta:title",
      "field:hero:title",
    ]);
    expect(resolveDataMfeKeyWithContext("title", subChild, lookup)).toBe("");
  });

  test("smoke: identity helpers are defined only in identity-resolver", () => {
    const helperNames = [
      "parseDataMfe",
      "resolveDataMfeCandidates",
      "inferContextFromAncestors",
      "resolveDataMfeCandidatesWithContext",
      "resolveDataMfeKeyWithContext",
    ];

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

    const ownerPath = path.join(srcRoot, "identity-resolver.js");
    helperNames.forEach((name) => {
      const matcher = new RegExp(`function\\s+${name}\\s*\\(`);
      jsFiles.forEach((filePath) => {
        const source = fs.readFileSync(filePath, "utf8");
        const hasDefinition = matcher.test(source);
        if (filePath === ownerPath) {
          expect(hasDefinition).toBe(true);
        } else {
          expect(hasDefinition).toBe(false);
        }
      });
    });

    const syncByKeySource = readSource("src/sync-by-key.js");
    expect(syncByKeySource.includes("from \"./identity-resolver.js\"")).toBe(
      true,
    );
  });
});
