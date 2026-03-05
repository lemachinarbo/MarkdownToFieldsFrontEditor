// Canonical contract is strict across hosts: state must be `{ markdown: string, applied: [] }` (or with applied entries), and transport payloads must be canonical-hydrated with shape like `{ element, markdownContent, fieldScope, fieldName, fieldSection, fieldSubsection, pageId, canonicalHydrated: true }`; non-canonical shapes are treated as invariant violations.
import {
  isHostDebugAssertEnabled,
  getHostWindowOptional,
} from "./host-env.js";

export const CANONICAL_SCOPES = ["document", "section", "subsection", "field"];

export const CANONICAL_SCOPE_SET = new Set(CANONICAL_SCOPES);
const CONTRACT_TRACE_CAP = 50;
const CONTRACT_TRACE_GLOBAL = "__MFE_CONTRACT_VIOLATIONS__";

function isCanonicalDebugAssertEnabled() {
  return isHostDebugAssertEnabled();
}

function toPrimitiveSummaryValue(value) {
  if (value === null) return null;
  const type = typeof value;
  if (
    type === "string" ||
    type === "number" ||
    type === "boolean" ||
    type === "undefined"
  ) {
    return value;
  }
  if (type === "bigint" || type === "symbol") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[array:${value.length}]`;
  }
  return `[${type}]`;
}

function buildPrimitiveSummary(details) {
  if (!details || typeof details !== "object") {
    return toPrimitiveSummaryValue(details);
  }
  const summary = {};
  Object.keys(details).forEach((key) => {
    summary[key] = toPrimitiveSummaryValue(details[key]);
  });
  return summary;
}

function getOrInitContractTraceStore() {
  const hostWindow = getHostWindowOptional();
  if (!hostWindow) return null;
  if (!hostWindow[CONTRACT_TRACE_GLOBAL]) {
    hostWindow[CONTRACT_TRACE_GLOBAL] = {
      cap: CONTRACT_TRACE_CAP,
      cursor: 0,
      count: 0,
      entries: new Array(CONTRACT_TRACE_CAP),
    };
  }
  return hostWindow[CONTRACT_TRACE_GLOBAL];
}

function appendContractTrace(entry) {
  const store = getOrInitContractTraceStore();
  if (!store) return;
  const cap =
    Number.isInteger(store.cap) && store.cap > 0
      ? store.cap
      : CONTRACT_TRACE_CAP;
  const cursor = Number.isInteger(store.cursor) ? store.cursor : 0;
  const count = Number.isInteger(store.count) ? store.count : 0;

  store.entries[cursor] = entry;
  store.cursor = (cursor + 1) % cap;
  store.count = Math.min(count + 1, cap);
}

function deriveViolationKind(message) {
  return String(message || "").includes("payload invariant")
    ? "payload"
    : "state";
}

function throwCanonicalInvariant(message, details = null) {
  if (isCanonicalDebugAssertEnabled()) {
    appendContractTrace({
      kind: deriveViolationKind(message),
      context: String(
        String(message || "").match(/\(([^()]*)\)\s*$/)?.[1] || "",
      ),
      message,
      summary: buildPrimitiveSummary(details),
    });
    console.error("[mfe] canonical assert", {
      message,
      details,
    });
  }
  throw new Error(message);
}

// CanonicalState contract:
// {
//   markdown: string,
//   applied: Array<ScopeIdentity>
// }
export function assertCanonicalStateShape(canonicalState, context = "") {
  if (isCanonicalDebugAssertEnabled()) {
    getOrInitContractTraceStore();
  }
  if (!canonicalState || typeof canonicalState !== "object") {
    throwCanonicalInvariant(
      `[mfe] canonical invariant: invalid state (${context})`,
      canonicalState,
    );
  }
  if (typeof canonicalState.markdown !== "string") {
    throwCanonicalInvariant(
      `[mfe] canonical invariant: markdown must be string (${context})`,
      canonicalState,
    );
  }
  if (!Array.isArray(canonicalState.applied)) {
    throwCanonicalInvariant(
      `[mfe] canonical invariant: applied must be array (${context})`,
      canonicalState,
    );
  }
}

// CanonicalPayload contract (transport object):
// {
//   element: object,
//   markdownContent: string,
//   fieldScope: "document" | "section" | "subsection" | "field",
//   fieldName: string,
//   fieldSection: string,
//   fieldSubsection: string,
//   pageId: string,
//   canonicalHydrated: true
// }
export function assertCanonicalPayloadSchema(canonicalPayload, context = "") {
  if (isCanonicalDebugAssertEnabled()) {
    getOrInitContractTraceStore();
  }
  if (!canonicalPayload || typeof canonicalPayload !== "object") {
    throwCanonicalInvariant(
      `[mfe] payload invariant: missing payload (${context})`,
      canonicalPayload,
    );
  }
  if (canonicalPayload.canonicalHydrated !== true) {
    throwCanonicalInvariant(
      `[mfe] payload invariant: canonicalHydrated required (${context})`,
      canonicalPayload,
    );
  }
  if (
    !canonicalPayload.element ||
    typeof canonicalPayload.element !== "object"
  ) {
    throwCanonicalInvariant(
      `[mfe] payload invariant: element required (${context})`,
      canonicalPayload,
    );
  }
  if (!CANONICAL_SCOPE_SET.has(canonicalPayload.fieldScope)) {
    throwCanonicalInvariant(
      `[mfe] payload invariant: invalid scope "${canonicalPayload.fieldScope}" (${context})`,
      canonicalPayload,
    );
  }
  if (typeof canonicalPayload.markdownContent !== "string") {
    throwCanonicalInvariant(
      `[mfe] payload invariant: markdownContent must be string (${context})`,
      canonicalPayload,
    );
  }
  if (
    canonicalPayload.fieldScope !== "document" &&
    (typeof canonicalPayload.fieldName !== "string" ||
      !canonicalPayload.fieldName)
  ) {
    throwCanonicalInvariant(
      `[mfe] payload invariant: fieldName required (${context})`,
      canonicalPayload,
    );
  }
  if (typeof canonicalPayload.fieldSection !== "string") {
    throwCanonicalInvariant(
      `[mfe] payload invariant: fieldSection must be string (${context})`,
      canonicalPayload,
    );
  }
  if (typeof canonicalPayload.fieldSubsection !== "string") {
    throwCanonicalInvariant(
      `[mfe] payload invariant: fieldSubsection must be string (${context})`,
      canonicalPayload,
    );
  }
  if (typeof canonicalPayload.pageId !== "string" || !canonicalPayload.pageId) {
    throwCanonicalInvariant(
      `[mfe] payload invariant: pageId required (${context})`,
      canonicalPayload,
    );
  }
}

export function assertCanonicalPreviewSnapshot(snapshot, isDevMode) {
  if (!isDevMode) return;
  const hasCanonicalFlag = snapshot?.canonicalHydrated === true;
  const hasMarkdown = typeof snapshot?.markdown === "string";
  if (!hasCanonicalFlag || !hasMarkdown) {
    throw new Error(
      "[mfe] preview invariant: synthetic preview requires canonical-hydrated snapshot",
    );
  }
}
