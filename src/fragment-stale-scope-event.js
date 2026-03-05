import { compareCanonicalScopedKeys } from "./sync-by-key.js";

function isDescendantScopedKey(child, parent) {
  if (!child || !parent || child === parent) return false;
  if (parent.startsWith("section:")) {
    const section = parent.slice("section:".length);
    return (
      child.startsWith(`field:${section}:`) ||
      child.startsWith(`subsection:${section}:`)
    );
  }
  if (parent.startsWith("subsection:")) {
    const parts = parent.split(":");
    if (parts.length === 3) return child.startsWith(`${parent}:`);
  }
  return false;
}

function isScopeOrDescendantScopedKey(key, scopeKey) {
  if (!key || !scopeKey) return false;
  return key === scopeKey || isDescendantScopedKey(key, scopeKey);
}

export function sortCanonicalScopedKeys(keys) {
  const list = Array.isArray(keys) ? keys : [];
  return Array.from(
    new Set(
      list.map((k) => String(k || "").trim()).filter((key) => key.length > 0),
    ),
  ).sort(compareCanonicalScopedKeys);
}

function getParentScopeKeys(keys) {
  return sortCanonicalScopedKeys(keys).filter((key) => {
    const parts = key.split(":");
    const isSectionParent = key.startsWith("section:") && parts.length === 2;
    const isSubsectionParent =
      key.startsWith("subsection:") && parts.length === 3;
    return isSectionParent || isSubsectionParent;
  });
}

function computeStaleScopeKeys({ requestedKeys, missingKeys }) {
  const parentScopes = getParentScopeKeys(requestedKeys);
  if (!parentScopes.length) return [];

  const requested = sortCanonicalScopedKeys(requestedKeys);
  const missing = sortCanonicalScopedKeys(missingKeys);
  const stale = [];

  parentScopes.forEach((scopeKey) => {
    const missingInScope = missing.some((key) =>
      isScopeOrDescendantScopedKey(key, scopeKey),
    );
    if (!missingInScope) return;
    const requestedInScope = requested.some((key) =>
      isScopeOrDescendantScopedKey(key, scopeKey),
    );
    if (!requestedInScope) return;
    stale.push(scopeKey);
  });

  return stale.sort(compareCanonicalScopedKeys);
}

export function buildFragmentStaleScopeEventDetail({
  cycleId,
  requestedKeys,
  missingKeys,
}) {
  const normalizedMissingKeys = sortCanonicalScopedKeys(missingKeys);
  const staleScopeKeys = computeStaleScopeKeys({
    requestedKeys,
    missingKeys: normalizedMissingKeys,
  });
  if (!staleScopeKeys.length) return null;
  return {
    cycleId,
    staleScopeKeys,
    missingKeys: normalizedMissingKeys,
  };
}
