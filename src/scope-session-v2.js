import { buildScopeKeyFromMeta, normalizeScopeKind } from "./scope-slice.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function freezeScopeMeta(scopeMeta = {}) {
  const normalizedScopeKind = normalizeScopeKind(scopeMeta.scopeKind || "field");
  return Object.freeze({
    scopeKind: normalizedScopeKind,
    section: normalizeText(scopeMeta.section),
    subsection: normalizeText(scopeMeta.subsection),
    name: normalizeText(scopeMeta.name),
  });
}

function buildScopeSessionScopeKey(scopeMeta = {}) {
  return buildScopeKeyFromMeta(scopeMeta);
}

export function createScopeSession(params = {}) {
  const stateId = normalizeText(params.stateId);
  if (!stateId) {
    throw new Error("[mfe] scope-session-v2: stateId is required");
  }
  const scopeMeta = freezeScopeMeta(params.scopeMeta || {});
  const scopeKey = buildScopeSessionScopeKey(scopeMeta);
  if (!scopeKey) {
    throw new Error("[mfe] scope-session-v2: unable to resolve scope key");
  }
  return Object.freeze({
    stateId,
    lang: normalizeText(params.lang),
    originKey: normalizeText(params.originKey),
    openedFrom: normalizeText(params.openedFrom || "unknown"),
    openedAt: Number.isFinite(Number(params.openedAt))
      ? Number(params.openedAt)
      : Date.now(),
    scopeMeta,
    scopeKey,
  });
}

export function doesScopeSessionMatch(session, scopeMeta = {}) {
  if (!session || typeof session !== "object") return false;
  const expected = buildScopeSessionScopeKey(scopeMeta);
  if (!expected) return false;
  return String(session.scopeKey || "") === expected;
}
