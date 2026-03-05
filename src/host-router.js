import { assertCanonicalStateShape } from "./canonical-contract.js";
import { getHostApiOptional, isHostFlagEnabled } from "./host-env.js";
import { withLock } from "./async-queue.js";

function isRouterDebugEnabled() {
  return isHostFlagEnabled("debug");
}

function describeTarget(target) {
  if (!(target instanceof Element)) return null;
  const readMeta = (name) => target.getAttribute(`data-mfe-${name}`) || "";
  return {
    scope: readMeta("scope"),
    section: readMeta("section"),
    subsection: readMeta("subsection"),
    name: readMeta("name"),
    page: target.getAttribute("data-page") || "",
    fieldType: target.getAttribute("data-field-type") || "",
  };
}

function hashPreview(value) {
  const text = typeof value === "string" ? value : "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

function hasCanonicalMarkers(markdown) {
  return /<!--\s*[a-zA-Z0-9_:.\/-]+\s*-->/.test(
    typeof markdown === "string" ? markdown : "",
  );
}

function debugRouterFailure(context, target, error, canonicalMarkdown = "") {
  if (!isRouterDebugEnabled()) return;
  console.warn("[mfe:router]", {
    context,
    target: describeTarget(target),
    message: String(error?.message || error || ""),
    canonicalHash: hashPreview(canonicalMarkdown),
    canonicalPreview: String(canonicalMarkdown || "").slice(0, 120),
  });
}

function assertExclusiveHostState(context = "") {
  if (isInlineOpen() && isFullscreenOpen()) {
    throw new Error(`[mfe] host invariant: both hosts active (${context})`);
  }
}

export function openFullscreenForTarget(target) {
  if (!target) return false;
  assertExclusiveHostState("router:openFullscreenForTarget:start");
  const api = getHostApiOptional("MarkdownFrontEditor");
  if (
    !api ||
    typeof api.openForElementFromCanonical !== "function" ||
    typeof api.getCanonicalState !== "function"
  ) {
    return false;
  }

  let lastCanonicalMarkdown = "";
  withLock("host-router:writer", async () => {
    assertExclusiveHostState("router:openFullscreenForTarget:locked");
    if (isInlineOpen()) {
      const closed = await requestCloseInline({
        saveOnClose: false,
        promptOnClose: true,
        keepToolbar: false,
        persistDraft: false,
        flushToCanonical: true,
      });
      if (!closed) return false;
    }
    const canonicalState = api.getCanonicalState();
    assertCanonicalStateShape(canonicalState, "router:openFullscreenForTarget");
    lastCanonicalMarkdown = String(canonicalState?.markdown || "");
    if (isRouterDebugEnabled()) {
      console.info(
        "MFE_CANONICAL_MARKER_CHECK",
        JSON.stringify({
          bytes: lastCanonicalMarkdown.length,
          hasMarkers: hasCanonicalMarkers(lastCanonicalMarkdown),
          scope: target?.getAttribute?.("data-mfe-scope") || "",
          lang: "",
        }),
      );
    }
    api.openForElementFromCanonical(target, canonicalState);
    return true;
  }).catch((error) => {
    debugRouterFailure(
      "openFullscreenForTarget",
      target,
      error,
      lastCanonicalMarkdown,
    );
  });

  return true;
}

export function openInlineForTarget(target) {
  if (!target) return false;
  assertExclusiveHostState("router:openInlineForTarget:start");

  const inlineApi = getHostApiOptional("MarkdownFrontEditorInline");
  const fullscreenApi = getHostApiOptional("MarkdownFrontEditor");
  if (
    !inlineApi ||
    typeof inlineApi.openForElementFromCanonical !== "function" ||
    !fullscreenApi ||
    typeof fullscreenApi.getCanonicalState !== "function"
  ) {
    return false;
  }

  withLock("host-router:writer", async () => {
    assertExclusiveHostState("router:openInlineForTarget:locked");
    if (isFullscreenOpen()) {
      const closed = await requestCloseFullscreen();
      if (!closed) return false;
    }
    const canonicalState = fullscreenApi.getCanonicalState();
    assertCanonicalStateShape(canonicalState, "router:openInlineForTarget");
    inlineApi.openForElementFromCanonical(target, canonicalState);
    return true;
  }).catch((error) => {
    debugRouterFailure("openInlineForTarget", target, error);
  });

  return true;
}

export function isFullscreenOpen() {
  const api = getHostApiOptional("MarkdownFrontEditor");
  if (!api || typeof api.isOpen !== "function") {
    return false;
  }
  return api.isOpen() === true;
}

export function requestCloseFullscreen() {
  const api = getHostApiOptional("MarkdownFrontEditor");
  if (
    !api ||
    typeof api.close !== "function" ||
    typeof api.flushToCanonical !== "function" ||
    typeof api.getCanonicalState !== "function"
  ) {
    return Promise.resolve(!isFullscreenOpen());
  }
  return Promise.resolve(api.flushToCanonical()).then((ok) => {
    if (!ok) return false;
    api.getCanonicalState();
    api.close();
    return !isFullscreenOpen();
  });
}

export function isInlineOpen() {
  const api = getHostApiOptional("MarkdownFrontEditorInline");
  if (!api || typeof api.isOpen !== "function") {
    return false;
  }
  return api.isOpen() === true;
}

export function requestCloseInline(options = {}) {
  const api = getHostApiOptional("MarkdownFrontEditorInline");
  if (!api || typeof api.close !== "function") {
    return Promise.resolve(!isInlineOpen());
  }
  return Promise.resolve(
    api.close({
      ...options,
      flushToCanonical: true,
    }),
  ).then(() => !isInlineOpen());
}
