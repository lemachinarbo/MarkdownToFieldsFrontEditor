/**
 * Report state-id drift in fullscreen state/session binding.
 * Does not recover from drift or mutate canonical editor state.
 */
export function warnStateIdDrift(detail = {}, { traceEnabled = false } = {}) {
  const message = {
    type: "MFE_STATE_ID_DRIFT",
    previousOriginKey: String(detail.previousOriginKey || ""),
    incomingOriginKey: String(detail.incomingOriginKey || ""),
    previousStateId: String(detail.previousStateId || ""),
    nextStateId: String(detail.nextStateId || ""),
    language: String(detail.language || ""),
    currentScope: String(detail.currentScope || ""),
    reason: String(detail.reason || ""),
    stack: String(detail.stack || ""),
  };
  console.warn("MFE_STATE_ID_DRIFT", JSON.stringify(message));
  if (traceEnabled) {
    throw new Error("[mfe] MFE_STATE_ID_DRIFT");
  }
}

/**
 * Check whether fullscreen dev diagnostics should be visible.
 * Does not decide mutation/save authority.
 */
export function isDevMode(config = {}) {
  return Boolean(config.debug || config.debugShowSections || config.debugLabels);
}

/**
 * Check whether strict runtime/state tracing is enabled.
 * Does not log or mutate state on its own.
 */
export function isStateTraceEnabled(config = {}) {
  return config.debug === true;
}

/**
 * Hash markdown/state text for stable diagnostics.
 * Does not compare semantic structure or normalize content.
 */
export function hashStateIdentity(value) {
  const text = typeof value === "string" ? value : "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

/**
 * Hash a preview string for compact shape diagnostics.
 * Does not preserve content or expose semantic meaning.
 */
export function hashPreview(value) {
  const text = typeof value === "string" ? value : "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

/**
 * Read the persisted markdown identity used for fullscreen trace snapshots.
 * Does not inspect editor-local runtime projection state.
 */
export function getPersistedIdentityHashForTrace(getDocumentConfigMarkdown) {
  return hashStateIdentity(
    typeof getDocumentConfigMarkdown === "function"
      ? getDocumentConfigMarkdown()
      : "",
  );
}

/**
 * Read the visible status badge identity used for fullscreen trace snapshots.
 * Does not derive canonical dirty state.
 */
export function getStatusIdentityForTrace(node) {
  if (!node) return "";
  const text = String(node.textContent || "").trim();
  const cls = String(node.className || "").trim();
  return `${text}|${cls}`;
}

/**
 * Emit a dev-only fullscreen warning.
 * Does not change control flow or authority state.
 */
export function debugWarn(devMode, ...args) {
  if (!devMode) return;
  console.warn(...args);
}

/**
 * Emit a dev-only fullscreen info log.
 * Does not change control flow or authority state.
 */
export function debugInfo(devMode, ...args) {
  if (!devMode) return;
  console.info(...args);
}

/**
 * Emit a dev-only fullscreen table log.
 * Does not mutate runtime or canonical state.
 */
export function debugTable(devMode, rows) {
  if (!devMode) return;
  if (!console.table) return;
  if (!Array.isArray(rows) || !rows.length) return;
  console.table(rows);
}

/**
 * Emit a structured runtime shape diagnostic for fullscreen.
 * Does not persist logs or change runtime authority.
 */
export function emitRuntimeShapeLog(traceEnabled, type, payload = {}) {
  if (!traceEnabled) return;
  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info(type, JSON.stringify(payload));
  }
}

