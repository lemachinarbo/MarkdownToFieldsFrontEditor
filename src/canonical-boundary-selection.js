export function validateEditableBoundaries(boundaries, displayLength, protectedSpanCount) {
  const values = Array.isArray(boundaries) ? boundaries : [];
  const isIntegerArray = values.every((value) => Number.isInteger(Number(value)));
  const isStrictlyIncreasing = values.every((value, index, arr) =>
    index === 0 ? true : Number(value) > Number(arr[index - 1]),
  );
  const withinDisplayRange = values.every(
    (value) => Number(value) >= 0 && Number(value) <= Number(displayLength || 0),
  );
  const boundariesMatchProtectedCount =
    values.length === Number(protectedSpanCount || 0);
  return {
    isIntegerArray,
    isStrictlyIncreasing,
    withinDisplayRange,
    boundariesMatchProtectedCount,
    ok:
      isIntegerArray &&
      isStrictlyIncreasing &&
      withinDisplayRange &&
      boundariesMatchProtectedCount,
  };
}

function maxBoundaryAbsDelta(runtimeBoundaries, deterministicBoundaries) {
  const runtime = Array.isArray(runtimeBoundaries) ? runtimeBoundaries : [];
  const deterministic = Array.isArray(deterministicBoundaries)
    ? deterministicBoundaries
    : [];
  if (!runtime.length || runtime.length !== deterministic.length) return Number.POSITIVE_INFINITY;
  let maxDelta = 0;
  for (let index = 0; index < runtime.length; index += 1) {
    const delta = Math.abs(Number(runtime[index] || 0) - Number(deterministic[index] || 0));
    if (delta > maxDelta) maxDelta = delta;
  }
  return maxDelta;
}

export function selectEditableBoundaries({
  runtimeBoundaries,
  deterministicBoundaries,
  displayLength,
  protectedSpanCount,
  runtimeTrusted,
  divergenceThreshold = 0,
}) {
  const runtimeChecks = validateEditableBoundaries(
    runtimeBoundaries,
    displayLength,
    protectedSpanCount,
  );
  const deterministicChecks = validateEditableBoundaries(
    deterministicBoundaries,
    displayLength,
    protectedSpanCount,
  );
  const maxAbsDelta = maxBoundaryAbsDelta(runtimeBoundaries, deterministicBoundaries);
  const runtimeWithinThreshold = Number.isFinite(maxAbsDelta)
    ? maxAbsDelta <= Number(divergenceThreshold || 0)
    : false;
  const useRuntime =
    Array.isArray(runtimeBoundaries) &&
    runtimeBoundaries.length > 0 &&
    runtimeChecks.ok &&
    Boolean(runtimeTrusted) &&
    runtimeWithinThreshold;
  return {
    selectedBoundaries: useRuntime ? runtimeBoundaries : deterministicBoundaries,
    selectedBoundarySource: useRuntime
      ? "runtime-projection"
      : runtimeChecks.ok && !runtimeWithinThreshold
        ? "deterministic-recompute:runtime-diverged"
        : runtimeChecks.ok && !runtimeTrusted
          ? "deterministic-recompute:runtime-untrusted"
          : "deterministic-recompute",
    runtimeChecks,
    deterministicChecks,
    runtimeWithinThreshold,
    maxAbsDelta: Number.isFinite(maxAbsDelta) ? maxAbsDelta : -1,
  };
}
