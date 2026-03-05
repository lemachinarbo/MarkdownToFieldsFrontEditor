import {
  selectEditableBoundaries,
  validateEditableBoundaries,
} from "../src/canonical-boundary-selection.js";

describe("canonical boundary selection", () => {
  test("falls back to deterministic when runtime boundaries diverge strongly", () => {
    const result = selectEditableBoundaries({
      runtimeBoundaries: [0, 182, 183],
      deterministicBoundaries: [0, 1, 24],
      displayLength: 183,
      protectedSpanCount: 3,
      runtimeTrusted: true,
      divergenceThreshold: 5,
    });
    expect(result.selectedBoundaries).toEqual([0, 1, 24]);
    expect(result.selectedBoundarySource).toBe(
      "deterministic-recompute:runtime-diverged",
    );
    expect(result.runtimeChecks.ok).toBe(true);
    expect(result.deterministicChecks.ok).toBe(true);
  });

  test("uses runtime boundaries when trusted and near deterministic", () => {
    const result = selectEditableBoundaries({
      runtimeBoundaries: [0, 1, 24],
      deterministicBoundaries: [0, 1, 23],
      displayLength: 183,
      protectedSpanCount: 3,
      runtimeTrusted: true,
      divergenceThreshold: 5,
    });
    expect(result.selectedBoundaries).toEqual([0, 1, 24]);
    expect(result.selectedBoundarySource).toBe("runtime-projection");
  });

  test("two-save scenario keeps valid boundaries across edits", () => {
    const firstSave = selectEditableBoundaries({
      runtimeBoundaries: [0, 1, 24],
      deterministicBoundaries: [0, 1, 23],
      displayLength: 183,
      protectedSpanCount: 3,
      runtimeTrusted: true,
      divergenceThreshold: 5,
    });
    expect(firstSave.selectedBoundaries).toEqual([0, 1, 24]);

    const secondSave = selectEditableBoundaries({
      runtimeBoundaries: [0, 182, 183],
      deterministicBoundaries: [0, 1, 24],
      displayLength: 184,
      protectedSpanCount: 3,
      runtimeTrusted: true,
      divergenceThreshold: 5,
    });
    expect(secondSave.selectedBoundaries).toEqual([0, 1, 24]);
    expect(secondSave.selectedBoundarySource).toContain("deterministic-recompute");
    expect(
      validateEditableBoundaries(secondSave.selectedBoundaries, 184, 3).ok,
    ).toBe(true);
  });
});
