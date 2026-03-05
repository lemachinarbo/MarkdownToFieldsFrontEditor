/** @jest-environment jsdom */

import {
  buildSemanticLookup,
  compileMountTargetsByKey,
} from "../src/sync-by-key.js";

function getMetaAttr(el, name) {
  return el.getAttribute(`data-mfe-${name}`) || "";
}

function createNodeFromSpec(spec) {
  const el = document.createElement("div");
  if (spec.className) el.className = spec.className;
  Object.entries(spec.attrs || {}).forEach(([key, value]) => {
    el.setAttribute(key, value);
  });
  return el;
}

function buildRootFromSpecs(specs) {
  const root = document.createElement("div");
  specs.forEach((spec) => {
    root.appendChild(createNodeFromSpec(spec));
  });
  return root;
}

describe("compile report ordering is deterministic", () => {
  test("report stays byte-identical across shuffled DOM order", () => {
    const specs = [
      { attrs: { "data-mfe": "hero" } },
      { attrs: { "data-mfe": "hero/cta" } },
      { attrs: { "data-mfe": "hero/title" } },
      { attrs: { "data-mfe": "hero/cta/title" } },
      { attrs: { "data-mfe": "hero/title" } },
      { attrs: { "data-mfe": "hero/unknown/path" } },
      { attrs: { "data-mfe-source": "hero/title" } },
      {
        className: "fe-editable",
        attrs: {
          "data-mfe-scope": "field",
          "data-mfe-section": "hero",
          "data-mfe-name": "title",
        },
      },
      {
        className: "fe-editable",
        attrs: {
          "data-mfe-scope": "subsection",
          "data-mfe-section": "hero",
          "data-mfe-name": "cta",
        },
      },
    ];

    const semanticLookup = buildSemanticLookup({
      sections: [{ name: "hero", subsections: [{ name: "cta" }] }],
      fields: [
        { section: "hero", name: "cta", subsection: "" },
        { section: "hero", name: "title", subsection: "" },
        { section: "hero", subsection: "cta", name: "title" },
      ],
    });
    const changedKeys = [
      "section:hero",
      "subsection:hero:cta",
      "field:hero:title",
      "subsection:hero:cta:title",
    ];

    const runCompile = (orderedSpecs) =>
      compileMountTargetsByKey({
        changedKeys,
        root: buildRootFromSpecs(orderedSpecs),
        getMetaAttr,
        semanticLookup,
      }).report;

    const first = runCompile(specs);
    const shuffled = runCompile(specs.slice().reverse());

    expect(JSON.stringify(first)).toBe(JSON.stringify(shuffled));
    expect(first.graphKeys).toEqual([
      "section:hero",
      "field:hero:title",
      "subsection:hero:cta:title",
    ]);
    expect(first.ambiguous).toEqual(["hero/cta -> subsection:hero:cta|field:hero:cta"]);
    expect(first.unresolved).toEqual(["hero/unknown/path"]);
  });
});
