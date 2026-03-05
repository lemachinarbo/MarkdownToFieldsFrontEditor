import { assertCanonicalPreviewSnapshot } from "../src/canonical-contract.js";

describe("preview canonical assert", () => {
  test("throws in dev when snapshot markdown is missing", () => {
    expect(() =>
      assertCanonicalPreviewSnapshot({ canonicalHydrated: true }, true),
    ).toThrow(/synthetic preview requires canonical-hydrated snapshot/);
  });
});
