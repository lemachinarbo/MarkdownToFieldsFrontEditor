import { buildProtectedSpanFingerprint } from "./canonical-scope-session.js";
import { buildScopeKeyFromMeta, normalizeScopeKind } from "./scope-slice.js";

function normalizeText(value) {
  return String(value || "");
}

function normalizeScopeMeta(scopeMeta = {}) {
  return {
    scopeKind: normalizeScopeKind(scopeMeta.scopeKind || "field"),
    section: normalizeText(scopeMeta.section),
    subsection: normalizeText(scopeMeta.subsection),
    name: normalizeText(scopeMeta.name),
  };
}

function normalizeProjectionMeta(projection) {
  const payload = projection && typeof projection === "object" ? projection : {};
  return payload.projectionMeta && typeof payload.projectionMeta === "object"
    ? payload.projectionMeta
    : {};
}

function resolveScopeAuthority(params = {}, options = {}) {
  const rawScopeMeta =
    params.scopeMeta && typeof params.scopeMeta === "object"
      ? params.scopeMeta
      : {};
  const explicitScopeKind = rawScopeMeta.scopeKind
    ? normalizeScopeKind(rawScopeMeta.scopeKind)
    : "";
  const incomingScopeKind = params.incomingScopeKind
    ? normalizeScopeKind(params.incomingScopeKind)
    : "";
  const fallbackScopeKind = params.fallbackScopeKind
    ? normalizeScopeKind(params.fallbackScopeKind)
    : "";
  const allowFallbackScope = Boolean(options.allowFallbackScope);
  const requireExplicitScope = Boolean(
    options.requireExplicitScope || params.requireExplicitScope,
  );

  if (requireExplicitScope && !explicitScopeKind) {
    return {
      ok: false,
      reason: "missing-explicit-scope-meta",
      currentScopeKind: "",
      incomingScopeKind,
      scopeMeta: null,
    };
  }

  if (
    explicitScopeKind &&
    incomingScopeKind &&
    incomingScopeKind !== explicitScopeKind
  ) {
    return {
      ok: false,
      reason: "incoming-scope-mismatch",
      currentScopeKind: explicitScopeKind,
      incomingScopeKind,
      scopeMeta: normalizeScopeMeta(rawScopeMeta),
    };
  }

  const currentScopeKind =
    explicitScopeKind || (allowFallbackScope ? fallbackScopeKind : "");
  if (!currentScopeKind) {
    return {
      ok: false,
      reason: "missing-scope-kind",
      currentScopeKind: "",
      incomingScopeKind,
      scopeMeta: null,
    };
  }

  return {
    ok: true,
    reason: "ok",
    currentScopeKind,
    incomingScopeKind: incomingScopeKind || currentScopeKind,
    scopeMeta: normalizeScopeMeta({
      ...rawScopeMeta,
      scopeKind: currentScopeKind,
    }),
    usedFallbackScope: !explicitScopeKind,
  };
}

/**
 * Resolve scope authority for the fullscreen reference pipeline.
 * Reference callers must provide explicit scope and cannot fall back to ambient state.
 */
export function resolveReferenceScopeAuthorityForMutation(params = {}) {
  return resolveScopeAuthority(params, {
    allowFallbackScope: false,
    requireExplicitScope: true,
  });
}

/**
 * Resolve scope authority for non-reference callers that still allow fallback scope.
 * This exists only for compatibility outside the fullscreen reference pipeline.
 */
export function resolveNonReferenceScopeAuthorityForMutation(params = {}) {
  return resolveScopeAuthority(params, {
    allowFallbackScope: true,
    requireExplicitScope: Boolean(params.requireExplicitScope),
  });
}

/**
 * Legacy-compatible alias for non-reference callers.
 * New fullscreen/reference code should use resolveReferenceScopeAuthorityForMutation().
 */
export function resolveScopeAuthorityForMutation(params = {}) {
  return resolveNonReferenceScopeAuthorityForMutation(params);
}

/**
 * Build the explicit scope context used by mutation and save code.
 * This context is stable for a given state+scope and never depends on UI breadcrumbs.
 */
export function buildScopeMutationContext(params = {}) {
  const scopeMeta = normalizeScopeMeta(params.scopeMeta || params);
  const protectedSpans = Array.isArray(params.protectedSpans)
    ? params.protectedSpans
    : [];
  return Object.freeze({
    stateId: normalizeText(params.stateId),
    lang: normalizeText(params.lang),
    scopeKind: scopeMeta.scopeKind,
    section: scopeMeta.section,
    subsection: scopeMeta.subsection,
    name: scopeMeta.name,
    scopeKey: normalizeText(params.scopeKey || buildScopeKeyFromMeta(scopeMeta)),
    structuralFingerprint: normalizeText(
      params.structuralFingerprint ||
        buildProtectedSpanFingerprint(protectedSpans),
    ),
  });
}

/**
 * Stamp a runtime projection with identity metadata.
 * The stamped metadata is safe to transport through plugin mapping and scope validation.
 */
export function stampRuntimeProjectionIdentity(projection, params = {}) {
  const payload =
    projection && typeof projection === "object" ? projection : {};
  const meta = normalizeProjectionMeta(payload);
  const protectedSpans = Array.isArray(params.protectedSpans)
    ? params.protectedSpans
    : Array.isArray(payload.protectedSpans)
      ? payload.protectedSpans
      : [];
  const protectedSpanCount = Number.isFinite(Number(params.protectedSpanCount))
    ? Number(params.protectedSpanCount)
    : Number.isFinite(Number(meta.protectedSpanCount))
      ? Number(meta.protectedSpanCount)
      : protectedSpans.length;
  const protectedSpanFingerprint = normalizeText(
    params.protectedSpanFingerprint ||
      params.structuralFingerprint ||
      meta.protectedSpanFingerprint ||
      buildProtectedSpanFingerprint(protectedSpans),
  );
  const scopeMeta = normalizeScopeMeta(params.scopeMeta || {});
  const scopeKey = normalizeText(
    params.scopeKey || meta.scopeKey || buildScopeKeyFromMeta(scopeMeta),
  );
  const stateId = normalizeText(params.stateId || meta.stateId);

  return {
    ...payload,
    projectionMeta: {
      ...meta,
      stateId,
      scopeKey,
      protectedSpanCount,
      protectedSpanFingerprint,
    },
  };
}

/**
 * Validate that a runtime projection belongs to the current state and scope.
 * Runtime projection is disposable, so validation failure must not be tolerated as authority.
 */
export function validateRuntimeProjectionForScopeContext(params = {}) {
  const runtimeProjection =
    params.runtimeProjection && typeof params.runtimeProjection === "object"
      ? params.runtimeProjection
      : null;
  const expectedContext = buildScopeMutationContext(params);
  if (!runtimeProjection) {
    return {
      ok: false,
      reason: "missing-projection",
      expectedContext,
      actualContext: null,
      runtimeProjection: null,
    };
  }

  const stampedProjection = stampRuntimeProjectionIdentity(runtimeProjection, {
    stateId: normalizeProjectionMeta(runtimeProjection).stateId,
    scopeKey: normalizeProjectionMeta(runtimeProjection).scopeKey,
    protectedSpans: Array.isArray(runtimeProjection.protectedSpans)
      ? runtimeProjection.protectedSpans
      : [],
    protectedSpanCount: normalizeProjectionMeta(runtimeProjection)
      .protectedSpanCount,
    protectedSpanFingerprint: normalizeProjectionMeta(runtimeProjection)
      .protectedSpanFingerprint,
  });
  const actualMeta = normalizeProjectionMeta(stampedProjection);
  const actualContext = {
    stateId: normalizeText(actualMeta.stateId),
    scopeKey: normalizeText(actualMeta.scopeKey),
    protectedSpanCount: Number(actualMeta.protectedSpanCount || 0),
    structuralFingerprint: normalizeText(actualMeta.protectedSpanFingerprint),
  };
  const expectedCount = Array.isArray(params.protectedSpans)
    ? params.protectedSpans.length
    : Number(params.protectedSpanCount || 0);

  if (!actualContext.stateId) {
    return {
      ok: false,
      reason: "missing-state-id",
      expectedContext,
      actualContext,
      runtimeProjection: stampedProjection,
    };
  }
  if (actualContext.stateId !== expectedContext.stateId) {
    return {
      ok: false,
      reason: "state-id-mismatch",
      expectedContext,
      actualContext,
      runtimeProjection: stampedProjection,
    };
  }
  if (!actualContext.scopeKey) {
    return {
      ok: false,
      reason: "missing-scope-key",
      expectedContext,
      actualContext,
      runtimeProjection: stampedProjection,
    };
  }
  if (actualContext.scopeKey !== expectedContext.scopeKey) {
    return {
      ok: false,
      reason: "scope-key-mismatch",
      expectedContext,
      actualContext,
      runtimeProjection: stampedProjection,
    };
  }
  if (actualContext.protectedSpanCount !== expectedCount) {
    return {
      ok: false,
      reason: "protected-span-count-mismatch",
      expectedContext,
      actualContext,
      runtimeProjection: stampedProjection,
    };
  }
  if (
    actualContext.structuralFingerprint !== expectedContext.structuralFingerprint
  ) {
    return {
      ok: false,
      reason: "protected-span-fingerprint-mismatch",
      expectedContext,
      actualContext,
      runtimeProjection: stampedProjection,
    };
  }

  return {
    ok: true,
    reason: "ok",
    expectedContext,
    actualContext,
    runtimeProjection: stampedProjection,
  };
}
