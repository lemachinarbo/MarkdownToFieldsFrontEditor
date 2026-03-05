import { detectCanonicalScopedKeyOrderViolation } from "../src/sync-by-key.js";

describe("save response htmlMap order detection", () => {
  test("detects shuffled htmlMap keys from save response", () => {
    const saveResponse = {
      htmlMap: {
        "subsection:hero:cta:title": "<h3>A</h3>",
        "section:hero": "<section>...</section>",
        "subsection:hero:cta": "<div>...</div>",
        "field:hero:title": "<h2>Title</h2>",
      },
    };

    const violation = detectCanonicalScopedKeyOrderViolation(
      Object.keys(saveResponse.htmlMap),
    );

    expect(violation).not.toBeNull();
    expect(violation.actual).toEqual([
      "subsection:hero:cta:title",
      "section:hero",
      "subsection:hero:cta",
      "field:hero:title",
    ]);
    expect(violation.expected).toEqual([
      "section:hero",
      "subsection:hero:cta",
      "field:hero:title",
      "subsection:hero:cta:title",
    ]);
  });

  test("accepts canonical htmlMap key order from save response", () => {
    const saveResponse = {
      htmlMap: {
        "section:hero": "<section>...</section>",
        "subsection:hero:cta": "<div>...</div>",
        "field:hero:title": "<h2>Title</h2>",
        "subsection:hero:cta:title": "<h3>A</h3>",
      },
    };

    const violation = detectCanonicalScopedKeyOrderViolation(
      Object.keys(saveResponse.htmlMap),
    );

    expect(violation).toBeNull();
  });
});
