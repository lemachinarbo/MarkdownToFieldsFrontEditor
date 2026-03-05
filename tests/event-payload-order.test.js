import { buildFragmentStaleScopeEventDetail } from "../src/fragment-stale-scope-event.js";

describe("fragment stale-scope event payload ordering", () => {
  test("staleScopeKeys and missingKeys are canonically sorted", () => {
    const detail = buildFragmentStaleScopeEventDetail({
      cycleId: 17,
      requestedKeys: [
        "subsection:hero:cta:title",
        "section:hero",
        "field:hero:title",
        "subsection:hero:cta",
      ],
      missingKeys: [
        "subsection:hero:cta:title",
        "field:hero:title",
        "field:hero:title",
      ],
    });

    expect(detail).toEqual({
      cycleId: 17,
      staleScopeKeys: ["section:hero", "subsection:hero:cta"],
      missingKeys: ["field:hero:title", "subsection:hero:cta:title"],
    });
  });

  test("payload is byte-identical across different insertion orders", () => {
    const a = buildFragmentStaleScopeEventDetail({
      cycleId: 31,
      requestedKeys: [
        "subsection:hero:cta:title",
        "field:hero:title",
        "subsection:hero:cta",
        "section:hero",
      ],
      missingKeys: ["subsection:hero:cta:title", "field:hero:title"],
    });
    const b = buildFragmentStaleScopeEventDetail({
      cycleId: 31,
      requestedKeys: [
        "section:hero",
        "subsection:hero:cta",
        "field:hero:title",
        "subsection:hero:cta:title",
      ],
      missingKeys: ["field:hero:title", "subsection:hero:cta:title"],
    });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
