function normalizeText(value, fallback = "") {
  if (typeof value === "string") return value;
  return String(fallback || "");
}

function hashSessionIdentity(value) {
  const text = normalizeText(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

export function buildSessionStateId(pageId, originKey) {
  const page = String(pageId || "0");
  const origin = String(originKey || "session");
  return `${page}:s${hashSessionIdentity(origin)}`;
}

export function resolveRequestedOriginKey(payloadMeta, options = {}) {
  const meta =
    payloadMeta && typeof payloadMeta === "object" ? payloadMeta : {};
  const fallbackFieldId = String(options.fallbackFieldId || "");
  return String(
    meta.rawOriginKey || meta.originKey || meta.fieldId || fallbackFieldId,
  );
}

export function resolveSessionOriginFieldKey(payloadMeta, context = {}) {
  const meta =
    payloadMeta && typeof payloadMeta === "object" ? payloadMeta : {};
  const explicit = String(meta.originFieldKey || "");
  if (explicit) return explicit;
  const activePageId = String(context.activePageId || "");
  const pageId = String(context.pageId || meta.pageId || "");
  const hasStableActiveSession =
    Boolean(context.activeSessionStateId) &&
    Boolean(activePageId) &&
    Boolean(pageId) &&
    activePageId === pageId;
  if (hasStableActiveSession && context.activeOriginFieldKey) {
    return String(context.activeOriginFieldKey);
  }
  return String(context.requestedOriginKey || "");
}

export function resolveSessionIdentityEnvelope(payloadMeta, context = {}) {
  const meta =
    payloadMeta && typeof payloadMeta === "object" ? payloadMeta : {};
  const pageId = String(meta.pageId || context.pageId || "0");
  const fallbackFieldId = String(context.fallbackFieldId || "");
  const requestedOriginKey = resolveRequestedOriginKey(meta, {
    fallbackFieldId,
  });
  const originFieldKey = String(
    resolveSessionOriginFieldKey(meta, {
      ...context,
      pageId,
      requestedOriginKey,
    }) || requestedOriginKey,
  );
  const activePageId = String(context.activePageId || "");
  const hasStableActiveSession =
    Boolean(context.activeSessionStateId) &&
    Boolean(activePageId) &&
    activePageId === pageId;
  const sessionStateId = String(
    hasStableActiveSession
      ? context.activeSessionStateId
      : buildSessionStateId(pageId, originFieldKey || requestedOriginKey),
  );

  return {
    pageId,
    requestedOriginKey,
    originFieldKey,
    sessionStateId,
    hasStableActiveSession,
  };
}

export function buildTranslationHydrationKey(context = {}) {
  const sessionStateId = String(context.sessionStateId || "");
  if (!sessionStateId) return "";
  return sessionStateId;
}

export function isScopeRebasedOrigin(previousOriginKey, incomingOriginKey) {
  const previous = String(previousOriginKey || "");
  const incoming = String(incomingOriginKey || "");
  if (!previous || !incoming || previous === incoming) return false;
  const previousTail = previous.split(":").slice(-2).join(":");
  const incomingTail = incoming.split(":").slice(-2).join(":");
  return Boolean(previousTail && incomingTail && previousTail === incomingTail);
}
