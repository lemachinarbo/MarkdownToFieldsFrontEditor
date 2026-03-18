/**
 * Tiptap-based Markdown Editor for MarkdownToFields
 *
 * Uses Tiptap v.3 with prosemirror-markdown for markdown serialization.
 * This editor provides WYSIWYG editing while preserving markdown integrity.
 */

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { common, createLowlight } from "lowlight";
import { createStatusManager } from "./editor-status.js";
import {
  HeadingSingleLineExtension,
  SingleBlockDocumentExtension,
  createSingleBlockEnterToastExtension,
} from "./field-constraints-extension.js";
import {
  shouldWarnForExtraContent,
  countSignificantTopLevelBlocks,
  renderMarkdownToHtml,
  parseMarkdownToDoc,
  decodeMarkdownBase64,
  trimTrailingLineBreaks,
  getLanguagesConfig,
  fetchTranslations,
  saveTranslation,
  assertMarkdownInvariant,
} from "./editor-core.js";
import {
  InlineHtmlLabelExtension,
  MarkerAwareBold,
  UnderlineMark,
  SuperscriptMark,
  SubscriptMark,
  MarkerAwareItalic,
  createMfeImageExtension,
  MarkerAwareBulletList,
  MarkerAwareTaskList,
  createMfeLinkExtension,
} from "./editor-tiptap-extensions.js";
import { createDocumentBoundaryExtension } from "./document-boundary-extension.js";
import {
  readDocumentBoundaryProjection,
  writeDocumentBoundaryProjection,
} from "./document-boundary-extension.js";
import {
  getMetaAttr,
  getImageBaseUrl,
  normalizeFieldHostIdentity,
  setOriginalBlockCount,
  getOriginalBlockCount,
  applyFieldAttributes,
  stripTrailingEmptyParagraph,
  getMarkdownFromEditor,
  stripMfeMarkersForFieldScope,
  stripMfeMarkers,
} from "./editor-shared-helpers.js";
import { Marker, GapSentinel } from "./marker-extension.js";
import {
  buildContentIndex,
  getFieldsIndex,
  findSectionNameForSubsection,
} from "./content-index.js";
import {
  normalizeComparableMarkdown,
} from "./draft-utils.js";
import {
  computeCanonicalMarkdownStateFromInputs,
  assertCanonicalMarkerTopology,
  resolveMarkdownForScopeFromCanonical,
} from "./canonical-state.js";
import {
  CANONICAL_SCOPE_SET,
  assertCanonicalPayloadSchema,
  assertCanonicalStateShape,
  assertCanonicalPreviewSnapshot,
} from "./canonical-contract.js";
import {
  buildSemanticLookup,
  scopedHtmlKeyFromMeta,
  compileMountTargetsByKey,
} from "./sync-by-key.js";
import {
  openWindow,
  closeWindow,
  updateWindowById,
  showWindowToast,
  clearGlobalToast,
} from "./window-manager.js";
import {
  setFullscreenShellOpen,
  setDocumentModeShellOpen,
} from "./fullscreen-shell.js";
import { isInlineShellOpen } from "./inline-shell.js";
import {
  openFullscreenForTarget,
  isInlineOpen,
  isFullscreenOpen,
} from "./host-router.js";
import {
  createScope,
  createView,
  createHost,
  resolveSession,
} from "./session-resolver.js";
import {
  buildSessionStateId as buildSessionStateIdPure,
  resolveRequestedOriginKey as resolveRequestedOriginKeyPure,
  isScopeRebasedOrigin as isScopeRebasedOriginPure,
  resolveSessionIdentityEnvelope,
  buildTranslationHydrationKey,
} from "./session-identity.js";
import {
  normalizeScopeKind,
  parseOriginScopeMeta,
  buildScopeKeyFromMeta,
  readScopeSliceFromMarkdown as readScopeSliceFromMarkdownCore,
} from "./scope-slice.js";
import {
  detectDirtyDesync,
  buildSavePlan,
  resolveFallbackSaveEditorMarkdown,
  summarizeSaveResults,
} from "./save-orchestration.js";
import {
  attachToolbarToMenubarInner,
  resolveOverlayMenubarInner,
} from "./editor-menubar.js";
import { annotateEditorDomScopeKeys } from "./editor-dom-scope-keys.js";
import {
  annotateEditableImages,
  annotateMfeHostImages,
  annotateInferredImages,
  normalizeHtmlImageSources,
} from "./editor-image-annotations.js";
import { afterNextPaint } from "./async-queue.js";
import { request, assertOk, getDataOrThrow } from "./network.js";
import { createEventRegistry } from "./event-registry.js";
import { createTransactionGuardExtension } from "./transaction-guard-extension.js";
import {
  buildPayloadFieldId,
  getDocumentState,
  clearDocumentState,
  listDocumentStates,
  emitStatesSavedBatch,
  emitDocStateLog,
} from "./document-state.js";
import {
  buildDisplayDiffTrace,
  buildEdgePreview,
  detectUnsupportedMarkdownFeatures,
  isStyleOnlyDrift,
  normalizeForReadbackClassification,
  compareReadbackSemanticAst,
  classifyReadbackMismatch,
  compareReadbackMarkdown,
  hasListIndentationShapeDrift,
  hasListTopologyDrift,
} from "./markdown-readback-analysis.js";
import { extractStructuralGraph } from "./structural-validator.js";
import {
  resolveCanonicalScopeSlice,
  projectCanonicalSlice,
  recomputeEditableBoundariesFromSegmentMap,
} from "./canonical-scope-session.js";
import {
  buildScopeMutationContext,
  resolveNonReferenceScopeAuthorityForMutation,
  resolveReferenceScopeAuthorityForMutation,
  stampRuntimeProjectionIdentity,
  validateRuntimeProjectionForScopeContext,
} from "./canonical-edit-session.js";
import {
  createScopeSession,
  doesScopeSessionMatch,
} from "./scope-session.js";
import {
  assertStructuralMarkerGraphEqual,
  hasStructuralMarkerBoundaryViolations,
  parseStructuralDocument,
} from "./structural-document.js";
import {
  applyScopedEdit,
  buildOutboundPayload,
} from "./mutation-plan.js";
import {
  normalizeLineEndingsToLf,
  splitLeadingFrontmatter,
  hasLeadingFrontmatter,
  hasBareCarriageReturn,
  countLeadingLineBreakUnits,
  countTrailingLineBreakUnits,
  buildNewlineDiagnostics,
  escapeMarkdownPreview,
  computeChangedRanges,
} from "./markdown-text-utils.js";
import {
  buildCanonicalSessionScopeMeta,
  buildCanonicalScopeKey,
  canonicalizeForCompareAndUnproject,
  buildProjectionForCanonicalizedDisplay,
} from "./canonical-mutation-utils.js";
import {
  warnStateIdDrift as warnStateIdDriftHelper,
  isDevMode as isDevModeHelper,
  isStateTraceEnabled as isStateTraceEnabledHelper,
  hashStateIdentity,
  hashPreview,
  getPersistedIdentityHashForTrace as getPersistedIdentityHashForTraceHelper,
  getStatusIdentityForTrace,
  debugWarn as debugWarnHelper,
  debugInfo as debugInfoHelper,
  debugTable as debugTableHelper,
  emitRuntimeShapeLog as emitRuntimeShapeLogHelper,
} from "./fullscreen-debug-trace.js";
import {
  handlePrimarySaveResponse,
  requestRenderedFragmentsDatastar,
} from "./fullscreen-post-save-sync.js";
import {
  applySplitSecondarySize as applySplitSecondarySizeHelper,
  hydrateTranslationsForActiveScope as hydrateTranslationsForActiveScopeHelper,
  setupSplitResizeHandle as setupSplitResizeHandleHelper,
  openSplit as openSplitHelper,
  closeSplit as closeSplitHelper,
  toggleSplit as toggleSplitHelper,
  openImagePicker as openImagePickerHelper,
  createToolbar as createToolbarHelper,
  setupKeyboardShortcuts as setupKeyboardShortcutsHelper,
} from "./fullscreen-chrome-controls.js";
import {
  getActiveHierarchy as getActiveHierarchyHelper,
  buildSessionScopeLens as buildSessionScopeLensHelper,
  getLensNode as getLensNodeHelper,
  syncSessionScopeLens as syncSessionScopeLensHelper,
  resolveLensNodeForBreadcrumb as resolveLensNodeForBreadcrumbHelper,
  resolveMarkerBearingCanonicalMarkdownForLens as resolveMarkerBearingCanonicalMarkdownForLensHelper,
  resolveCanonicalMarkdownForLensNode as resolveCanonicalMarkdownForLensNodeHelper,
  resolveIndexedMarkdownForLensNode as resolveIndexedMarkdownForLensNodeHelper,
  resolveMarkerBearingMarkdownForLensNode as resolveMarkerBearingMarkdownForLensNodeHelper,
  applyActiveOriginKeyToVirtualTarget as applyActiveOriginKeyToVirtualTargetHelper,
  buildVirtualTargetFromLensNode as buildVirtualTargetFromLensNodeHelper,
  buildBreadcrumbParts as buildBreadcrumbPartsHelper,
  buildBreadcrumbItems as buildBreadcrumbItemsHelper,
  getBreadcrumbsCurrentTarget as getBreadcrumbsCurrentTargetHelper,
  createBreadcrumbVirtualTarget as createBreadcrumbVirtualTargetHelper,
  resolveBreadcrumbNavigationTarget as resolveBreadcrumbNavigationTargetHelper,
  handleBreadcrumbClick as handleBreadcrumbClickHelper,
} from "./fullscreen-breadcrumb-navigation.js";
import {
  resolveAnchorContentIdFromOriginKey as resolveAnchorContentIdFromOriginKeyHelper,
  resolveContentIdForScopeMeta as resolveContentIdForScopeMetaHelper,
} from "./fullscreen-scope-lens.js";

let activeEditor = null;
let primaryEditor = null;
let secondaryEditor = null;
let secondaryLang = "";
let splitEnabledByUser = false;
let splitPreferredLanguage = "";
const documentStates = new Map();
let activeDocumentState = null;
const pendingTranslationHydrationByKey = new Map();
const originalBlockCounts = new WeakMap();
let editorShell = null;
let editorContainer = null;
let overlayEl = null;
let splitPane = null;
let splitRegion = null;
let splitHandle = null;
let splitResizeCleanup = null;
let splitSecondarySizePercent = 46;
let saveStatusEl = null;
let refreshToolbarState = null;
let pendingSavePromise = null;
let activeTarget = null;
let activeFieldName = null;
let activeFieldType = null; // "tag" or "container"
let activeFieldScope = "field";
let activeFieldSection = "";
let activeFieldSubsection = "";
let activeFieldId = null;
let activeOriginKey = null;
let activeOriginFieldKey = null;
let activeSessionStateId = "";
let activeRawMarkdown = null;
let activeDisplayMarkdown = null;
const canonicalMutationSessionByStateId = new Map();
const scopeSessionByStateId = new Map();
let activeSession = null;
let scopedModeMarkdown = null;
let scopedModeTarget = null;
let documentDraftMarkdown = "";
let editorViewMode = "scoped";
let outlinePersistForSession = false;

function getRuntimeAuthorityTraceGlobal() {
  if (typeof window !== "undefined") return window;
  if (typeof globalThis !== "undefined") return globalThis;
  return null;
}

function shouldCollectRuntimeAuthorityTrace(globalObject) {
  if (!globalObject) return false;
  if (Array.isArray(globalObject.__MFE_RUNTIME_AUTHORITY_TRACE__)) return true;
  return Boolean(globalObject?.MarkdownFrontEditorConfig?.debug === true);
}

function classifyRuntimeProjectionAuthorityReason(reason = "") {
  const value = String(reason || "");
  if (!value) return "";
  if (value.includes(":rebuilt")) return "validation_rebuild";
  if (value.includes(":rejected")) return "validation_reject";
  if (value.includes("scopeRebind")) return "rebind";
  if (value.startsWith("cleanupEditorOnly:") || value.includes("discard")) {
    return "discard";
  }
  if (
    value.startsWith("syncCanonicalProjectionRuntimeForEditor") ||
    value.startsWith("performCanonicalSeedNormalizationHandshake") ||
    value === "canonical-session-seeded"
  ) {
    return "reseed";
  }
  return value;
}

function pushRuntimeAuthorityTrace(entry = {}) {
  const globalObject = getRuntimeAuthorityTraceGlobal();
  if (!shouldCollectRuntimeAuthorityTrace(globalObject)) return;
  const key = "__MFE_RUNTIME_AUTHORITY_TRACE__";
  const buffer = Array.isArray(globalObject[key]) ? globalObject[key] : [];
  buffer.push(entry);
  if (buffer.length > 200) {
    buffer.splice(0, buffer.length - 200);
  }
  globalObject[key] = buffer;
}

function resolveScopeMetaForSessionLock(scopeMeta = {}) {
  return {
    scopeKind: normalizeScopeKind(scopeMeta.scopeKind || "field"),
    section: String(scopeMeta.section || ""),
    subsection: String(scopeMeta.subsection || ""),
    name: String(scopeMeta.name || ""),
  };
}

function lockScopeSessionV2ForState(
  state,
  scopeMeta = {},
  openedFrom = "unknown",
) {
  if (!state?.id) return null;
  const stateId = String(state.id || "");
  if (!stateId) return null;
  const normalizedScopeMeta = resolveScopeMetaForSessionLock(scopeMeta);
  const nextSession = createScopeSession({
    stateId,
    lang: String(state.lang || ""),
    originKey: String(state.originKey || ""),
    openedFrom: String(openedFrom || "unknown"),
    scopeMeta: normalizedScopeMeta,
  });
  const existing = scopeSessionByStateId.get(stateId) || null;
  if (existing) {
    if (
      String(existing.scopeKey || "") === String(nextSession.scopeKey || "")
    ) {
      return existing;
    }
    scopeSessionByStateId.set(stateId, nextSession);
    emitDocStateLog("MFE_SCOPE_SESSION_REBOUND", {
      stateId,
      language: String(state.lang || ""),
      originKey: String(state.originKey || ""),
      currentScope: normalizedScopeMeta.scopeKind,
      reason: "scope-session:rebound",
      trigger: "scope-navigation",
      previousScopeKey: String(existing.scopeKey || ""),
      nextScopeKey: String(nextSession.scopeKey || ""),
      openedFrom: String(nextSession.openedFrom || ""),
    });
    return nextSession;
  }
  scopeSessionByStateId.set(stateId, nextSession);
  emitDocStateLog("MFE_SCOPE_SESSION_LOCKED", {
    stateId,
    language: String(state.lang || ""),
    originKey: String(state.originKey || ""),
    currentScope: normalizedScopeMeta.scopeKind,
    reason: "scope-session:locked",
    trigger: "scope-navigation",
    scopeKey: String(nextSession.scopeKey || ""),
    openedFrom: String(nextSession.openedFrom || ""),
  });
  return nextSession;
}

function getScopeSessionForState(stateId) {
  const key = String(stateId || "");
  if (!key) return null;
  return scopeSessionByStateId.get(key) || null;
}

const SAVE_SAFETY_BLOCKED_MESSAGE =
  "Save blocked to protect marker boundaries; reopen scope and retry.";

function emitSaveSafetyBlocked({
  state = null,
  saveScope = "field",
  reason = "unknown",
  trigger = "save-commit",
  scopeKeyExpected = "",
  scopeKeyActual = "",
  details = null,
} = {}) {
  emitDocStateLog("MFE_SAVE_SAFETY_BLOCKED", {
    stateId: String(state?.id || ""),
    language: String(state?.lang || ""),
    originKey: String(state?.originKey || ""),
    currentScope: String(activeFieldScope || saveScope || "field"),
    reason: String(reason || "save-safety-blocked"),
    trigger: String(trigger || "save-commit"),
    scopeKind: normalizeScopeKind(saveScope || "field"),
    scopeKeyExpected: String(scopeKeyExpected || ""),
    scopeKeyActual: String(scopeKeyActual || ""),
    details:
      details && typeof details === "object" ? JSON.stringify(details) : "",
  });
}

function createSaveSafetyBlockedError() {
  return new Error(SAVE_SAFETY_BLOCKED_MESSAGE);
}

let suppressNextCloseConfirm = false;
let skipOutlineResetDuringClose = false;
const primaryDraftsByFieldId = new Map();
const originalMarkdownByFieldId = new Map();
const draftMarkdownByScopedKey = new Map();
const markerBaselineCountByStateId = new Map();
let suppressDirtyTracking = 0;
let allowSystemTransactionDepth = 0;
let lastEditorInputAt = 0;
let lastEditorInputSource = "none";
let lastUserIntentAt = 0;
let lastUserIntentSource = "none";
let breadcrumbAnchor = null;
let breadcrumbAnchorIdentityKey = "";
let sessionScopeLens = null;
let sessionScopeIdentityKey = "";
let sessionScopeAnchorContentId = "document:root";
let sessionScopeActiveContentId = "document:root";
let lastCompileReport = null;
let patchCycleCounter = 0;
let mountWatchObserver = null;
let mountWatchDebounceTimer = null;
let documentCacheWriteDepth = 0;
let lastPrimaryDirtyFieldId = null;
let stateTraceSnapshotDepth = 0;
const stateIdByElementAndLang = new WeakMap();

/**
 * Report fullscreen state-id drift using the shared debug-trace helper.
 * Does not reconcile or mutate state after the drift is detected.
 */
function warnStateIdDrift(detail = {}) {
  return warnStateIdDriftHelper(detail, {
    traceEnabled: isStateTraceEnabled(),
  });
}

/**
 * Read whether fullscreen trace diagnostics are enabled for this request.
 * Does not decide mutation or save authority.
 */
function isStateTraceEnabled() {
  return isStateTraceEnabledHelper(window.MarkdownFrontEditorConfig || {});
}

/**
 * Read the persisted markdown identity used by fullscreen trace snapshots.
 * Does not inspect editor-local runtime projection state.
 */
function getPersistedIdentityHashForTrace() {
  return getPersistedIdentityHashForTraceHelper(getDocumentConfigMarkdown);
}

function getCanonicalDraftIdentityHashForTrace() {
  if (stateTraceSnapshotDepth > 0) {
    return hashStateIdentity(documentDraftMarkdown || "");
  }
  stateTraceSnapshotDepth += 1;
  try {
    const canonical = getCanonicalMarkdownState();
    return hashStateIdentity(canonical?.markdown || "");
  } catch (_error) {
    return hashStateIdentity(documentDraftMarkdown || "");
  } finally {
    stateTraceSnapshotDepth = Math.max(0, stateTraceSnapshotDepth - 1);
  }
}

function snapshotStateTrace() {
  return {
    dirty: hasPrimaryCanonicalDrift(),
    pending: Boolean(pendingSavePromise),
    draftIdentityHash: getCanonicalDraftIdentityHashForTrace(),
    persistedIdentityHash: getPersistedIdentityHashForTrace(),
    statusIdentity: getStatusIdentityForTrace(saveStatusEl),
  };
}

function diffStateTrace(before = {}, after = {}) {
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  return Array.from(keys).filter((key) => before?.[key] !== after?.[key]);
}

function traceStateMutation({ reason, trigger, mutate, details = null }) {
  const before = snapshotStateTrace();
  mutate();
  const after = snapshotStateTrace();
  const changed = diffStateTrace(before, after);
  const resolvedDetails =
    typeof details === "function"
      ? details({ before, after, changed })
      : details;

  if (
    before.dirty &&
    before.draftIdentityHash === before.persistedIdentityHash
  ) {
    throw new Error("[mfe] dirty/hash invariant violated before mutation");
  }
  if (after.dirty && after.draftIdentityHash === after.persistedIdentityHash) {
    throw new Error("[mfe] dirty/hash invariant violated after mutation");
  }

  if (trigger === "lifecycle" && before.dirty !== after.dirty) {
    throw new Error("[mfe] lifecycle mutation forbidden (dirty)");
  }

  if (trigger === "user-edit") {
    if (before.persistedIdentityHash !== after.persistedIdentityHash) {
      throw new Error(
        "[mfe] user-edit mutation forbidden (persisted identity)",
      );
    }
    const nextDraftMarkdown =
      typeof resolvedDetails?.nextDraftMarkdown === "string"
        ? resolvedDetails.nextDraftMarkdown
        : "";
    const persistedMarkdown =
      typeof resolvedDetails?.persistedMarkdown === "string"
        ? resolvedDetails.persistedMarkdown
        : "";
    const isByteIdentical = nextDraftMarkdown === persistedMarkdown;
    const allowNoDrift = Boolean(resolvedDetails?.allowNoDrift);
    if (
      after.draftIdentityHash === after.persistedIdentityHash &&
      !isByteIdentical &&
      !allowNoDrift
    ) {
      throw new Error(
        "[mfe] user-edit invariant violated (no canonical drift)",
      );
    }
  }

  if (trigger === "scope-navigation") {
    const forbidden = changed.filter(
      (key) =>
        key === "dirty" ||
        key === "pending" ||
        key === "draftIdentityHash" ||
        key === "persistedIdentityHash",
    );
    if (forbidden.length > 0) {
      throw new Error(
        `[mfe] scope-navigation mutation forbidden (${forbidden.join(",")})`,
      );
    }
  }

  if (!isStateTraceEnabled() || changed.length === 0) {
    return;
  }
}

/**
 * Emit a fullscreen dev warning without changing runtime behavior.
 * Does not mutate state or projection authority.
 */
function debugWarn(...args) {
  return debugWarnHelper(isDevMode(), ...args);
}

/**
 * Emit a fullscreen dev info log without changing runtime behavior.
 * Does not mutate state or projection authority.
 */
function debugInfo(...args) {
  return debugInfoHelper(isDevMode(), ...args);
}

/**
 * Emit a fullscreen dev table log without changing runtime behavior.
 * Does not mutate state or projection authority.
 */
function debugTable(rows) {
  return debugTableHelper(isDevMode(), rows);
}

/**
 * Emit a structured runtime shape log for fullscreen diagnostics.
 * Does not persist logs or alter canonical/runtime authority.
 */
function emitRuntimeShapeLog(type, payload = {}) {
  return emitRuntimeShapeLogHelper(isStateTraceEnabled(), type, payload);
}

function hasCanonicalMarkers(markdown) {
  return /<!--\s*[a-zA-Z0-9_:.\/-]+\s*-->/.test(
    typeof markdown === "string" ? markdown : "",
  );
}

function emitCanonicalMarkerCheck({ markdown, scope, lang }) {
  const full = typeof markdown === "string" ? markdown : "";
  emitRuntimeShapeLog("MFE_CANONICAL_MARKER_CHECK", {
    bytes: full.length,
    hasMarkers: hasCanonicalMarkers(full),
    scope: normalizeScopeKind(scope || "field"),
    lang: normalizeLangValue(lang),
  });
}

function ensureCanonicalMarkersForOpen({
  markdown,
  scope,
  lang,
  source,
  requireMarkers = true,
}) {
  const full = normalizeLineEndingsToLf(
    typeof markdown === "string" ? markdown : "",
  );
  const hasMarkers = hasCanonicalMarkers(full);
  emitRuntimeShapeLog("MFE_CANONICAL_OPEN_SOURCE", {
    source: String(source || "canonical"),
    bytes: full.length,
    hasMarkers,
  });
  emitCanonicalMarkerCheck({
    markdown: full,
    scope,
    lang,
  });
  if (requireMarkers && !hasMarkers) {
    emitRuntimeShapeLog("MFE_CANONICAL_WRITE_BLOCKED", {
      source: String(source || "open-boundary"),
      lang: normalizeLangValue(lang),
      scope: normalizeScopeKind(scope || "field"),
      hash: hashPreview(full),
      preview: full.slice(0, 120),
    });
    throw new Error("[mfe] canonical open requires marker-bearing markdown");
  }
  return full;
}

function emitFrontmatterLeakBlocked({ source, lang, scope }) {
  emitRuntimeShapeLog("FRONTMATTER_LEAK_BLOCKED", {
    source: String(source || "unknown"),
    lang: normalizeLangValue(lang),
    scope: normalizeScopeKind(scope || activeFieldScope || "field"),
  });
}

function getStateForLanguage(lang) {
  const normalizedLang = normalizeLangValue(lang);
  const sessionStateKey = getActiveSessionStateKey();
  if (!normalizedLang || !sessionStateKey) return null;
  return documentStates.get(`${sessionStateKey}|${normalizedLang}`) || null;
}

function getFrontmatterForLanguage(lang) {
  const state = getStateForLanguage(lang);
  if (!state || typeof state.getFrontmatterRaw !== "function") return "";
  return String(state.getFrontmatterRaw() || "");
}

function enforceBodyOnlyEditorInput(markdownForEditor, context = {}) {
  const rawMarkdown =
    typeof markdownForEditor === "string" ? markdownForEditor : "";
  const normalizedScope = normalizeScopeKind(
    context.scope || activeFieldScope || "field",
  );
  const markdown = normalizeLineEndingsToLf(rawMarkdown);
  const hasFrontmatter = hasLeadingFrontmatter(markdown);
  if (hasFrontmatter) {
    emitFrontmatterLeakBlocked({
      source: context.source || "editor-input",
      lang: context.lang || getLanguagesConfig().current,
      scope: context.scope || activeFieldScope,
    });
    if (isDevMode()) {
      throw new Error("[mfe] frontmatter leak: editor input must be body-only");
    }
    return "";
  }
  const normalizedBody =
    normalizedScope === "document"
      ? markdown.replace(/^(?:\n)+/, "")
      : markdown;
  emitRuntimeShapeLog("EDITOR_INPUT_SHAPE", {
    lang: normalizeLangValue(context.lang || getLanguagesConfig().current),
    scope: normalizedScope,
    hasFrontmatter: false,
    bodyBytes: normalizedBody.length,
  });
  return normalizedBody;
}

function sanitizeEditorMarkdownForScope(markdown, scope) {
  const normalizedScope = normalizeScopeKind(scope || "field");
  if (
    normalizedScope === "document" ||
    normalizedScope === "section" ||
    normalizedScope === "subsection"
  ) {
    return stripMfeMarkers(markdown || "");
  }
  return String(markdown || "");
}

function normalizeScopedComparableForDirtyChecks(markdown, scopeKind) {
  const normalizedScope = normalizeScopeKind(scopeKind || "field");
  const normalized = normalizeLineEndingsToLf(String(markdown || ""));
  if (normalizedScope === "section" || normalizedScope === "subsection") {
    const withoutMarkers = stripMfeMarkers(normalized);
    const withoutLeadingHeadingPad = withoutMarkers.replace(
      /^\n+(?=[\t ]{0,3}#)/,
      "",
    );
    return trimTrailingLineBreaks(withoutLeadingHeadingPad);
  }
  if (normalizedScope === "document") {
    return trimTrailingLineBreaks(normalized).replace(/^(?:\n)+/, "");
  }
  return trimTrailingLineBreaks(normalized);
}

function ingestDocumentStateMarkdown(state, markdown, context = {}) {
  if (!state) return "";
  const lang = normalizeLangValue(context.lang || state.lang || "");
  const source = String(context.source || "ingress");
  const trigger = String(context.trigger || "system-rehydrate");
  const rawIncomingMarkdown = String(markdown || "");
  const normalizedMarkdown = normalizeCanonicalMarkdownForIngress(
    rawIncomingMarkdown,
    { enforceDocumentBodyLeadingBreakPolicy: true },
  );
  const normalizedSplit = splitLeadingFrontmatter(normalizedMarkdown);
  const structuralGraph = extractStructuralGraph(normalizedSplit.body);
  emitRuntimeShapeLog("MFE_REHYDRATE_INGRESS_DIAGNOSTIC", {
    lang,
    source,
    stateId: String(state.id || ""),
    hasCRLF: rawIncomingMarkdown.includes("\r\n"),
    hasBareCR: hasBareCarriageReturn(rawIncomingMarkdown),
    leadingLineBreakUnits: countLeadingLineBreakUnits(normalizedSplit.body),
    first80Escaped: escapeMarkdownPreview(normalizedMarkdown.slice(0, 80)),
    last80Escaped: escapeMarkdownPreview(
      normalizedMarkdown.slice(Math.max(0, normalizedMarkdown.length - 80)),
    ),
    markerCount: Array.isArray(structuralGraph.markerGraph)
      ? structuralGraph.markerGraph.length
      : 0,
    gapBoundaryCount: Array.isArray(structuralGraph.boundaryGapGraph)
      ? structuralGraph.boundaryGapGraph.length
      : 0,
  });
  const hydrated = state.hydrateFromServer(normalizedMarkdown, {
    reason: `${source}:ingest`,
    trigger,
  });
  const frontmatterRaw =
    typeof state.getFrontmatterRaw === "function"
      ? String(state.getFrontmatterRaw() || "")
      : "";
  const bodyDraft = String(state.getDraft() || "");
  emitRuntimeShapeLog("FRONTMATTER_INGEST", {
    lang,
    hasFrontmatter: frontmatterRaw.length > 0,
    frontmatterBytes: frontmatterRaw.length,
    bodyBytes: bodyDraft.length,
    source,
  });
  if (hydrated === false) {
    return bodyDraft;
  }
  ensureLanguageMarkerBaseline(state, `${source}:hydrateBaseline`, {
    refresh: true,
  });
  return bodyDraft;
}

function normalizeCanonicalMarkdownForIngress(markdown, options = {}) {
  const { enforceDocumentBodyLeadingBreakPolicy = false } = options;
  const normalized = normalizeLineEndingsToLf(String(markdown || ""));
  if (!enforceDocumentBodyLeadingBreakPolicy) {
    return normalized;
  }
  // Preserve leading body spacing exactly as authored. Document scope uses one
  // canonical markdown source of truth, including intentional blank lines.
  return normalized;
}

function emitStageMarkdownDiagnostic(stage, markdown, extra = {}) {
  const text = String(markdown || "");
  const lineBreakUnits = text.match(/\r\n|\n|\r/g);
  const payload = {
    stage: String(stage || "unknown"),
    byteLength: text.length,
    lineBreakUnits: Array.isArray(lineBreakUnits) ? lineBreakUnits.length : 0,
    leadingLineBreakUnits: countLeadingLineBreakUnits(text),
    trailingLineBreakUnits: countTrailingLineBreakUnits(text),
    hasCRLF: text.includes("\r\n"),
    hasLF: text.includes("\n"),
    first40Escaped: escapeMarkdownPreview(text.slice(0, 40)),
    last40Escaped: escapeMarkdownPreview(
      text.slice(Math.max(0, text.length - 40)),
    ),
    ...extra,
  };
  emitRuntimeShapeLog("STAGE_MARKDOWN_DIAGNOSTIC", payload);
}

function hasMarkerLineBoundaryViolations(markdown) {
  return hasStructuralMarkerBoundaryViolations(markdown);
}

function isStructuralScopeKind(scopeKind) {
  const normalizedScope = normalizeScopeKind(scopeKind || "field");
  return (
    normalizedScope === "document" ||
    normalizedScope === "section" ||
    normalizedScope === "subsection"
  );
}

function isStructuralStrictScope(scopeKind) {
  const scope = normalizeScopeKind(scopeKind || "field");
  return scope === "document" || scope === "section" || scope === "subsection";
}

function restoreEscapedMarkdownSyntaxForScopedSave(markdown, persistedBody) {
  const current = String(markdown || "");
  if (!current) return current;

  void persistedBody;

  const normalized = current
    .split(/\r?\n/)
    .map((line) => {
      let nextLine = String(line || "");

      if (/^[ \t]*\\#{1,6}[ \t]+\S/.test(nextLine)) {
        nextLine = nextLine.replace(/^([ \t]*)\\(#{1,6}[ \t]+)/, "$1$2");
      }

      if (/^[ \t]*!\\\[[^\]]*\\\]\([^\)]+\)/.test(nextLine)) {
        nextLine = nextLine.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
      }

      return nextLine;
    })
    .join("\n");

  return normalized;
}

function resolveOutboundMarkdownForSave({ markdown, scope, lang, state }) {
  const raw = typeof markdown === "string" ? markdown : "";
  const persistedBody = trimTrailingLineBreaks(
    String(state?.getPersistedMarkdown?.() || ""),
  );
  const normalizedRaw = restoreEscapedMarkdownSyntaxForScopedSave(
    raw,
    persistedBody,
  );
  if (scope === "document") {
    const normalizedBody = trimTrailingLineBreaks(normalizedRaw);
    return composeDocumentMarkdownForSave(normalizedBody, {
      lang,
      state,
    });
  }
  if (scope === "field") {
    return trimTrailingLineBreaks(stripMfeMarkersForFieldScope(normalizedRaw));
  }
  return trimTrailingLineBreaks(normalizedRaw);
}

function writeDocumentMarkdownCache({ markdownB64, source = "unknown" }) {
  if (!markdownB64) return false;
  const incomingMarkdown = normalizeCanonicalMarkdownForIngress(
    decodeMaybeB64(markdownB64),
    { enforceDocumentBodyLeadingBreakPolicy: true },
  );
  const previousMarkdown = getDocumentConfigMarkdownRaw();
  if (
    hasCanonicalMarkers(previousMarkdown) &&
    !hasCanonicalMarkers(incomingMarkdown)
  ) {
    emitRuntimeShapeLog("MFE_CANONICAL_WRITE_BLOCKED", {
      source: String(source || "unknown"),
      lang: normalizeLangValue(getLanguagesConfig().current),
      scope: "document",
    });
    if (isDevMode()) {
      throw new Error("[mfe] canonical write blocked: markerless payload");
    }
    return false;
  }
  if (documentCacheWriteDepth > 0) {
    debugWarn("[mfe:document-cache] re-entrant write prevented", {
      depth: documentCacheWriteDepth,
    });
    return false;
  }
  documentCacheWriteDepth += 1;
  try {
    const cfg = window.MarkdownFrontEditorConfig || {};
    cfg.documentMarkdownB64 = encodeMarkdownBase64(incomingMarkdown);
    window.MarkdownFrontEditorConfig = cfg;
    return true;
  } finally {
    documentCacheWriteDepth = Math.max(0, documentCacheWriteDepth - 1);
  }
}

function createVirtualDocumentTarget({ pageId, markdown, originKey = "" }) {
  const virtual = document.createElement("div");
  virtual.className = "fe-editable md-edit mfe-virtual";
  virtual.setAttribute("data-page", pageId || "0");
  virtual.setAttribute("data-mfe-scope", "document");
  virtual.setAttribute("data-mfe-name", "document");
  virtual.setAttribute("data-field-type", "container");
  virtual.setAttribute("data-mfe-markdown-kind", "canonical");
  if (originKey) {
    virtual.setAttribute("data-mfe-key", "document");
    virtual.setAttribute("data-mfe-origin-key", originKey);
  }
  virtual.setAttribute(
    "data-markdown-b64",
    encodeMarkdownBase64(markdown || ""),
  );
  return virtual;
}

function assertExclusiveActiveHost(context = "") {
  if (isInlineOpen() && isFullscreenOpen()) {
    throw new Error(`[mfe] host invariant: both hosts active (${context})`);
  }
}

function runWithoutDirtyTracking(fn) {
  suppressDirtyTracking += 1;
  allowSystemTransactionDepth += 1;
  try {
    return fn();
  } finally {
    suppressDirtyTracking = Math.max(0, suppressDirtyTracking - 1);
    allowSystemTransactionDepth = Math.max(0, allowSystemTransactionDepth - 1);
  }
}

function shouldBlockFullscreenTransaction(transaction) {
  if (!transaction?.docChanged) return false;
  if (allowSystemTransactionDepth > 0) return false;
  const updateSource = resolveEditorUpdateSource(transaction);
  if (updateSource.source !== "human") {
    const isDocumentScope =
      String(activeFieldScope || "") === "document" ||
      String(activeFieldId || "").includes(":document::document");
    const isImplicitSystemMutation =
      !String(updateSource.uiEvent || "") &&
      !Boolean(updateSource.pointer) &&
      !Boolean(updateSource.fromRecentEditorInput) &&
      !Boolean(updateSource.fromRecentUserIntent);
    if (isDocumentScope && isImplicitSystemMutation) {
      return false;
    }
  }
  return updateSource.source !== "human";
}

function reportFullscreenTransactionBlocked(transaction) {
  const updateSource = resolveEditorUpdateSource(transaction);
  const payload = {
    type: "MFE_TX_GUARD_BLOCKED",
    host: "fullscreen",
    scope: activeFieldScope || "",
    fieldId: activeFieldId || "",
    uiEvent: String(updateSource.uiEvent || ""),
    pointer: Boolean(updateSource.pointer),
    inputSource: String(updateSource.inputSource || ""),
    intentSource: String(updateSource.intentSource || ""),
    docChanged: Boolean(updateSource.docChanged),
    stepCount: Array.isArray(transaction?.steps) ? transaction.steps.length : 0,
  };
  if (isDevMode()) {
    try {
      console.warn("MFE_TX_GUARD_BLOCKED", JSON.stringify(payload));
    } catch (_error) {
      // noop
    }
  }
}

function markEditorInputSource(source) {
  lastEditorInputAt = Date.now();
  lastEditorInputSource = String(source || "unknown");
  markUserIntentToken(`editor:${lastEditorInputSource}`);
}

function markUserIntentToken(source) {
  lastUserIntentAt = Date.now();
  lastUserIntentSource = String(source || "ui");
}

function resolveEditorUpdateSource(transaction) {
  const now = Date.now();
  const fromRecentEditorInput = now - lastEditorInputAt <= 1500;
  const fromRecentUserIntent = now - lastUserIntentAt <= 1500;
  const uiEvent = String(transaction?.getMeta?.("uiEvent") || "");
  const pointer = Boolean(transaction?.getMeta?.("pointer"));
  const docChanged = Boolean(transaction?.docChanged);
  const activeEditorDom = activeEditor?.view?.dom || null;
  const focusedInsideActiveEditor = Boolean(
    docChanged &&
    activeEditorDom &&
    typeof activeEditorDom.contains === "function" &&
    typeof document !== "undefined" &&
    activeEditorDom.contains(document.activeElement),
  );

  if (fromRecentEditorInput) {
    return {
      source: "human",
      inputSource: lastEditorInputSource,
      uiEvent,
      pointer,
      intentSource: lastUserIntentSource,
      fromRecentEditorInput,
      fromRecentUserIntent,
      docChanged,
    };
  }

  if (fromRecentUserIntent && docChanged) {
    return {
      source: "human",
      inputSource: lastEditorInputSource,
      uiEvent,
      pointer,
      intentSource: lastUserIntentSource,
      fromRecentEditorInput,
      fromRecentUserIntent,
      docChanged,
    };
  }

  if (focusedInsideActiveEditor) {
    return {
      source: "human",
      inputSource: lastEditorInputSource,
      uiEvent,
      pointer,
      intentSource: lastUserIntentSource,
      fromRecentEditorInput,
      fromRecentUserIntent,
      docChanged,
    };
  }

  return {
    source: "system",
    inputSource: lastEditorInputSource,
    uiEvent,
    pointer,
    intentSource: lastUserIntentSource,
    fromRecentEditorInput,
    fromRecentUserIntent,
    docChanged,
  };
}

function hasPrimaryCanonicalDrift() {
  const persistedMarkdown = getDocumentConfigMarkdownRaw();
  const canonicalDraftMarkdown = getCanonicalMarkdownState().markdown;
  const dirtyFlag =
    normalizeComparableMarkdown(canonicalDraftMarkdown) !==
    normalizeComparableMarkdown(persistedMarkdown);
  return dirtyFlag;
}

function setDocumentDraftFromMarkdown(markdown) {
  traceStateMutation({
    reason: "setDocumentDraftFromMarkdown",
    trigger: "user-edit",
    mutate: () => {
      const nextDocumentBody = trimTrailingLineBreaks(
        typeof markdown === "string" ? markdown : "",
      );
      const currentLang = normalizeLangValue(getLanguagesConfig().current);
      const state = getStateForLanguage(currentLang) || activeDocumentState;
      const nextDocumentDraft = composeDocumentMarkdownForSave(
        nextDocumentBody,
        {
          lang: currentLang,
          state,
        },
      );
      if (
        normalizeComparableMarkdown(nextDocumentDraft) ===
        normalizeComparableMarkdown(getDocumentConfigMarkdownRaw())
      ) {
        documentDraftMarkdown = "";
        return;
      }
      documentDraftMarkdown = nextDocumentDraft;
    },
  });
}

function syncDirtyStatusForActiveField() {
  const hasPendingUnsaved = hasPendingUnsavedChanges();
  if (!activeFieldId) {
    if (!hasPendingUnsaved) {
      traceStateMutation({
        reason: "syncDirtyStatusForActiveField:clearDirtyNoActiveField",
        trigger: "status-sync",
        mutate: () => {
          statusManager.clearAllDirty();
          lastPrimaryDirtyFieldId = null;
        },
      });
    }
    return;
  }
  if (hasPendingUnsaved) {
    traceStateMutation({
      reason: "syncDirtyStatusForActiveField:markDirty",
      trigger: "status-sync",
      mutate: () => {
        if (
          lastPrimaryDirtyFieldId &&
          lastPrimaryDirtyFieldId !== activeFieldId
        ) {
          statusManager.clearDirty(lastPrimaryDirtyFieldId);
        }
        statusManager.markDirty(activeFieldId);
        lastPrimaryDirtyFieldId = activeFieldId;
      },
    });
    return;
  }
  traceStateMutation({
    reason: "syncDirtyStatusForActiveField:clearDirty",
    trigger: "status-sync",
    mutate: () => {
      statusManager.clearDirty(activeFieldId);
      if (
        lastPrimaryDirtyFieldId &&
        lastPrimaryDirtyFieldId !== activeFieldId
      ) {
        statusManager.clearDirty(lastPrimaryDirtyFieldId);
      }
      lastPrimaryDirtyFieldId = null;
    },
  });
}

function emitRuntimeBoundaryWriteTrace(payload = {}) {
  emitRuntimeShapeLog("MFE_RUNTIME_BOUNDARY_WRITE_TRACE", {
    reason: String(payload.reason || ""),
    mode: String(payload.mode || ""),
    trDocChanged:
      typeof payload.trDocChanged === "boolean" ? payload.trDocChanged : null,
    selectionFrom: Number.isFinite(Number(payload.selectionFrom))
      ? Number(payload.selectionFrom)
      : null,
    selectionTo: Number.isFinite(Number(payload.selectionTo))
      ? Number(payload.selectionTo)
      : null,
    previousRuntimeBoundaries: Array.isArray(payload.previousRuntimeBoundaries)
      ? payload.previousRuntimeBoundaries.map((value) => Number(value || 0))
      : [],
    newRuntimeBoundaries: Array.isArray(payload.newRuntimeBoundaries)
      ? payload.newRuntimeBoundaries.map((value) => Number(value || 0))
      : [],
    deterministicBoundaries: Array.isArray(payload.deterministicBoundaries)
      ? payload.deterministicBoundaries.map((value) => Number(value || 0))
      : [],
    stateId: String(payload.stateId || ""),
    scopeKey: String(payload.scopeKey || ""),
    runtimeBoundariesTrusted: Boolean(payload.runtimeBoundariesTrusted),
  });
}

/**
 * Stamp runtime projection identity from canonical session data.
 * This keeps runtime projection metadata aligned with the current canonical scope.
 */
function stampProjectionIdentityForSession(
  stateId,
  scopeMeta,
  protectedSpans,
  projection,
) {
  return stampRuntimeProjectionIdentity(projection, {
    stateId: String(stateId || ""),
    scopeKey: buildCanonicalScopeKey(scopeMeta || {}),
    protectedSpans: Array.isArray(protectedSpans) ? protectedSpans : [],
  });
}

/**
 * Stamp lightweight authority lifecycle metadata onto a runtime projection.
 * This is observability only; canonical state remains the actual authority.
 */
function stampProjectionAuthorityState(
  projection,
  authorityState,
  authorityReason,
  extraMeta = {},
) {
  const payload =
    projection && typeof projection === "object" ? projection : {};
  const projectionMeta =
    payload.projectionMeta && typeof payload.projectionMeta === "object"
      ? payload.projectionMeta
      : {};
  const nextAuthorityState = String(
    authorityState || projectionMeta.authorityState || "untrusted",
  );
  return {
    ...payload,
    projectionMeta: {
      ...projectionMeta,
      ...extraMeta,
      authorityState: nextAuthorityState,
      authorityReason: String(
        authorityReason || extraMeta.authorityReason || "",
      ),
      authorityChangedAt: Date.now(),
      runtimeBoundariesTrusted:
        typeof extraMeta.runtimeBoundariesTrusted === "boolean"
          ? extraMeta.runtimeBoundariesTrusted
          : nextAuthorityState === "trusted",
    },
  };
}

/**
 * Emit a small trust-lifecycle trace for runtime projection transitions.
 * These logs make revoke/reseed/rebuild decisions auditable without changing authority.
 */
function emitRuntimeProjectionAuthorityTransition(payload = {}) {
  const authorityReason = classifyRuntimeProjectionAuthorityReason(
    payload.reason || "",
  );
  emitDocStateLog("MFE_RUNTIME_PROJECTION_AUTHORITY_TRANSITION", {
    stateId: String(payload.stateId || ""),
    language: String(payload.language || ""),
    currentScope: String(payload.currentScope || ""),
    reason: String(payload.reason || ""),
    trigger: String(payload.trigger || "scope-validation"),
    scopeKey: String(payload.scopeKey || ""),
    authorityState: String(payload.authorityState || ""),
    previousAuthorityState: String(payload.previousAuthorityState || ""),
    physicalProjectionPresent: Boolean(payload.physicalProjectionPresent),
    runtimeBoundariesTrusted: Boolean(payload.runtimeBoundariesTrusted),
    updateMode: String(payload.updateMode || ""),
    rejectionReason: String(payload.rejectionReason || ""),
  });
  pushRuntimeAuthorityTrace({
    stateId: String(payload.stateId || ""),
    scopeKey: String(payload.scopeKey || ""),
    authorityState: String(payload.authorityState || ""),
    authorityReason,
    rawReason: String(payload.reason || ""),
    timestamp: Date.now(),
  });
}

/**
 * Mark the cached runtime projection for a canonical session as revoked or trusted.
 * The cache stays derived-only; this is for observability and safer reuse decisions.
 */
function markCanonicalSessionRuntimeProjectionAuthority(
  stateId,
  authorityState,
  authorityReason,
) {
  const key = String(stateId || "");
  if (!key) return null;
  const session = canonicalMutationSessionByStateId.get(key);
  if (!session) return null;
  const nextRuntimeProjection = session.runtimeProjection
    ? stampProjectionAuthorityState(
        session.runtimeProjection,
        authorityState,
        authorityReason,
      )
    : null;
  const nextSession = {
    ...session,
    runtimeProjection: nextRuntimeProjection,
    runtimeProjectionAuthorityState: String(authorityState || ""),
    runtimeProjectionAuthorityReason: String(authorityReason || ""),
    runtimeProjectionAuthorityChangedAt: Date.now(),
  };
  canonicalMutationSessionByStateId.set(key, nextSession);
  return nextSession;
}

function buildCanonicalMutationSession(canonicalBody, scopeMeta = {}) {
  const normalizedBody = normalizeLineEndingsToLf(String(canonicalBody || ""));
  const normalizedScopeMeta = buildCanonicalSessionScopeMeta(scopeMeta);
  const scopeSlice = resolveCanonicalScopeSlice(
    normalizedBody,
    normalizedScopeMeta,
  );
  const baselineProjection = projectCanonicalSlice(scopeSlice);
  const rawDisplayText = String(baselineProjection.displayText || "");
  const normalizedDisplayText = normalizeLineEndingsToLf(
    String(baselineProjection.displayText || ""),
  );
  const normalizedBoundaries =
    normalizedDisplayText === rawDisplayText
      ? Array.isArray(baselineProjection.editableBoundaries)
        ? baselineProjection.editableBoundaries.slice()
        : []
      : recomputeEditableBoundariesFromSegmentMap(
          baselineProjection.segmentMap,
          normalizedDisplayText,
        );
  const projection = {
    ...baselineProjection,
    displayText: normalizedDisplayText,
    editableBoundaries: normalizedBoundaries,
    projectionMeta: {
      updateMode: "deterministic-recompute",
      deterministicRecomputeCount: 0,
      mappingUpdateCount: 0,
      runtimeBoundariesTrusted: true,
    },
  };
  return {
    canonicalBodyHash: hashStateIdentity(normalizedBody),
    scopeMeta: normalizedScopeMeta,
    scopeSlice,
    projection,
    baselineDisplayHash: hashStateIdentity(
      String(projection.displayText || ""),
    ),
    createdAt: Date.now(),
  };
}

function setCanonicalMutationSessionForState(
  stateId,
  canonicalBody,
  scopeMeta = {},
) {
  const key = String(stateId || "");
  if (!key) return null;
  const nextSession = buildCanonicalMutationSession(canonicalBody, scopeMeta);
  const existing = canonicalMutationSessionByStateId.get(key);
  if (
    existing &&
    existing.canonicalBodyHash === nextSession.canonicalBodyHash &&
    existing.scopeMeta?.scopeKind === nextSession.scopeMeta?.scopeKind &&
    String(existing.scopeMeta?.section || "") ===
      String(nextSession.scopeMeta?.section || "") &&
    String(existing.scopeMeta?.subsection || "") ===
      String(nextSession.scopeMeta?.subsection || "") &&
    String(existing.scopeMeta?.name || "") ===
      String(nextSession.scopeMeta?.name || "")
  ) {
    return existing;
  }
  const scopeKey = buildCanonicalScopeKey(nextSession.scopeMeta);
  const projectionWithIdentity = stampProjectionAuthorityState(
    stampProjectionIdentityForSession(
      key,
      nextSession.scopeMeta,
      nextSession.scopeSlice?.protectedSpans,
      {
        ...nextSession.projection,
        projectionMeta: {
          ...(nextSession.projection?.projectionMeta || {}),
          stateId: key,
          scopeKey,
          runtimeBoundariesTrusted: true,
        },
      },
    ),
    "trusted",
    "canonical-session-seeded",
  );
  canonicalMutationSessionByStateId.set(key, {
    ...nextSession,
    projection: projectionWithIdentity,
    runtimeProjection: projectionWithIdentity,
    runtimeProjectionAuthorityState: "trusted",
    runtimeProjectionAuthorityReason: "canonical-session-seeded",
    runtimeProjectionAuthorityChangedAt: Date.now(),
  });
  return canonicalMutationSessionByStateId.get(key) || null;
}

function getCanonicalMutationSessionForState(stateId) {
  const key = String(stateId || "");
  if (!key) return null;
  return canonicalMutationSessionByStateId.get(key) || null;
}

function clampDocPosition(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mapDisplayOffsetToDocPosForProjection(offset, displayLength, docSize) {
  if (docSize <= 0) return 1;
  if (displayLength <= 0) return clampDocPosition(1, 1, docSize);
  const ratio = clampDocPosition(Number(offset || 0) / displayLength, 0, 1);
  return clampDocPosition(Math.round(ratio * docSize), 1, docSize);
}

function resolveMarkerAnchorFromDocBoundary(
  doc,
  rawPosition,
  preferPreviousAtTopBoundary = false,
) {
  const docSize = Math.max(0, Number(doc?.content?.size || 0));
  if (docSize <= 0) return 0;
  const candidate = clampDocPosition(
    Math.round(Number(rawPosition || 0)),
    0,
    docSize,
  );
  if (candidate <= 0 || candidate >= docSize) return candidate;
  const resolved = doc.resolve(candidate);
  if (resolved.depth < 1) {
    if (!preferPreviousAtTopBoundary) return candidate;
    let previousStart = candidate;
    doc.forEach((node, offset) => {
      const to = offset + node.nodeSize;
      if (to === candidate) {
        previousStart = offset;
      }
    });
    return clampDocPosition(previousStart, 0, docSize);
  }
  const start = clampDocPosition(resolved.before(1), 0, docSize);
  const end = clampDocPosition(resolved.after(1), 0, docSize);
  if (
    preferPreviousAtTopBoundary &&
    String(resolved.node(1)?.type?.name || "") === "heading"
  ) {
    return start;
  }
  if (candidate === start) return start;
  if (candidate === end && end > start) return start;
  const toStart = Math.abs(candidate - start);
  const toEnd = Math.abs(end - candidate);
  return toStart <= toEnd ? start : end;
}

function resolveProjectionMarkerDocAnchors(editor, projection) {
  const doc = editor?.state?.doc;
  if (!doc || !projection || typeof projection !== "object") return [];
  const spans = Array.isArray(projection?.protectedSpans)
    ? projection.protectedSpans
    : [];
  if (!spans.length) return [];
  const docBlockStarts = [];
  doc.forEach((node, offset) => {
    if (node?.type?.isBlock) docBlockStarts.push(offset);
  });
  const docSize = Math.max(1, Number(doc?.content?.size || 0));
  const displayTextLength = String(projection?.displayText || "").length;
  const boundaries = Array.isArray(projection?.boundaryDocPositions)
    ? projection.boundaryDocPositions
    : [];
  const editableBoundaries = Array.isArray(projection?.editableBoundaries)
    ? projection.editableBoundaries
    : [];
  const anchors = [];
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index] || {};
    const spanAnchorOrdinal = Number(span?.anchorBlockOrdinal ?? -1);
    if (spanAnchorOrdinal >= 0 && spanAnchorOrdinal < docBlockStarts.length) {
      anchors.push(
        clampDocPosition(
          Number(docBlockStarts[spanAnchorOrdinal] || 0),
          0,
          docSize,
        ),
      );
      continue;
    }
    const boundaryDocPos =
      Number.isFinite(Number(boundaries[index])) &&
      Number(boundaries[index]) > 0
        ? Number(boundaries[index])
        : mapDisplayOffsetToDocPosForProjection(
            Number(editableBoundaries[index] || 0),
            displayTextLength,
            docSize,
          );
    const preferPreviousAtTopBoundary =
      String(span?.markerKind || "") === "section" ||
      String(span?.markerKind || "") === "subsection";
    anchors.push(
      resolveMarkerAnchorFromDocBoundary(
        doc,
        boundaryDocPos,
        preferPreviousAtTopBoundary,
      ),
    );
  }
  return anchors;
}

function buildProjectionWithResolvedMarkerAnchors(editor, projection) {
  const baseProjection =
    projection && typeof projection === "object" ? projection : {};
  const markerDocAnchors = resolveProjectionMarkerDocAnchors(
    editor,
    baseProjection,
  );
  return {
    ...baseProjection,
    markerDocAnchors,
  };
}

/**
 * Resolve the trusted runtime projection for a state/scope pair.
 * Invalid runtime projection is rejected and rebuilt deterministically when an editor exists.
 */
function resolveValidatedRuntimeProjectionForMutation({
  state,
  scopeMeta = {},
  canonicalBody = "",
  editor = null,
  reason = "runtime-projection",
}) {
  if (!state?.id) {
    return {
      scopeContext: buildScopeMutationContext({ scopeMeta }),
      runtimeProjection: null,
      session: null,
    };
  }
  const canonicalSession =
    setCanonicalMutationSessionForState(
      String(state.id || ""),
      canonicalBody,
      scopeMeta,
    ) || getCanonicalMutationSessionForState(String(state.id || ""));
  const protectedSpans = Array.isArray(canonicalSession?.scopeSlice?.protectedSpans)
    ? canonicalSession.scopeSlice.protectedSpans
    : [];
  const scopeContext = buildScopeMutationContext({
    stateId: String(state.id || ""),
    lang: String(state.lang || ""),
    scopeMeta: canonicalSession?.scopeMeta || scopeMeta,
    protectedSpans,
  });
  const liveProjection = editor ? readDocumentBoundaryProjection(editor) : null;
  const validation = validateRuntimeProjectionForScopeContext({
    runtimeProjection: liveProjection,
    stateId: scopeContext.stateId,
    lang: scopeContext.lang,
    scopeMeta: scopeContext,
    scopeKey: scopeContext.scopeKey,
    protectedSpans,
    structuralFingerprint: scopeContext.structuralFingerprint,
  });
  if (validation.ok) {
    return {
      scopeContext,
      runtimeProjection: validation.runtimeProjection,
      session: canonicalSession,
    };
  }

  if (liveProjection) {
    emitDocStateLog("MFE_RUNTIME_PROJECTION_REJECTED", {
      stateId: scopeContext.stateId,
      language: scopeContext.lang,
      currentScope: scopeContext.scopeKind,
      reason: `${reason}:rejected`,
      trigger: "scope-validation",
      scopeKey: scopeContext.scopeKey,
      rejectionReason: String(validation.reason || "unknown"),
    });
    emitRuntimeProjectionAuthorityTransition({
      stateId: scopeContext.stateId,
      language: scopeContext.lang,
      currentScope: scopeContext.scopeKind,
      reason: `${reason}:rejected`,
      trigger: "scope-validation",
      scopeKey: scopeContext.scopeKey,
      authorityState: "rejected",
      previousAuthorityState: String(
        liveProjection?.projectionMeta?.authorityState || "",
      ),
      physicalProjectionPresent: true,
      runtimeBoundariesTrusted: Boolean(
        liveProjection?.projectionMeta?.runtimeBoundariesTrusted,
      ),
      updateMode: String(liveProjection?.projectionMeta?.updateMode || ""),
      rejectionReason: String(validation.reason || "unknown"),
    });
  }

  if (editor && canonicalSession) {
    const rebuiltProjection = syncCanonicalProjectionRuntimeForEditor(
      String(state.id || ""),
      editor,
      String(
        getMarkdownFromEditor(editor) ||
          canonicalSession.projection?.displayText ||
          "",
      ),
    );
    const rebuiltValidation = validateRuntimeProjectionForScopeContext({
      runtimeProjection: rebuiltProjection,
      stateId: scopeContext.stateId,
      lang: scopeContext.lang,
      scopeMeta: scopeContext,
      scopeKey: scopeContext.scopeKey,
      protectedSpans,
      structuralFingerprint: scopeContext.structuralFingerprint,
    });
    if (rebuiltValidation.ok) {
      emitDocStateLog("MFE_RUNTIME_PROJECTION_REBUILT", {
        stateId: scopeContext.stateId,
        language: scopeContext.lang,
        currentScope: scopeContext.scopeKind,
        reason: `${reason}:rebuilt`,
        trigger: "scope-validation",
        scopeKey: scopeContext.scopeKey,
      });
      emitRuntimeProjectionAuthorityTransition({
        stateId: scopeContext.stateId,
        language: scopeContext.lang,
        currentScope: scopeContext.scopeKind,
        reason: `${reason}:rebuilt`,
        trigger: "scope-validation",
        scopeKey: scopeContext.scopeKey,
        authorityState: String(
          rebuiltValidation.runtimeProjection?.projectionMeta?.authorityState ||
            "",
        ),
        previousAuthorityState: String(
          liveProjection?.projectionMeta?.authorityState || "rejected",
        ),
        physicalProjectionPresent: true,
        runtimeBoundariesTrusted: Boolean(
          rebuiltValidation.runtimeProjection?.projectionMeta
            ?.runtimeBoundariesTrusted,
        ),
        updateMode: String(
          rebuiltValidation.runtimeProjection?.projectionMeta?.updateMode || "",
        ),
      });
      return {
        scopeContext,
        runtimeProjection: rebuiltValidation.runtimeProjection,
        session: canonicalSession,
      };
    }
  }

  return {
    scopeContext,
    runtimeProjection: null,
    session: canonicalSession,
  };
}

function syncCanonicalProjectionRuntimeForEditor(stateId, editor, displayText) {
  const key = String(stateId || "");
  if (!key || !editor) return null;
  const session = getCanonicalMutationSessionForState(key);
  if (!session?.projection) return null;
  const scopeKey = buildCanonicalScopeKey(session?.scopeMeta || {});
  const expectedProtectedSpans = Array.isArray(session?.scopeSlice?.protectedSpans)
    ? session.scopeSlice.protectedSpans
    : [];
  const liveProjection = readDocumentBoundaryProjection(editor);
  const liveProjectionValidation = validateRuntimeProjectionForScopeContext({
    runtimeProjection: liveProjection,
    stateId: key,
    scopeKey,
    protectedSpans: expectedProtectedSpans,
  });
  const pluginProjection = liveProjectionValidation.ok
    ? liveProjectionValidation.runtimeProjection
    : session.runtimeProjection || session.projection;
  const nextDisplayText = normalizeLineEndingsToLf(String(displayText || ""));
  const currentDisplayText = normalizeLineEndingsToLf(
    String(pluginProjection?.displayText || ""),
  );
  if (nextDisplayText === currentDisplayText) {
    const protectedSpanCount = Array.isArray(
      session?.scopeSlice?.protectedSpans,
    )
      ? session.scopeSlice.protectedSpans.length
      : 0;
    const boundaryCount = Array.isArray(pluginProjection?.editableBoundaries)
      ? pluginProjection.editableBoundaries.length
      : 0;
    if (boundaryCount !== protectedSpanCount) {
      throw new Error(
        "[mfe] invariant violation: canonical projection boundary count drift during no-op sync",
      );
    }
    const preservedProjection = stampProjectionAuthorityState(
      stampProjectionIdentityForSession(
        key,
        session?.scopeMeta,
        expectedProtectedSpans,
        {
          ...pluginProjection,
          displayText: nextDisplayText,
          editableBoundaries: Array.isArray(pluginProjection?.editableBoundaries)
            ? pluginProjection.editableBoundaries.map((value) =>
                Math.max(0, Number(value || 0)),
              )
            : [],
          boundaryDocPositions: Array.isArray(
            pluginProjection?.boundaryDocPositions,
          )
            ? pluginProjection.boundaryDocPositions.map((value) =>
                Math.max(1, Number(value || 1)),
              )
            : [],
          projectionMeta: {
            ...(pluginProjection?.projectionMeta &&
            typeof pluginProjection.projectionMeta === "object"
              ? pluginProjection.projectionMeta
              : {}),
            updateMode: "no-op-preserve",
            stateId: key,
            scopeKey,
            runtimeBoundariesTrusted: true,
            boundaryInputCount: boundaryCount,
            boundaryNormalizedCount: boundaryCount,
            boundaryDedupeOccurred: false,
          },
        },
      ),
      "trusted",
      "syncCanonicalProjectionRuntimeForEditor:no-op-preserve",
    );
    emitRuntimeBoundaryWriteTrace({
      reason: "syncCanonicalProjectionRuntimeForEditor",
      mode: "no-op-preserve",
      trDocChanged: false,
      selectionFrom: Number(editor?.state?.selection?.from ?? -1),
      selectionTo: Number(editor?.state?.selection?.to ?? -1),
      previousRuntimeBoundaries: pluginProjection?.editableBoundaries || [],
      newRuntimeBoundaries: preservedProjection?.editableBoundaries || [],
      deterministicBoundaries: recomputeEditableBoundariesFromSegmentMap(
        pluginProjection?.segmentMap,
        nextDisplayText,
      ),
      stateId: key,
      scopeKey,
      runtimeBoundariesTrusted: true,
    });
    const preservedProjectionWithAnchors =
      buildProjectionWithResolvedMarkerAnchors(editor, preservedProjection);
    writeDocumentBoundaryProjection(editor, preservedProjectionWithAnchors);
    emitRuntimeProjectionAuthorityTransition({
      stateId: key,
      language: String(session?.scopeMeta?.lang || activeDocumentState?.lang || ""),
      currentScope: String(session?.scopeMeta?.scopeKind || ""),
      reason: "syncCanonicalProjectionRuntimeForEditor:no-op-preserve",
      trigger: "scope-sync",
      scopeKey,
      authorityState: String(
        preservedProjectionWithAnchors?.projectionMeta?.authorityState || "",
      ),
      previousAuthorityState: String(
        pluginProjection?.projectionMeta?.authorityState || "",
      ),
      physicalProjectionPresent: true,
      runtimeBoundariesTrusted: Boolean(
        preservedProjectionWithAnchors?.projectionMeta?.runtimeBoundariesTrusted,
      ),
      updateMode: String(
        preservedProjectionWithAnchors?.projectionMeta?.updateMode || "",
      ),
    });
    canonicalMutationSessionByStateId.set(key, {
      ...session,
      runtimeProjection: preservedProjectionWithAnchors,
      runtimeProjectionAuthorityState: String(
        preservedProjectionWithAnchors?.projectionMeta?.authorityState || "",
      ),
      runtimeProjectionAuthorityReason: String(
        preservedProjectionWithAnchors?.projectionMeta?.authorityReason || "",
      ),
      runtimeProjectionAuthorityChangedAt: Number(
        preservedProjectionWithAnchors?.projectionMeta?.authorityChangedAt || 0,
      ),
    });
    return preservedProjectionWithAnchors;
  }
  const docSize = Math.max(1, Number(editor?.state?.doc?.content?.size || 0));
  const mappedDocPositions = Array.isArray(
    pluginProjection?.boundaryDocPositions,
  )
    ? pluginProjection.boundaryDocPositions.map((value) =>
        Math.max(1, Math.min(docSize, Number(value || 1))),
      )
    : [];
  const protectedSpanCount = expectedProtectedSpans.length;
  const mappedDisplayBoundaries = Array.isArray(
    pluginProjection?.editableBoundaries,
  )
    ? pluginProjection.editableBoundaries.map((value) =>
        Math.max(0, Number(value || 0)),
      )
    : [];
  const clampStrictIncreasingBoundaries = (source, max, expectedCount) => {
    const targetCount = Math.max(0, Number(expectedCount || 0));
    const input = Array.isArray(source) ? source.slice(0, targetCount) : [];
    while (input.length < targetCount) input.push(0);
    const maxOffset = Math.max(0, Number(max || 0));
    const normalized = new Array(targetCount).fill(0);
    if (!targetCount) return normalized;
    normalized[0] = 0;
    for (let index = 1; index < targetCount; index += 1) {
      const minAllowed = normalized[index - 1] + 1;
      const maxAllowed = Math.max(
        minAllowed,
        maxOffset - (targetCount - 1 - index),
      );
      normalized[index] = Math.min(
        maxAllowed,
        Math.max(minAllowed, Math.round(Number(input[index] || 0))),
      );
    }
    return normalized;
  };
  const mappedFromDocPositions =
    mappedDocPositions.length === protectedSpanCount &&
    pluginProjection?.projectionUtils &&
    typeof pluginProjection.projectionUtils.mapDocPosToDisplayOffset ===
      "function"
      ? mappedDocPositions.map((position, index) =>
          index === 0
            ? 0
            : Number(
                pluginProjection.projectionUtils.mapDocPosToDisplayOffset(
                  position,
                  docSize,
                  nextDisplayText.length,
                ) || 0,
              ),
        )
      : [];
  const boundarySource =
    mappedDisplayBoundaries.length === protectedSpanCount
      ? mappedDisplayBoundaries
      : mappedFromDocPositions.length === protectedSpanCount
        ? mappedFromDocPositions
        : recomputeEditableBoundariesFromSegmentMap(
            pluginProjection.segmentMap,
            nextDisplayText,
          );
  const nextBoundaries = clampStrictIncreasingBoundaries(
    boundarySource,
    nextDisplayText.length,
    protectedSpanCount,
  );
  const prevMeta =
    pluginProjection.projectionMeta &&
    typeof pluginProjection.projectionMeta === "object"
      ? pluginProjection.projectionMeta
      : {};
  const nextProjection = stampProjectionAuthorityState(
    stampProjectionIdentityForSession(
      key,
      session?.scopeMeta,
      expectedProtectedSpans,
      {
        ...pluginProjection,
        displayText: nextDisplayText,
        editableBoundaries: nextBoundaries,
        boundaryDocPositions: mappedDocPositions,
        projectionMeta: {
          updateMode:
            boundarySource === mappedDisplayBoundaries
              ? "runtime-boundaries-preserved"
              : boundarySource === mappedFromDocPositions
                ? "runtime-boundaries-docpos-projected"
                : mappedDocPositions.length
                  ? "deterministic-recompute+docpos-mapped"
                  : "deterministic-recompute",
          stateId: key,
          scopeKey,
          runtimeBoundariesTrusted: Boolean(
            boundarySource === mappedDisplayBoundaries ||
            boundarySource === mappedFromDocPositions,
          ),
          deterministicRecomputeCount:
            Number(prevMeta.deterministicRecomputeCount || 0) +
            (boundarySource === mappedDisplayBoundaries ||
            boundarySource === mappedFromDocPositions
              ? 0
              : 1),
          mappingUpdateCount: Number(prevMeta.mappingUpdateCount || 0),
          boundaryInputCount: Array.isArray(pluginProjection?.editableBoundaries)
            ? pluginProjection.editableBoundaries.length
            : 0,
          boundaryNormalizedCount: nextBoundaries.length,
          boundaryDedupeOccurred: false,
        },
      },
    ),
    "trusted",
    "syncCanonicalProjectionRuntimeForEditor:write",
  );
  emitRuntimeBoundaryWriteTrace({
    reason: "syncCanonicalProjectionRuntimeForEditor",
    mode: String(nextProjection?.projectionMeta?.updateMode || ""),
    trDocChanged: null,
    selectionFrom: Number(editor?.state?.selection?.from ?? -1),
    selectionTo: Number(editor?.state?.selection?.to ?? -1),
    previousRuntimeBoundaries: pluginProjection?.editableBoundaries || [],
    newRuntimeBoundaries: nextProjection?.editableBoundaries || [],
    deterministicBoundaries: recomputeEditableBoundariesFromSegmentMap(
      pluginProjection?.segmentMap,
      nextDisplayText,
    ),
    stateId: key,
    scopeKey,
    runtimeBoundariesTrusted: Boolean(
      nextProjection?.projectionMeta?.runtimeBoundariesTrusted,
    ),
  });
  const nextProjectionWithAnchors = buildProjectionWithResolvedMarkerAnchors(
    editor,
    nextProjection,
  );
  writeDocumentBoundaryProjection(editor, nextProjectionWithAnchors);
  emitRuntimeProjectionAuthorityTransition({
    stateId: key,
    language: String(session?.scopeMeta?.lang || activeDocumentState?.lang || ""),
    currentScope: String(session?.scopeMeta?.scopeKind || ""),
    reason: "syncCanonicalProjectionRuntimeForEditor:write",
    trigger: "scope-sync",
    scopeKey,
    authorityState: String(
      nextProjectionWithAnchors?.projectionMeta?.authorityState || "",
    ),
    previousAuthorityState: String(
      pluginProjection?.projectionMeta?.authorityState || "",
    ),
    physicalProjectionPresent: true,
    runtimeBoundariesTrusted: Boolean(
      nextProjectionWithAnchors?.projectionMeta?.runtimeBoundariesTrusted,
    ),
    updateMode: String(nextProjectionWithAnchors?.projectionMeta?.updateMode || ""),
  });
  canonicalMutationSessionByStateId.set(key, {
    ...session,
    runtimeProjection: nextProjectionWithAnchors,
    runtimeProjectionAuthorityState: String(
      nextProjectionWithAnchors?.projectionMeta?.authorityState || "",
    ),
    runtimeProjectionAuthorityReason: String(
      nextProjectionWithAnchors?.projectionMeta?.authorityReason || "",
    ),
    runtimeProjectionAuthorityChangedAt: Number(
      nextProjectionWithAnchors?.projectionMeta?.authorityChangedAt || 0,
    ),
  });
  return nextProjectionWithAnchors;
}

function performCanonicalSeedNormalizationHandshake(stateId, editor) {
  const key = String(stateId || "");
  if (!key || !editor) return null;
  const session = getCanonicalMutationSessionForState(key);
  if (!session?.projection || !session?.scopeSlice) return null;
  const scopeKind = normalizeScopeKind(
    session?.scopeMeta?.scopeKind || "field",
  );
  if (scopeKind === "document") {
    const nextSession = {
      ...session,
      baselineFrozen: true,
      seedMappingUpdateCount: Number(
        session?.runtimeProjection?.projectionMeta?.mappingUpdateCount || 0,
      ),
    };
    canonicalMutationSessionByStateId.set(key, nextSession);
    emitRuntimeShapeLog("MFE_CANONICAL_SESSION_NORMALIZATION_HANDSHAKE", {
      stateId: key,
      changed: false,
      skipped: true,
      reason: "document-scope-preserve-formatting",
      baselineDisplayHashBefore: hashStateIdentity(
        String(session?.projection?.displayText || ""),
      ),
      baselineDisplayHashAfter: hashStateIdentity(
        String(session?.projection?.displayText || ""),
      ),
      firstDiffStart: -1,
      baselineWindowEscaped: "",
      serializedWindowEscaped: "",
      boundaryCountAfter: Number(
        session?.runtimeProjection?.editableBoundaries?.length ||
          session?.projection?.editableBoundaries?.length ||
          0,
      ),
      docChangedTxCountAtHandshake: Number(
        session?.runtimeProjection?.projectionMeta?.mappingUpdateCount || 0,
      ),
    });
    return nextSession;
  }
  const serializedMarkdown = String(getMarkdownFromEditor(editor) || "");
  const serializedCanonicalMeta =
    canonicalizeForCompareAndUnproject(serializedMarkdown);
  const serializedCanonical = serializedCanonicalMeta.text;
  const baselineCanonicalMeta = canonicalizeForCompareAndUnproject(
    String(session.projection.displayText || ""),
  );
  const baselineCanonical = baselineCanonicalMeta.text;
  if (session.baselineFrozen && serializedCanonical === baselineCanonical) {
    return session;
  }
  const initialPluginProjection =
    readDocumentBoundaryProjection(editor) ||
    session.runtimeProjection ||
    session.projection;
  const initialMappingCount = Number(
    initialPluginProjection?.projectionMeta?.mappingUpdateCount || 0,
  );
  const nextSession = {
    ...session,
    seedMappingUpdateCount: initialMappingCount,
    baselineFrozen: true,
  };
  if (serializedCanonical === baselineCanonical) {
    canonicalMutationSessionByStateId.set(key, nextSession);
    return nextSession;
  }
  const normalizedProjection = buildProjectionForCanonicalizedDisplay(
    session.projection,
    baselineCanonicalMeta,
    serializedCanonical,
  );
  const handshakeBoundaries = Array.isArray(
    normalizedProjection.editableBoundaries,
  )
    ? normalizedProjection.editableBoundaries
    : [];
  const baselineProjection = stampProjectionAuthorityState(
    stampProjectionIdentityForSession(
      key,
      session?.scopeMeta,
      session?.scopeSlice?.protectedSpans,
      {
        ...normalizedProjection,
        projectionMeta: {
          ...(normalizedProjection?.projectionMeta &&
          typeof normalizedProjection.projectionMeta === "object"
            ? normalizedProjection.projectionMeta
            : {}),
          updateMode: "seed-handshake",
          deterministicRecomputeCount: Number(
            normalizedProjection?.projectionMeta?.deterministicRecomputeCount || 0,
          ),
          mappingUpdateCount: Number(
            normalizedProjection?.projectionMeta?.mappingUpdateCount || 0,
          ),
          boundaryInputCount: handshakeBoundaries.length,
          boundaryNormalizedCount: handshakeBoundaries.length,
          boundaryDedupeOccurred: false,
          strippedLeadingSingleNewline: Boolean(
            baselineCanonicalMeta.strippedLeadingSingleNewline,
          ),
          strippedTrailingNewlineCount: Number(
            baselineCanonicalMeta.strippedTrailingNewlineCount || 0,
          ),
          stateId: key,
          scopeKey: buildCanonicalScopeKey(session?.scopeMeta || {}),
          runtimeBoundariesTrusted: true,
        },
      },
    ),
    "trusted",
    "performCanonicalSeedNormalizationHandshake:baseline",
  );
  const runtimeProjection = stampProjectionAuthorityState(
    stampProjectionIdentityForSession(
      key,
      session?.scopeMeta,
      session?.scopeSlice?.protectedSpans,
      {
        ...baselineProjection,
        projectionMeta: {
          ...(baselineProjection.projectionMeta || {}),
          updateMode: "seed-handshake-runtime",
        },
      },
    ),
    "trusted",
    "performCanonicalSeedNormalizationHandshake:runtime",
  );
  emitRuntimeBoundaryWriteTrace({
    reason: "performCanonicalSeedNormalizationHandshake",
    mode: "seed-handshake-runtime",
    trDocChanged: null,
    selectionFrom: Number(editor?.state?.selection?.from ?? -1),
    selectionTo: Number(editor?.state?.selection?.to ?? -1),
    previousRuntimeBoundaries:
      session?.runtimeProjection?.editableBoundaries || [],
    newRuntimeBoundaries: runtimeProjection?.editableBoundaries || [],
    deterministicBoundaries: recomputeEditableBoundariesFromSegmentMap(
      runtimeProjection?.segmentMap,
      String(runtimeProjection?.displayText || ""),
    ),
    stateId: key,
    scopeKey: buildCanonicalScopeKey(session?.scopeMeta || {}),
    runtimeBoundariesTrusted: true,
  });
  const runtimeProjectionWithAnchors = buildProjectionWithResolvedMarkerAnchors(
    editor,
    runtimeProjection,
  );
  writeDocumentBoundaryProjection(editor, runtimeProjectionWithAnchors);
  emitRuntimeProjectionAuthorityTransition({
    stateId: key,
    language: String(session?.scopeMeta?.lang || activeDocumentState?.lang || ""),
    currentScope: String(session?.scopeMeta?.scopeKind || ""),
    reason: "performCanonicalSeedNormalizationHandshake:runtime",
    trigger: "scope-sync",
    scopeKey: buildCanonicalScopeKey(session?.scopeMeta || {}),
    authorityState: String(
      runtimeProjectionWithAnchors?.projectionMeta?.authorityState || "",
    ),
    previousAuthorityState: String(
      session?.runtimeProjection?.projectionMeta?.authorityState || "",
    ),
    physicalProjectionPresent: true,
    runtimeBoundariesTrusted: Boolean(
      runtimeProjectionWithAnchors?.projectionMeta?.runtimeBoundariesTrusted,
    ),
    updateMode: String(
      runtimeProjectionWithAnchors?.projectionMeta?.updateMode || "",
    ),
  });
  const pluginProjectionAfterWrite =
    readDocumentBoundaryProjection(editor) || runtimeProjectionWithAnchors;
  const diff = buildDisplayDiffTrace(baselineCanonical, serializedCanonical);
  emitRuntimeShapeLog("MFE_CANONICAL_SESSION_NORMALIZATION_HANDSHAKE", {
    stateId: key,
    changed: true,
    rebasedWhileFrozen: Boolean(session.baselineFrozen),
    baselineDisplayHashBefore: hashStateIdentity(baselineCanonical),
    baselineDisplayHashAfter: hashStateIdentity(serializedCanonical),
    firstDiffStart: Number(diff.firstDiffStart ?? -1),
    baselineWindowEscaped: String(diff.beforeWindowEscaped || ""),
    serializedWindowEscaped: String(diff.afterWindowEscaped || ""),
    boundaryCountAfter: handshakeBoundaries.length,
    docChangedTxCountAtHandshake: Number(
      pluginProjectionAfterWrite?.projectionMeta?.mappingUpdateCount || 0,
    ),
  });
  const finalizedSession = {
    ...nextSession,
    projection: baselineProjection,
    runtimeProjection: pluginProjectionAfterWrite,
    baselineDisplayHash: hashStateIdentity(serializedCanonical),
    seedMappingUpdateCount: Number(
      pluginProjectionAfterWrite?.projectionMeta?.mappingUpdateCount || 0,
    ),
    runtimeProjectionAuthorityState: String(
      pluginProjectionAfterWrite?.projectionMeta?.authorityState || "",
    ),
    runtimeProjectionAuthorityReason: String(
      pluginProjectionAfterWrite?.projectionMeta?.authorityReason || "",
    ),
    runtimeProjectionAuthorityChangedAt: Number(
      pluginProjectionAfterWrite?.projectionMeta?.authorityChangedAt || 0,
    ),
  };
  canonicalMutationSessionByStateId.set(key, finalizedSession);
  return finalizedSession;
}

function getActivePayloadMeta() {
  if (!activeFieldId) return null;
  const payloadMeta = {
    pageId: activeTarget?.getAttribute("data-page") || "0",
    fieldScope: activeFieldScope || "field",
    fieldSection: activeFieldSection || "",
    fieldSubsection: activeFieldSubsection || "",
    fieldName: activeFieldName || "",
    fieldType: activeFieldType || "tag",
    element: activeTarget,
    originKey: activeOriginFieldKey || activeOriginKey || activeFieldId || "",
  };
  const resolvedOriginKey =
    payloadMeta.originKey || buildPayloadFieldId(payloadMeta);
  return {
    ...payloadMeta,
    fieldId: buildPayloadFieldId(payloadMeta),
    originKey: resolvedOriginKey,
    originFieldKey: resolvedOriginKey,
    rawOriginKey: resolvedOriginKey,
  };
}

function trackBoundStateIdentity(element, language, state, context = {}) {
  if (!(element instanceof Element) || !language || !state) return;
  let byLanguage = stateIdByElementAndLang.get(element);
  if (!byLanguage) {
    byLanguage = new Map();
    stateIdByElementAndLang.set(element, byLanguage);
  }
  const previousStateId = byLanguage.get(language) || "";
  const nextStateId = String(state.id || "");
  if (previousStateId && previousStateId !== nextStateId) {
    warnStateIdDrift({
      previousStateId,
      nextStateId,
      language,
      currentScope: context.currentScope || activeFieldScope || "",
      reason: context.reason || "state-rebind",
    });
  }
  byLanguage.set(language, nextStateId);
}

/**
 * Clear derived runtime/session caches for a canonical document state.
 * This never clears the canonical DocumentState itself, only disposable authority caches.
 */
function clearStateRuntimeTracking(stateId, reason = "") {
  const key = String(stateId || "");
  if (!key) return;
  markerBaselineCountByStateId.delete(key);
  canonicalMutationSessionByStateId.delete(key);
  scopeSessionByStateId.delete(key);
  emitDocStateLog("MFE_RUNTIME_STATE_TRACKING_CLEARED", {
    stateId: key,
    language: "",
    currentScope: String(activeFieldScope || ""),
    reason: String(reason || "clearStateRuntimeTracking"),
    trigger: "lifecycle",
  });
}

function ensureLanguageMarkerBaseline(state, _reason = "", options = {}) {
  if (!state) return 0;
  const stateId = String(state.id || "");
  if (!stateId) return 0;
  const refresh = Boolean(options?.refresh);
  if (!refresh && markerBaselineCountByStateId.has(stateId)) {
    return Number(markerBaselineCountByStateId.get(stateId) || 0);
  }
  const markdown = String(
    state.getDraft?.() || state.getPersistedMarkdown?.() || "",
  );
  const markerCount = parseMarkersWithOffsets(markdown).length;
  markerBaselineCountByStateId.set(stateId, markerCount);
  return markerCount;
}

function rebindActiveDocumentState(payloadMeta, lang, options = {}) {
  const normalizedLang = normalizeLangValue(lang);
  const identity = resolveSessionIdentityEnvelope(payloadMeta, {
    sessionId: options.sessionId,
    pageId: payloadMeta?.pageId || "0",
    activeSessionStateId,
    activePageId: activeTarget?.getAttribute("data-page") || "",
    activeOriginFieldKey,
    fallbackFieldId: buildPayloadFieldId(payloadMeta),
  });
  const requestedOriginKey = identity.requestedOriginKey;
  const sessionOriginFieldKey = identity.originFieldKey;
  const sessionStateId = identity.sessionStateId;
  if (
    requestedOriginKey &&
    sessionOriginFieldKey &&
    requestedOriginKey !== sessionOriginFieldKey &&
    isScopeRebasedOriginPure(sessionOriginFieldKey, requestedOriginKey)
  ) {
    warnStateIdDrift({
      previousOriginKey: sessionOriginFieldKey,
      incomingOriginKey: requestedOriginKey,
      previousStateId: `${sessionOriginFieldKey}|${normalizedLang}`,
      nextStateId: `${requestedOriginKey}|${normalizedLang}`,
      language: normalizedLang,
      currentScope: options.currentScope || payloadMeta?.fieldScope || "",
      reason: options.reason || "state-origin-rebase",
      stack: new Error().stack || "",
    });
  }
  const payloadWithOrigin = {
    ...(payloadMeta || {}),
    sessionId: sessionStateId,
    fieldScope: "document",
    fieldSection: "",
    fieldSubsection: "",
    fieldName: "document",
    originFieldKey: sessionOriginFieldKey,
    originKey: sessionOriginFieldKey,
    rawOriginKey: requestedOriginKey,
  };
  const state = getDocumentState(
    documentStates,
    payloadWithOrigin,
    normalizedLang,
    {
      reason: options.reason || "state-rebind",
      trigger: options.trigger || "scope-navigation",
      currentScope:
        options.currentScope ||
        options.viewScope ||
        payloadMeta?.fieldScope ||
        payloadWithOrigin.scope ||
        activeFieldScope ||
        "field",
      initialPersistedMarkdown: options.initialPersistedMarkdown,
      initialDraftMarkdown: options.initialDraftMarkdown,
    },
  );
  trackBoundStateIdentity(payloadWithOrigin.element, normalizedLang, state, {
    reason: options.reason,
    currentScope: options.currentScope,
  });
  activeDocumentState = state;
  activeSessionStateId = sessionStateId;
  lockScopeSessionV2ForState(
    state,
    {
      scopeKind: options.currentScope || payloadMeta?.fieldScope || "field",
      section: payloadMeta?.fieldSection || "",
      subsection: payloadMeta?.fieldSubsection || "",
      name: payloadMeta?.fieldName || "",
    },
    options.reason || "state-rebind",
  );
  return state;
}

function getDocumentStateForActiveField(lang, options = {}) {
  const payloadMeta = getActivePayloadMeta();
  if (!payloadMeta) return null;
  const state = rebindActiveDocumentState(payloadMeta, lang, {
    reason: options.reason || "active-field-bind",
    trigger: options.trigger || "scope-navigation",
    viewScope: options.currentScope || payloadMeta.fieldScope,
    sessionId: activeSessionStateId,
    initialPersistedMarkdown: options.initialPersistedMarkdown,
    initialDraftMarkdown: options.initialDraftMarkdown,
  });
  ensureLanguageMarkerBaseline(state, options.reason || "active-field-bind");
  return state;
}

let breadcrumbsEl = null;
const statusManager = createStatusManager();

const fullscreenEventRegistry = createEventRegistry();
const fullscreenGlobalEventScope =
  fullscreenEventRegistry.createScope("fullscreen-global");
let fullscreenSessionEventScope = null;
let splitResizeEventScope = null;
let disposeFullscreenKeydown = null;

function hasPendingUnsavedChanges() {
  if (pendingSavePromise) {
    return true;
  }
  const sessionStates = listStatesForActiveSession();
  for (const state of sessionStates) {
    if (state.isDirty()) {
      return true;
    }
  }
  const applyScopeMeta = captureExplicitApplyScopeMeta(
    "hasPendingUnsavedChanges",
  );
  const activeSaveScopeKind = applyScopeMeta.scopeKind || activeFieldScope;
  const structuralStrictScopeActive = isStructuralStrictScope(
    activeSaveScopeKind || "field",
  );
  const normalizeDocumentComparableForDesync = (markdown) => {
    const raw = String(markdown || "");
    const normalized = structuralStrictScopeActive
      ? raw
      : normalizeForReadbackClassification(raw);
    const comparableSource = structuralStrictScopeActive
      ? normalized
      : stripMfeMarkers(normalized);
    return normalizeComparableMarkdown(comparableSource);
  };
  const currentLang = normalizeLangValue(getLanguagesConfig().current);
  const desync = detectDirtyDesync({
    sessionStates,
    currentLang,
    secondaryLang,
    primaryEditor,
    secondaryEditor,
    applyScopeMeta,
    getMarkdownFromEditor,
    readScopeSliceFromMarkdown,
    normalizeComparableMarkdown,
    normalizeDocumentComparableMarkdown: normalizeDocumentComparableForDesync,
    normalizeScopedComparableMarkdown: (markdown, context = {}) =>
      normalizeScopedComparableForDirtyChecks(
        markdown,
        context.scopeKind || activeSaveScopeKind,
      ),
    normalizeLangValue,
    hashStateIdentity,
  });
  if (desync) {
    const hasExplicitDirtyState = sessionStates.some((state) =>
      Boolean(state?.isDirty?.()),
    );
    if (hasExplicitDirtyState) {
      return true;
    }
    return false;
  }
  for (const state of sessionStates) {
    if (state?.isUnreplayable?.()) {
      return true;
    }
  }
  return false;
}

function buildSessionStateId(pageId, originKey) {
  return buildSessionStateIdPure(pageId, originKey);
}

function getActiveSessionStateKey() {
  return String(activeSessionStateId || "");
}

function listStatesForActiveSession(sessionId = "") {
  const resolvedSessionId = String(sessionId || getActiveSessionStateKey());
  if (!resolvedSessionId) return [];
  return listDocumentStates(documentStates).filter(
    (state) => String(state.sessionId || "") === resolvedSessionId,
  );
}

function shouldConfirmUnsavedClose() {
  const cfg = window.MarkdownFrontEditorConfig || {};
  return cfg.confirmOnUnsavedClose !== false;
}

function confirmDiscardUnsavedChanges() {
  if (suppressNextCloseConfirm) {
    suppressNextCloseConfirm = false;
    return true;
  }
  if (!hasPendingUnsavedChanges()) return true;
  if (!shouldConfirmUnsavedClose()) return true;
  const ok = window.confirm(
    "You have unsaved changes. Discard them and close?",
  );
  if (ok) {
    traceStateMutation({
      reason: "confirmDiscardUnsavedChanges:discard",
      trigger: "explicit-discard",
      mutate: () => {
        primaryDraftsByFieldId.clear();
        draftMarkdownByScopedKey.clear();
        documentDraftMarkdown = "";
        for (const state of listDocumentStates(documentStates)) {
          state.clearDraft({
            reason: "confirmDiscardUnsavedChanges:clearDraft",
            trigger: "explicit-discard",
          });
          clearStateRuntimeTracking(
            state.id,
            "confirmDiscardUnsavedChanges:clearStateRuntimeTracking",
          );
          clearDocumentState(documentStates, state.id);
        }
      },
    });
  }
  return ok;
}

async function keepPendingChangesBeforeSwitch() {
  if (!activeFieldId || !primaryEditor) return true;
  traceStateMutation({
    reason: "keepPendingChangesBeforeSwitch",
    trigger: "scope-navigation",
    mutate: () => {
      syncDirtyStatusForActiveField();
    },
  });
  return true;
}

function createEditorInstance(element, fieldType, fieldName) {
  const restrictToSingleBlock = shouldWarnForExtraContent(fieldType, fieldName);
  const starterKitOptions = {
    bold: false,
    codeBlock: false,
    italic: false,
    link: false,
    underline: false,
    bulletList: false,
    ...(restrictToSingleBlock ? { document: false } : {}),
  };
  const lowlight = createLowlight(common);
  const SingleBlockEnterToastExtension = createSingleBlockEnterToastExtension(
    (message, options) => statusManager.setError(message, options),
  );
  const ImageExtension = createMfeImageExtension(getImageBaseUrl);
  const LinkExtension = createMfeLinkExtension();
  const DocumentBoundaryExtension = createDocumentBoundaryExtension(
    () => editorViewMode,
  );
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure(starterKitOptions),
      MarkerAwareBold,
      MarkerAwareItalic,
      MarkerAwareBulletList,
      MarkerAwareTaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      ...(restrictToSingleBlock ? [SingleBlockDocumentExtension] : []),
      UnderlineMark,
      SuperscriptMark,
      SubscriptMark,
      Marker,
      GapSentinel,
      CodeBlockLowlight.configure({
        lowlight,
      }),
      LinkExtension,
      ImageExtension,
      InlineHtmlLabelExtension,
      DocumentBoundaryExtension,
      ...(restrictToSingleBlock ? [SingleBlockEnterToastExtension] : []),
      HeadingSingleLineExtension,
      createTransactionGuardExtension({
        name: "mfeFullscreenTxGuard",
        shouldBlockTransaction: shouldBlockFullscreenTransaction,
        onBlockedTransaction: reportFullscreenTransactionBlocked,
      }),
      // EscapeKeyExtension, - DEPRECATED: WindowManager now handles global Escape
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm focus:outline-none mfe-editor",
        spellcheck: "false",
      },
    },
  });

  applyFieldAttributes(editor, fieldType, fieldName);

  editor.on("focus", () => {
    activeEditor = editor;
    if (typeof refreshToolbarState === "function") {
      refreshToolbarState();
    }
  });

  if (fullscreenSessionEventScope) {
    fullscreenSessionEventScope.register(editor.view.dom, "beforeinput", () =>
      markEditorInputSource("beforeinput"),
    );
    fullscreenSessionEventScope.register(editor.view.dom, "input", () =>
      markEditorInputSource("input"),
    );
    fullscreenSessionEventScope.register(editor.view.dom, "keydown", () =>
      markEditorInputSource("keydown"),
    );
    fullscreenSessionEventScope.register(editor.view.dom, "paste", () =>
      markEditorInputSource("paste"),
    );
    fullscreenSessionEventScope.register(editor.view.dom, "drop", () =>
      markEditorInputSource("drop"),
    );
    fullscreenSessionEventScope.register(
      editor.view.dom,
      "compositionend",
      () => markEditorInputSource("compositionend"),
    );
  }

  editor.on("update", ({ transaction }) => {
    if (suppressDirtyTracking > 0) return;
    if (!transaction?.docChanged) return;
    const updateSource = resolveEditorUpdateSource(transaction);
    if (updateSource.source !== "human") {
      debugWarn("[mfe:editor-update-source] blocked-non-human-update", {
        scope: activeFieldScope || "",
        fieldId: activeFieldId || "",
        ...updateSource,
      });
      return;
    }
    annotateEditorDomScopeKeys(editor);
    const activeStateKey = String(
      activeDocumentState?.id || activeFieldId || "",
    );
    if (activeStateKey && getCanonicalMutationSessionForState(activeStateKey)) {
      const runtimeDisplayText = String(getMarkdownFromEditor(editor) || "");
      syncCanonicalProjectionRuntimeForEditor(
        activeStateKey,
        editor,
        runtimeDisplayText,
      );
    }
    highlightExtraContent(editor);
    if (shouldWarnForExtraContent(fieldType, fieldName)) {
      stripTrailingEmptyParagraph(editor);
    }
    if (editor === primaryEditor) {
      const primaryFocused = Boolean(primaryEditor?.isFocused);
      const secondaryFocused = Boolean(secondaryEditor?.isFocused);
      if (
        secondaryEditor &&
        secondaryLang &&
        !primaryFocused &&
        secondaryFocused
      ) {
        emitDocStateLog("EDIT_REJECTED_BY_PIPELINE", {
          stateId: activeDocumentState?.id || "",
          language: activeDocumentState?.lang || "",
          originKey: activeDocumentState?.originKey || "",
          currentScope: activeFieldScope || "",
          reason: "editor:update:primary:secondaryFocusGuard",
          trigger: "user-edit-transaction",
        });
        return;
      }
      const persistedMarkdown = getDocumentConfigMarkdown();
      const persistedHash = hashStateIdentity(persistedMarkdown);
      const scopedKeyBefore = getActiveScopedHtmlKey();
      const currentScopedDraftBefore = isDocumentScopeActive()
        ? String(documentDraftMarkdown || "")
        : String(
            scopedKeyBefore
              ? draftMarkdownByScopedKey.get(scopedKeyBefore) || ""
              : "",
          );
      const currentScopedDraftHashBefore = hashStateIdentity(
        currentScopedDraftBefore,
      );
      const nextDraftMarkdown = getMarkdownFromEditor(editor);
      const newDraftHashCandidate = hashStateIdentity(nextDraftMarkdown);
      const readOnlyBlocked =
        Boolean(isReadOnlySyntheticSectionScope()) ||
        (typeof primaryEditor?.isEditable === "function" &&
          primaryEditor.isEditable() === false);
      const saveCommitBlocked = Boolean(pendingSavePromise);
      const identicalContentBlocked =
        nextDraftMarkdown === currentScopedDraftBefore;
      if (readOnlyBlocked || saveCommitBlocked || identicalContentBlocked) {
        if (!identicalContentBlocked) {
          emitDocStateLog("EDIT_REJECTED_BY_PIPELINE", {
            stateId: activeDocumentState?.id || "",
            language: activeDocumentState?.lang || "",
            originKey: activeDocumentState?.originKey || "",
            currentScope: activeFieldScope || "",
            reason: readOnlyBlocked
              ? "editor:update:primary:readonlyBlocked"
              : "editor:update:primary:saveCommitLock",
            trigger: "user-edit-transaction",
          });
        }
        return;
      }
      const applyScopeMeta = captureExplicitApplyScopeMeta(
        "editor:update:primary",
      );
      const primaryScopeKind = applyScopeMeta.scopeKind;
      traceStateMutation({
        reason: "editor:update:primary",
        trigger: "user-edit",
        mutate: () => {
          const markdown = nextDraftMarkdown;
          const currentLang = normalizeLangValue(getLanguagesConfig().current);
          const primaryState = getDocumentStateForActiveField(currentLang, {
            reason: "editor:update:primary:bind",
            trigger: "scope-navigation",
          });
          if (primaryState) {
            applyMarkdownToStateForReferenceScope(
              primaryState,
              markdown,
              primaryScopeKind,
              "editor:update:primary",
              {
                trigger: "user-edit-transaction",
                applyScopeMeta,
                requireExplicitScope: true,
              },
            );
            const nextDocumentDraft = primaryState.recomposeMarkdownForSave(
              primaryState.getDraft(),
            );
            if (
              normalizeComparableMarkdown(nextDocumentDraft) ===
              normalizeComparableMarkdown(getDocumentConfigMarkdownRaw())
            ) {
              documentDraftMarkdown = "";
            } else {
              documentDraftMarkdown = nextDocumentDraft;
            }
          }

          if (!isDocumentScopeActive()) {
            const scopedKey = getActiveScopedHtmlKey();
            if (scopedKey) {
              draftMarkdownByScopedKey.set(scopedKey, markdown);
            }
            if (activeFieldId) {
              primaryDraftsByFieldId.set(activeFieldId, markdown);
            }
            scopedModeMarkdown = markdown;
          }
          if (activeFieldId) {
            statusManager.markDirty(activeFieldId);
          }
        },
        details: () => {
          const scopedKeyAfter = getActiveScopedHtmlKey();
          const currentScopedDraftAfter = isDocumentScopeActive()
            ? String(documentDraftMarkdown || "")
            : String(
                scopedKeyAfter
                  ? draftMarkdownByScopedKey.get(scopedKeyAfter) || ""
                  : "",
              );
          const currentScopedDraftHashAfter = hashStateIdentity(
            currentScopedDraftAfter,
          );
          const assignmentSkipped =
            newDraftHashCandidate !== currentScopedDraftHashBefore &&
            currentScopedDraftHashAfter === currentScopedDraftHashBefore;
          const assignmentBlockedReason = readOnlyBlocked
            ? "readonly-mode"
            : saveCommitBlocked
              ? "save-commit-lock"
              : identicalContentBlocked
                ? "identical-content"
                : "none";

          if (assignmentSkipped && assignmentBlockedReason === "none") {
            emitDocStateLog("EDIT_REJECTED_BY_PIPELINE", {
              stateId: activeDocumentState?.id || "",
              language: activeDocumentState?.lang || "",
              originKey: activeDocumentState?.originKey || "",
              currentScope: activeFieldScope || "",
              reason: "editor:update:primary:assignmentSkipped",
              trigger: "user-edit-transaction",
              persistedHash,
              currentScopedDraftHashBefore,
              currentScopedDraftHashAfter,
              newDraftHashCandidate,
              assignmentBlockedReason,
            });
          }

          return {
            persistedHash,
            persistedMarkdown,
            currentScopedDraftHashBefore,
            currentScopedDraftHashAfter,
            newDraftHashCandidate,
            previousScopedDraftMarkdown: currentScopedDraftBefore,
            nextDraftMarkdown,
            assignmentSkipped,
            assignmentBlockedReason,
            allowNoDrift:
              assignmentBlockedReason !== "none" || assignmentSkipped,
          };
        },
      });
    }
    if (editor === secondaryEditor && secondaryLang) {
      if (pendingSavePromise) {
        emitDocStateLog("EDIT_REJECTED_BY_PIPELINE", {
          stateId: activeDocumentState?.id || "",
          language: secondaryLang,
          originKey: activeDocumentState?.originKey || "",
          currentScope: activeFieldScope || "",
          reason: "editor:update:secondary:saveCommitLock",
          trigger: "user-edit-transaction",
        });
        return;
      }
      const secondaryState = getDocumentStateForActiveField(secondaryLang);
      if (secondaryState) {
        const applyScopeMeta = captureExplicitApplyScopeMeta(
          "editor:update:secondary",
        );
        const secondaryScopeKind = applyScopeMeta.scopeKind;
        applyMarkdownToStateForReferenceScope(
          secondaryState,
          getMarkdownFromEditor(editor),
          secondaryScopeKind,
          "editor:update:secondary",
          {
            trigger: "user-edit-transaction",
            applyScopeMeta,
            requireExplicitScope: true,
          },
        );
        if (activeFieldId) {
          statusManager.markDirty(activeFieldId);
        }
      }
    }
  });

  editor.view.dom.onkeydown = (e) => {
    if (e.key !== "Tab") return;
    if (!primaryEditor || !secondaryEditor) return;
    e.preventDefault();
    if (e.shiftKey) {
      primaryEditor.view.focus();
    } else {
      secondaryEditor.view.focus();
    }
  };

  return editor;
}

function saveAllEditors() {
  if (isReadOnlySyntheticSectionScope()) {
    debugWarn(
      "[mfe:save] blocked read-only synthetic section scope",
      SECTION_COMPOSITE_PREVIEW_READONLY_ERROR,
    );
    return Promise.resolve(false);
  }
  if (primaryEditor && hasBlockingExtraContent(primaryEditor)) {
    statusManager.setError(EXTRA_SCOPE_SAVE_ERROR);
    return Promise.resolve(false);
  }
  if (secondaryEditor && hasBlockingExtraContent(secondaryEditor)) {
    statusManager.setError(EXTRA_SCOPE_SAVE_ERROR);
    return Promise.resolve(false);
  }

  const currentLang = normalizeLangValue(getLanguagesConfig().current);
  const sessionStateKey = getActiveSessionStateKey();
  const sessionStates = listStatesForActiveSession(sessionStateKey);
  const applyScopeMeta = captureExplicitApplyScopeMeta("saveAllEditors");
  const activeSaveScopeKind = applyScopeMeta.scopeKind || activeFieldScope;
  const structuralStrictScopeActive = isStructuralStrictScope(
    activeSaveScopeKind || "field",
  );
  const normalizeDocumentComparableForDesync = (markdown) => {
    const raw = String(markdown || "");
    const normalized = structuralStrictScopeActive
      ? raw
      : normalizeForReadbackClassification(raw);
    const comparableSource = structuralStrictScopeActive
      ? normalized
      : stripMfeMarkers(normalized);
    return normalizeComparableMarkdown(comparableSource);
  };
  const readEditorMarkdown = (editor) => getMarkdownFromEditor(editor);
  const readScopedEditorMarkdown = (editor) => {
    if (!editor) return "";
    const rawEditorMarkdown = String(readEditorMarkdown(editor) || "");
    return rawEditorMarkdown;
  };
  const resolveEditorForLang = (lang) => {
    const normalized = normalizeLangValue(lang);
    if (normalized === normalizeLangValue(currentLang)) {
      return primaryEditor;
    }
    if (normalized === normalizeLangValue(secondaryLang)) {
      return secondaryEditor;
    }
    return null;
  };
  const isStateDerivedDirty = (state) => {
    if (!state) return false;
    if (state.isDirty()) return true;
    const langEditor = resolveEditorForLang(state.lang);
    if (!langEditor) return false;
    const editorMarkdown = readScopedEditorMarkdown(langEditor);
    const stateScopedMarkdown = readScopeSliceFromMarkdown(
      String(state.getDraft() || ""),
      applyScopeMeta,
    );
    const comparableEditorInput = normalizeScopedComparableForDirtyChecks(
      editorMarkdown,
      applyScopeMeta?.scopeKind || state?.scopeKind || activeSaveScopeKind,
    );
    const comparableStateInput = normalizeScopedComparableForDirtyChecks(
      stateScopedMarkdown,
      applyScopeMeta?.scopeKind || state?.scopeKind || activeSaveScopeKind,
    );
    const isDocumentScope =
      String(applyScopeMeta?.scopeKind || state?.scopeKind || "") ===
      "document";
    const normalizeForCompare =
      isDocumentScope &&
      typeof normalizeDocumentComparableForDesync === "function"
        ? normalizeDocumentComparableForDesync
        : normalizeComparableMarkdown;
    return (
      normalizeForCompare(comparableEditorInput) !==
      normalizeForCompare(comparableStateInput)
    );
  };
  // source-contract marker: emitDocStateLog("SAVE_PLAN_BUILT")
  let dirtyDesync = detectDirtyDesync({
    sessionStates,
    currentLang,
    secondaryLang,
    primaryEditor,
    secondaryEditor,
    applyScopeMeta,
    getMarkdownFromEditor,
    readScopeSliceFromMarkdown,
    normalizeComparableMarkdown,
    normalizeDocumentComparableMarkdown: normalizeDocumentComparableForDesync,
    normalizeScopedComparableMarkdown: (markdown, context = {}) =>
      normalizeScopedComparableForDirtyChecks(
        markdown,
        context.scopeKind || applyScopeMeta.scopeKind || activeFieldScope,
      ),
    normalizeLangValue,
    hashStateIdentity,
  });
  const reconciledStateIds = new Set();
  if (dirtyDesync && !dirtyDesync.state.isDirty()) {
    const desyncChannel = String(dirtyDesync.channel || "primary");
    const desyncEditor =
      desyncChannel === "secondary" ? secondaryEditor : primaryEditor;
    const desyncStateScopedMarkdown = readScopeSliceFromMarkdown(
      String(dirtyDesync.state.getDraft() || ""),
      applyScopeMeta,
    );
    const desyncEditorMarkdown = desyncEditor
      ? readScopedEditorMarkdown(desyncEditor)
      : "";
    const desyncClassification = classifyReadbackMismatch(
      desyncStateScopedMarkdown,
      desyncEditorMarkdown,
    );
    const styleOnlyDesync =
      desyncClassification.className === "marker_blankline_normalization" ||
      isStyleOnlyDrift(desyncStateScopedMarkdown, desyncEditorMarkdown);
    if (!structuralStrictScopeActive && styleOnlyDesync) {
      emitDocStateLog("MFE_DIRTY_DESYNC_IGNORED", {
        stateId: dirtyDesync.state.id,
        language: dirtyDesync.state.lang,
        originKey: dirtyDesync.state.originKey,
        currentScope: activeFieldScope || "",
        reason: "saveAllEditors:dirtyDesyncIgnoredStyleOnly",
        trigger: "save-commit",
        channel: dirtyDesync.channel,
        class: desyncClassification.className,
        tokenBefore: String(desyncClassification.tokenBefore || ""),
        tokenAfter: String(desyncClassification.tokenAfter || ""),
        editorHash: dirtyDesync.editorHash,
        stateHash: dirtyDesync.stateHash,
        editorComparableHash: dirtyDesync.editorComparableHash,
        stateComparableHash: dirtyDesync.stateComparableHash,
        dirtyBefore: false,
        dirtyAfter: false,
      });
      dirtyDesync = null;
    }
  }
  if (dirtyDesync && !dirtyDesync.state.isDirty()) {
    const desyncChannel = String(dirtyDesync.channel || "primary");
    const reconcileEditor =
      desyncChannel === "secondary" ? secondaryEditor : primaryEditor;
    const reconcileLang =
      desyncChannel === "secondary" ? secondaryLang : currentLang;
    if (
      reconcileEditor &&
      normalizeLangValue(reconcileLang) ===
        normalizeLangValue(dirtyDesync.state.lang)
    ) {
      const reconcileMarkdown = readScopedEditorMarkdown(reconcileEditor);
      const reconcileScopeKind = activeSaveScopeKind;
      emitDocStateLog("MFE_DIRTY_DESYNC_RECONCILE_BYPASSED_V2", {
        stateId: dirtyDesync.state.id,
        language: dirtyDesync.state.lang,
        originKey: dirtyDesync.state.originKey,
        currentScope: activeFieldScope || "",
        reason: "saveAllEditors:desyncReconcileBypassedV2",
        trigger: "save-commit",
        channel: desyncChannel,
        scope: reconcileScopeKind,
        editorHash: hashStateIdentity(reconcileMarkdown),
        stateHash: hashStateIdentity(
          String(dirtyDesync.state.getDraft() || ""),
        ),
      });
      if (dirtyDesync?.state?.id) {
        reconciledStateIds.add(String(dirtyDesync.state.id));
      }
      dirtyDesync = null;
    }
  }
  if (dirtyDesync) {
    const hasAnyDirtyState = sessionStates.some((state) =>
      isStateDerivedDirty(state),
    );
    if (!hasAnyDirtyState) {
      emitDocStateLog("MFE_DIRTY_DESYNC_IGNORED", {
        stateId: dirtyDesync.state.id,
        language: dirtyDesync.state.lang,
        originKey: dirtyDesync.state.originKey,
        currentScope: activeFieldScope || "",
        reason: "saveAllEditors:dirtyDesyncIgnoredCleanSession",
        trigger: "save-commit",
        channel: dirtyDesync.channel,
        editorHash: dirtyDesync.editorHash,
        stateHash: dirtyDesync.stateHash,
        editorComparableHash: dirtyDesync.editorComparableHash,
        stateComparableHash: dirtyDesync.stateComparableHash,
        dirtyBefore: false,
        dirtyAfter: false,
      });
    } else {
      const ignoreCleanDesync = !dirtyDesync.state.isDirty();

      if (ignoreCleanDesync) {
        emitDocStateLog("MFE_DIRTY_DESYNC_IGNORED", {
          stateId: dirtyDesync.state.id,
          language: dirtyDesync.state.lang,
          originKey: dirtyDesync.state.originKey,
          currentScope: activeFieldScope || "",
          reason: "saveAllEditors:dirtyDesyncIgnoredCleanState",
          trigger: "save-commit",
          channel: dirtyDesync.channel,
          editorHash: dirtyDesync.editorHash,
          stateHash: dirtyDesync.stateHash,
          editorComparableHash: dirtyDesync.editorComparableHash,
          stateComparableHash: dirtyDesync.stateComparableHash,
          dirtyBefore: false,
          dirtyAfter: false,
        });
      } else {
        emitDocStateLog("MFE_DIRTY_DESYNC", {
          stateId: dirtyDesync.state.id,
          language: dirtyDesync.state.lang,
          originKey: dirtyDesync.state.originKey,
          currentScope: activeFieldScope || "",
          reason: "saveAllEditors:dirtyDesync",
          trigger: "save-commit",
          channel: dirtyDesync.channel,
          editorHash: dirtyDesync.editorHash,
          stateHash: dirtyDesync.stateHash,
          editorComparableHash: dirtyDesync.editorComparableHash,
          stateComparableHash: dirtyDesync.stateComparableHash,
          dirtyBefore: false,
          dirtyAfter: false,
        });
        debugWarn("[mfe:save] blocked dirty=false desync", {
          stateId: dirtyDesync.state.id,
          channel: dirtyDesync.channel,
          editorHash: dirtyDesync.editorHash,
          stateHash: dirtyDesync.stateHash,
        });
        return Promise.resolve(false);
      }
    }
  }
  const { saveCandidates, plannedHashesByStateId } = buildSavePlan({
    sessionStateKey,
    currentLang,
    activeFieldScope: activeSaveScopeKind,
    listStatesForActiveSession,
    emitDocStateLog,
    hashStateIdentity,
    isStateDirtyForSave: isStateDerivedDirty,
    isStateExcludedFromSave: (state) =>
      Boolean(state?.isUnreplayable?.() && isStateDerivedDirty(state)),
  });
  const hadExplicitDirtyBeforeSave = saveCandidates.some((state) =>
    Boolean(state?.isDirty?.()),
  );

  if (saveCandidates.length === 0) {
    const hasDerivedDirtyState = sessionStates.some((state) =>
      isStateDerivedDirty(state),
    );
    const hasUnreplayableDerivedDirtyState = sessionStates.some(
      (state) =>
        Boolean(state?.isUnreplayable?.()) && isStateDerivedDirty(state),
    );
    if (hasDerivedDirtyState && hasUnreplayableDerivedDirtyState) {
      traceStateMutation({
        reason: "saveAllEditors:unreplayableDirty",
        trigger: "save-commit",
        mutate: () => {
          debugWarn(
            "[mfe:save] unreplayable dirty state",
            "Unsaved changes cannot be replayed in this scope yet",
          );
          syncDirtyStatusForActiveField();
        },
      });
      return Promise.resolve(false);
    }
    traceStateMutation({
      reason: "saveAllEditors:noChanges",
      trigger: "save-commit",
      mutate: () => {
        statusManager.clearAllDirty();
        statusManager.setNoChanges();
        syncDirtyStatusForActiveField();
      },
    });
    return Promise.resolve(false);
  }

  if (pendingSavePromise) {
    return pendingSavePromise;
  }

  traceStateMutation({
    reason: "saveAllEditors:processing",
    trigger: "save-commit",
    mutate: () => {
      statusManager.setProcessing("Saving...");
    },
  });
  showWindowToast("Saving...", "info", { persistent: true, global: true });

  const run = (async () => {
    const results = [];
    let backendCapabilityWarningShown = false;
    for (const state of saveCandidates) {
      const stateDraftMarkdown = String(state.getDraft() || "");
      const stateScopeKind = normalizeScopeKind(state.scopeKind || "field");
      const isDocumentStateKind = stateScopeKind === "document";
      const currentSecondaryLang = normalizeLangValue(
        getLanguagesConfig().secondary,
      );
      const saveScope = resolveScopeAtSaveBoundary(
        activeSaveScopeKind || state.payloadMeta.fieldScope || "document",
      );
      const strictStructuralScope = isStructuralStrictScope(saveScope);
      const isDocumentSaveScope = saveScope === "document";
      if (
        strictStructuralScope &&
        reconciledStateIds.has(String(state.id || ""))
      ) {
        emitDocStateLog("MFE_RECONCILED_SAVE_CANONICAL", {
          stateId: state.id,
          language: state.lang,
          originKey: state.originKey,
          currentScope: activeFieldScope || saveScope,
          reason: "saveAllEditors:reconciledStateCanonicalMutation",
          trigger: "save-commit",
          scope: saveScope,
        });
      }
      let scopedReferenceMarkdown;
      const langEditor = resolveEditorForLang(state.lang);
      const hasLiveEditorForState = Boolean(langEditor);
      const rawEditorMarkdown = langEditor
        ? String(readEditorMarkdown(langEditor) || "")
        : "";
      emitStageMarkdownDiagnostic("editor_raw", rawEditorMarkdown, {
        stateId: state.id,
        language: state.lang,
        scopeKind: saveScope,
      });
      try {
        scopedReferenceMarkdown = readScopeSliceFromMarkdown(
          stateDraftMarkdown,
          applyScopeMeta,
        );
      } catch (err) {
        if (strictStructuralScope) {
          emitDocStateLog("MFE_SCOPE_READ_FAILED", {
            stateId: state.id,
            language: state.lang,
            reason: "saveAllEditors:scopeReadFailed",
            trigger: "save-commit",
            scopeKind: applyScopeMeta.scopeKind || "field",
            errorMsg: err?.message || "unknown error",
          });
          throw err;
        }
        emitDocStateLog("MFE_SCOPE_READ_FALLBACK", {
          stateId: state.id,
          language: state.lang,
          reason: "saveAllEditors:scopeReadFallback",
          trigger: "save-commit",
          scopeKind: applyScopeMeta.scopeKind || "field",
          errorMsg: err?.message || "unknown error",
        });
        scopedReferenceMarkdown = readScopeSliceFromMarkdown(
          state.getPersistedMarkdown() || "",
          applyScopeMeta,
        );
      }
      const scopeMarkdownFromActiveEditor = hasLiveEditorForState
        ? readScopedEditorMarkdown(langEditor)
        : resolveFallbackSaveEditorMarkdown({
            fallbackMarkdown: scopedReferenceMarkdown,
            canonicalBody: stateDraftMarkdown,
            scopeMeta: applyScopeMeta,
          });
      const scopeMarkdownForSaveSource = scopeMarkdownFromActiveEditor;
      if (strictStructuralScope) {
        const sourceEventType =
          saveScope === "document"
            ? "MFE_SAVE_SCOPE_SOURCE_ACTIVE_EDITOR"
            : "MFE_SAVE_SCOPE_SOURCE_STATE_DRAFT";
        const sourceReason =
          saveScope === "document"
            ? "saveAllEditors:scopeSourceActiveEditor"
            : "saveAllEditors:scopeSourceStateDraft";
        emitDocStateLog(sourceEventType, {
          stateId: state.id,
          language: state.lang,
          originKey: state.originKey,
          currentScope: activeFieldScope || saveScope,
          reason: sourceReason,
          trigger: "save-commit",
          scopeKind: saveScope,
        });
      }
      const scopedEditedMarkdownRaw = String(scopeMarkdownForSaveSource || "");
      emitStageMarkdownDiagnostic(
        "editor_serialized",
        scopedEditedMarkdownRaw,
        {
          stateId: state.id,
          language: state.lang,
          scopeKind: saveScope,
        },
      );
      let scopedEditedMarkdown = scopedEditedMarkdownRaw;
      const scopedEditorLooksCanonicalDocument =
        !isDocumentSaveScope &&
        (hasLeadingFrontmatter(scopedEditedMarkdownRaw) ||
          hasCanonicalMarkers(scopedEditedMarkdownRaw));
      if (scopedEditorLooksCanonicalDocument) {
        const scopedEditorBody = splitLeadingFrontmatter(
          scopedEditedMarkdownRaw,
        ).body;
        let extractedScopedMarkdown;
        try {
          extractedScopedMarkdown = readScopeSliceFromMarkdown(
            scopedEditorBody,
            applyScopeMeta,
          );
        } catch (err) {
          // If scope reading fails, silently use empty and fall through
          emitDocStateLog("MFE_SCOPED_EDITOR_SHAPE_EXTRACTION_FALLBACK", {
            stateId: state.id,
            language: state.lang,
            reason: "saveAllEditors:scopedEditorShapeExtractionFallback",
            trigger: "save-commit",
            scopeKind: applyScopeMeta.scopeKind || "field",
            errorMsg: err?.message || "unknown error",
          });
          extractedScopedMarkdown = null;
        }
        if (
          extractedScopedMarkdown &&
          String(extractedScopedMarkdown || "").trim().length > 0
        ) {
          scopedEditedMarkdown = String(extractedScopedMarkdown || "");
          emitDocStateLog("MFE_SCOPED_EDITOR_SHAPE_NORMALIZED", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: activeFieldScope || saveScope,
            reason: "saveAllEditors:scopedEditorShapeNormalized",
            trigger: "save-commit",
            scopeKind: saveScope,
            rawBytes: scopedEditedMarkdownRaw.length,
            normalizedBytes: scopedEditedMarkdown.length,
          });
        } else {
          const rawScopedComparable = normalizeComparableMarkdown(
            stripMfeMarkers(scopedEditedMarkdownRaw),
          );
          const fullDraftComparable = normalizeComparableMarkdown(
            stripMfeMarkers(stateDraftMarkdown),
          );
          const alreadyScopedEditorShape =
            !hasLeadingFrontmatter(scopedEditedMarkdownRaw) &&
            rawScopedComparable !== fullDraftComparable;
          if (alreadyScopedEditorShape) {
            scopedEditedMarkdown = String(scopedEditedMarkdownRaw || "");
            emitDocStateLog("MFE_SCOPED_EDITOR_SHAPE_ACCEPTED_RAW_SCOPED", {
              stateId: state.id,
              language: state.lang,
              originKey: state.originKey,
              currentScope: activeFieldScope || saveScope,
              reason: "saveAllEditors:scopedEditorShapeAcceptedRawScoped",
              trigger: "save-commit",
              scopeKind: saveScope,
              rawBytes: scopedEditedMarkdownRaw.length,
            });
          } else if (structuralStrictScopeActive) {
            emitDocStateLog("MFE_SCOPED_EDITOR_SHAPE_REJECTED", {
              stateId: state.id,
              language: state.lang,
              originKey: state.originKey,
              currentScope: activeFieldScope || saveScope,
              reason: "saveAllEditors:scopedEditorShapeRejected",
              trigger: "save-commit",
              scopeKind: saveScope,
              rawBytes: scopedEditedMarkdownRaw.length,
            });
            debugWarn(
              "[mfe:save] scoped editor shape rejected",
              "Constitutional Violation: unable to extract scoped markdown from editor shape",
            );
            throw new Error(
              "[mfe] Constitutional Violation: unable to extract scoped markdown from editor shape",
            );
          }
          scopedEditedMarkdown = String(scopedEditedMarkdownRaw || "");
          emitDocStateLog("MFE_SCOPED_EDITOR_SHAPE_FALLBACK_RAW", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: activeFieldScope || saveScope,
            reason: "saveAllEditors:scopedEditorShapeFallbackRaw",
            trigger: "save-commit",
            scopeKind: saveScope,
            rawBytes: scopedEditedMarkdownRaw.length,
            fallbackBytes: scopedEditedMarkdown.length,
          });
        }
      }

      // Layer 2 disabled: no semantic merge/protect rewrite in scoped save path.
      // Keep editor-scoped markdown as-is for canonical mutation patching.
      const scopedEditedMarkdownSourceFirst = {
        markdown: String(scopedEditedMarkdown || ""),
        discardedStyleOnlyHunkCount: 0,
        semanticHunkCount: 0,
      };
      let scopedMarkdownForSave = scopedEditedMarkdownSourceFirst.markdown;
      let finalCanonicalMarkdown = "";
      let finalCanonicalBody = stateDraftMarkdown;
      let saveMode = "structural-mutation";
      const canonicalBefore = state.recomposeMarkdownForSave(
        state.getPersistedMarkdown(),
      );
      const splitBefore = splitLeadingFrontmatter(canonicalBefore);
      const saveScopeMeta = buildCanonicalSessionScopeMeta({
        scopeKind: saveScope,
        name: applyScopeMeta.name,
        section: applyScopeMeta.section,
        subsection: applyScopeMeta.subsection,
      });
      const scopeSessionForSave = getScopeSessionForState(state.id);
      if (!scopeSessionForSave) {
        emitSaveSafetyBlocked({
          state,
          saveScope,
          reason: "saveAllEditors:scopeSessionMissing",
          scopeKeyExpected: buildScopeKeyFromMeta(saveScopeMeta),
          scopeKeyActual: "",
        });
        throw createSaveSafetyBlockedError();
      }
      if (!doesScopeSessionMatch(scopeSessionForSave, saveScopeMeta)) {
        emitSaveSafetyBlocked({
          state,
          saveScope,
          reason: "saveAllEditors:scopeSessionMismatch",
          scopeKeyExpected: buildScopeKeyFromMeta(saveScopeMeta),
          scopeKeyActual: String(scopeSessionForSave.scopeKey || ""),
        });
        throw createSaveSafetyBlockedError();
      }
      let effectiveCanonicalMutation = null;
      const structuralDocumentBefore = parseStructuralDocument(
        splitBefore.body,
      );
      const runtimeProjectionResolution = resolveValidatedRuntimeProjectionForMutation(
        {
          state,
          scopeMeta: saveScopeMeta,
          canonicalBody: splitBefore.body,
          editor: langEditor,
          reason: "saveAllEditors",
        },
      );
      const scopedMutation = applyScopedEdit({
        session: scopeSessionForSave,
        structuralDocument: structuralDocumentBefore,
        editorContent: scopedEditedMarkdownSourceFirst.markdown,
        runtimeProjection: runtimeProjectionResolution.runtimeProjection,
      });
      if (!scopedMutation || scopedMutation.ok === false) {
        throw new Error(
          String(scopedMutation?.reason || "[mfe] mutation-plan failed"),
        );
      }
      finalCanonicalBody = String(scopedMutation.canonicalBody || splitBefore.body);
      scopedMarkdownForSave = buildOutboundPayload({
        canonicalBody: finalCanonicalBody,
        scopeMeta: saveScopeMeta,
      });
      effectiveCanonicalMutation = {
        canonicalBody: finalCanonicalBody,
        scopedComparableMarkdown: String(
          scopedMutation.scopedComparableMarkdown || scopedMarkdownForSave,
        ),
        scopedOutboundMarkdown: String(scopedMarkdownForSave || ""),
        startOffset: Number(scopedMutation.startOffset || 0),
        endOffset: Number(scopedMutation.endOffset || 0),
      };
      emitDocStateLog("MFE_MUTATION_PLAN_APPLIED", {
        stateId: state.id,
        language: state.lang,
        originKey: state.originKey,
        currentScope: activeFieldScope || saveScope,
        reason: "saveAllEditors:mutationPlanApplied",
        trigger: "save-commit",
        scopeKind: saveScope,
        scopeKey: String(scopeSessionForSave?.scopeKey || ""),
        startOffset: effectiveCanonicalMutation.startOffset,
        endOffset: effectiveCanonicalMutation.endOffset,
      });
      finalCanonicalMarkdown = `${splitBefore.frontmatter}${finalCanonicalBody}`;
      emitStageMarkdownDiagnostic("canonical_before_save", finalCanonicalBody, {
        stateId: state.id,
        language: state.lang,
        scopeKind: saveScope,
      });
      if (hasMarkerLineBoundaryViolations(finalCanonicalBody)) {
        emitSaveSafetyBlocked({
          state,
          saveScope,
          reason: "saveAllEditors:markerBoundaryAdjacency",
          scopeKeyExpected: buildScopeKeyFromMeta(saveScopeMeta),
          scopeKeyActual: String(scopeSessionForSave?.scopeKey || ""),
        });
        throw createSaveSafetyBlockedError();
      }
      let changedRanges = computeChangedRanges(
        normalizeLineEndingsToLf(splitBefore.body),
        normalizeLineEndingsToLf(finalCanonicalBody),
      );
      const leakedRanges = changedRanges.filter(
        (range) =>
          range.start < effectiveCanonicalMutation.startOffset ||
          range.endBefore > effectiveCanonicalMutation.endOffset,
      );
      emitDocStateLog("SAVE_DIFF_SUMMARY", {
        stateId: state.id,
        language: state.lang,
        originKey: state.originKey,
        currentScope: activeFieldScope || saveScope,
        reason: "saveAllEditors:diffSummary",
        trigger: "save-commit",
        dirtyBefore: state.isDirty(),
        dirtyAfter: state.isDirty(),
        hashBefore: hashStateIdentity(splitBefore.body),
        hashAfter: hashStateIdentity(finalCanonicalBody),
        scopeKind: saveScope,
        scopeName: applyScopeMeta.name,
        scopeSection: applyScopeMeta.section,
        scopeSubsection: applyScopeMeta.subsection,
        expectedStart: effectiveCanonicalMutation.startOffset,
        expectedEnd: effectiveCanonicalMutation.endOffset,
        changedRangeCount: changedRanges.length,
        leakedRangeCount: leakedRanges.length,
      });
      if (leakedRanges.length > 0) {
        throw new Error(
          "[mfe] lossless scoped save blocked: out-of-scope mutation",
        );
      }
      emitDocStateLog("SAVE_PATH_SELECTED", {
        stateId: state.id,
        language: state.lang,
        originKey: state.originKey,
        currentScope: saveScope,
        reason: "saveAllEditors:pathSelected",
        trigger: "save-commit",
        dirtyBefore: state.isDirty(),
        dirtyAfter: state.isDirty(),
        hashBefore: "save-path",
        hashAfter: "save-path",
        mode: saveMode,
        stateScopeKind,
      });
      if (stateScopeKind === "document" && saveMode !== "document-canonical") {
        emitDocStateLog("MFE_SAVE_MODE_ROUTING_INFO", {
          stateId: state.id,
          language: state.lang,
          originKey: state.originKey,
          currentScope: saveScope,
          reason: "saveAllEditors:routingScopedFromDocumentState",
          trigger: "save-commit",
          stateScopeKind,
          mode: saveMode,
          saveScope,
        });
      }
      const bytesCanonicalBody = finalCanonicalBody.length;
      const markerCountCanonicalBody =
        parseMarkersWithOffsets(finalCanonicalBody).length;
      emitDocStateLog("SAVE_COMMIT_SOURCE", {
        stateId: state.id,
        language: state.lang,
        originKey: state.originKey,
        currentScope: saveScope,
        reason: "saveAllEditors:commitSource",
        trigger: "save-commit",
        stateScopeKind,
        mode: saveMode,
        bytesCanonicalBody,
        markerCountCanonicalBody,
      });
      const bytesFinalCanonical = finalCanonicalMarkdown.length;
      const bytesMarkSavedArg = finalCanonicalBody.length;
      const isClearlySmallerMarkSavedArg =
        stateScopeKind === "document" &&
        bytesFinalCanonical > 0 &&
        bytesMarkSavedArg < Math.floor(bytesFinalCanonical * 0.5);
      if (isClearlySmallerMarkSavedArg) {
        emitDocStateLog("SAVE_COMMIT_ASSERT_FAIL", {
          stateId: state.id,
          language: state.lang,
          originKey: state.originKey,
          currentScope: saveScope,
          reason: "saveAllEditors:commitShapeFail",
          trigger: "save-commit",
          stateScopeKind,
          mode: saveMode,
          bytesFinalCanonical,
          bytesMarkSavedArg,
        });
        throw new Error(
          "[mfe] save commit assert failed: markSaved arg smaller than canonical markdown",
        );
      }
      emitDocStateLog("SAVE_COMMIT_ASSERT_PASS", {
        stateId: state.id,
        language: state.lang,
        originKey: state.originKey,
        currentScope: saveScope,
        reason: "saveAllEditors:commitShapePass",
        trigger: "save-commit",
        stateScopeKind,
        mode: saveMode,
        bytesFinalCanonical,
        bytesMarkSavedArg,
      });
      const plannedHash = plannedHashesByStateId.get(state.id) || "";
      const payloadHash = hashStateIdentity(stateDraftMarkdown);
      if (plannedHash && plannedHash !== payloadHash) {
        const mismatchError = new Error(
          `[mfe] save-pipeline: draft hash drift before network for ${state.id}`,
        );
        if (isDevMode()) {
          throw mismatchError;
        }
        results.push({
          ok: false,
          state,
          error: mismatchError,
          hasFragments: false,
        });
        continue;
      }
      try {
        const saveMdName = isDocumentSaveScope
          ? "document"
          : applyScopeMeta.name ||
            activeFieldName ||
            state.payloadMeta.fieldName ||
            "document";
        const saveMdSection = isDocumentSaveScope
          ? ""
          : applyScopeMeta.section ||
            activeFieldSection ||
            state.payloadMeta.fieldSection ||
            "";
        const saveMdSubsection = isDocumentSaveScope
          ? ""
          : saveScope === "section"
            ? ""
            : applyScopeMeta.subsection ||
              activeFieldSubsection ||
              state.payloadMeta.fieldSubsection ||
              "";
        const saveFieldId = String(
          buildPayloadFieldId({
            pageId:
              state.payloadMeta.pageId ||
              activeTarget?.getAttribute("data-page") ||
              "0",
            fieldScope: isDocumentSaveScope ? "document" : saveScope,
            fieldSection: saveMdSection,
            fieldSubsection: saveMdSubsection,
            fieldName: saveMdName,
          }) ||
            state.payloadMeta.fieldId ||
            activeFieldId ||
            "",
        );
        const rawOutboundMarkdownForSave = isDocumentSaveScope
          ? composeDocumentMarkdownForSave(finalCanonicalBody, {
              lang: state.lang,
              state,
            })
          : scopedMarkdownForSave;
        const outboundMarkdownForSave = normalizeLineEndingsToLf(
          restoreEscapedMarkdownSyntaxForScopedSave(
            rawOutboundMarkdownForSave,
            state.getPersistedMarkdown(),
          ),
        );
        emitStageMarkdownDiagnostic(
          "payload_sent_backend",
          outboundMarkdownForSave,
          {
            stateId: state.id,
            language: state.lang,
            scopeKind: saveScope,
          },
        );
        if (isDocumentSaveScope) {
          const fullSerializedEditorMarkdown =
            state.lang === currentLang && primaryEditor
              ? String(readEditorMarkdown(primaryEditor) || "")
              : state.lang === currentSecondaryLang && secondaryEditor
                ? String(readEditorMarkdown(secondaryEditor) || "")
                : "";
          const equalsFullSerializedOutput =
            fullSerializedEditorMarkdown.length > 0 &&
            outboundMarkdownForSave.length ===
              fullSerializedEditorMarkdown.length &&
            outboundMarkdownForSave === fullSerializedEditorMarkdown;
          if (equalsFullSerializedOutput) {
            emitDocStateLog("MFE_DOCUMENT_SAVE_SERIALIZED_PAYLOAD_BLOCKED", {
              stateId: state.id,
              language: state.lang,
              originKey: state.originKey,
              currentScope: activeFieldScope || saveScope,
              reason: "saveAllEditors:serializedPayloadBlocked",
              trigger: "save-commit",
              mode: saveMode,
              stateScopeKind,
              bytesOutbound: outboundMarkdownForSave.length,
            });
            throw new Error(
              "[mfe] invariant violation: document save payload must not equal full serializeMarkdownDoc output",
            );
          }
        }
        if (
          typeof isIntentPatchDebugEnabled !== "undefined" &&
          isIntentPatchDebugEnabled() &&
          !isDocumentSaveScope
        ) {
          const comparableForDiagnostics =
            readScopedComparableFromCanonicalBody(finalCanonicalBody, {
              scopeKind: saveScope,
              section: saveMdSection,
              subsection: saveMdSubsection,
              name: saveMdName,
            });
          const outboundForDiagnostics = readScopedOutboundFromCanonicalBody(
            finalCanonicalBody,
            {
              scopeKind: saveScope,
              section: saveMdSection,
              subsection: saveMdSubsection,
              name: saveMdName,
            },
          );
          console.info(
            "MFE_SAVE_OUTBOUND_RANGE_TRACE",
            JSON.stringify({
              scopeKind: saveScope,
              section: saveMdSection,
              subsection: saveMdSubsection,
              name: saveMdName,
              comparableNewlineDiagnostics: buildNewlineDiagnostics(
                comparableForDiagnostics,
              ),
              outboundRangeNewlineDiagnostics: buildNewlineDiagnostics(
                outboundForDiagnostics,
              ),
              outboundRequestNewlineDiagnostics: buildNewlineDiagnostics(
                outboundMarkdownForSave,
              ),
            }),
          );
        }
        const outboundNewlineDiagnostics = buildNewlineDiagnostics(
          outboundMarkdownForSave,
        );
        const canonicalOutboundNewlineDiagnostics = buildNewlineDiagnostics(
          finalCanonicalMarkdown,
        );
        const scopedOutboundSourceNewlineDiagnostics = buildNewlineDiagnostics(
          scopedMarkdownForSave,
        );
        if (
          typeof isIntentPatchDebugEnabled !== "undefined" &&
          isIntentPatchDebugEnabled()
        ) {
          console.info(
            "MFE_SCOPED_OUTBOUND_FINAL",
            JSON.stringify({
              scopeKind: saveScope,
              fieldId: saveFieldId,
              section: String(saveMdSection || ""),
              caller: "saveAllEditors",
              sourceScopedMarkerCount: Number(0),
              afterStripMarkerCount: Number(0),
              returnedMarkdownMarkerCount: Number(0),
              outboundMarkdownForSaveMarkerCount: parseMarkersWithOffsets(
                outboundMarkdownForSave,
              ).length,
              outboundMode: isDocumentSaveScope ? "document" : "scoped",
              outboundNewlineDiagnostics,
              canonicalOutboundNewlineDiagnostics,
              scopedOutboundSourceNewlineDiagnostics,
            }),
          );
        }
        const pipelineInvariant = validateSavePipelineInvariants({
          state,
          saveScope,
          isDocumentSaveScope,
          finalCanonicalMarkdown,
          outboundMarkdownForSave,
          scopedEditedMarkdownSourceFirst,
        });
        if (!pipelineInvariant.ok) {
          emitDocStateLog("SAVE_PIPELINE_INVARIANT_FAIL", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: activeFieldScope || saveScope,
            reason: "saveAllEditors:pipelineInvariantFail",
            trigger: "save-commit",
            mode: saveMode,
            saveScope,
            error: pipelineInvariant.error || "unknown invariant failure",
          });
          throw new Error(
            pipelineInvariant.error || "[mfe] save-pipeline invariant failure",
          );
        }
        const preSavePersistedMarkdown = state.recomposeMarkdownForSave(
          state.getPersistedMarkdown(),
        );
        const preSavePersistedSplit = splitLeadingFrontmatter(
          preSavePersistedMarkdown,
        );
        const preflight = validateStateSavePreflight(
          state,
          stateDraftMarkdown,
          "saveAllEditors:preflight",
        );
        if (!preflight.ok) {
          throw new Error(preflight.error || "scope-shape mismatch");
        }
        const saveResult = await saveTranslation(
          state.payloadMeta.pageId || "0",
          saveMdName,
          state.lang,
          outboundMarkdownForSave,
          isDocumentSaveScope ? "document" : saveScope,
          saveMdSection,
          saveMdSubsection,
          saveFieldId,
        );
        const data = getDataOrThrow(assertOk(saveResult));
        if (!data.status) {
          throw new Error(data.message || "Save failed");
        }
        let persistedMarkdownReadback = "";
        if (
          isDocumentSaveScope &&
          typeof data?.documentMarkdownB64 === "string" &&
          data.documentMarkdownB64.length > 0
        ) {
          try {
            persistedMarkdownReadback = decodeMarkdownBase64(
              data.documentMarkdownB64,
            );
          } catch (_error) {
            persistedMarkdownReadback = "";
          }
        }
        if (!persistedMarkdownReadback) {
          persistedMarkdownReadback = await fetchPersistedMarkdownReadback(
            state.payloadMeta.pageId || "0",
            state.lang,
          );
        }
        emitStageMarkdownDiagnostic(
          "readback_raw_backend",
          persistedMarkdownReadback,
          {
            stateId: state.id,
            language: state.lang,
            scopeKind: saveScope,
          },
        );
        const persistedSplit = splitLeadingFrontmatter(
          persistedMarkdownReadback,
        );
        const readbackScopeMeta = {
          scopeKind: saveScope,
          section: saveMdSection,
          subsection: saveMdSubsection,
          name: saveMdName,
        };
        const sentComparableMarkdown = isDocumentSaveScope
          ? finalCanonicalBody
          : readScopedComparableFromCanonicalBody(finalCanonicalBody, {
              scopeKind: saveScope,
              section: saveMdSection,
              subsection: saveMdSubsection,
              name: saveMdName,
            });
        const persistedComparableMarkdown = isDocumentSaveScope
          ? persistedSplit.body
          : readScopedComparableFromCanonicalBody(
              persistedSplit.body,
              readbackScopeMeta,
            );
        const sentComparableCanonical = normalizeLineEndingsToLf(
          normalizeCanonicalReadbackText(sentComparableMarkdown),
        );
        const persistedComparableCanonical = normalizeLineEndingsToLf(
          normalizeCanonicalReadbackText(persistedComparableMarkdown),
        );
        emitStageMarkdownDiagnostic(
          "readback_canonicalized_compare",
          persistedComparableCanonical,
          {
            stateId: state.id,
            language: state.lang,
            scopeKind: saveScope,
          },
        );
        const readbackClassification = classifyReadbackMismatch(
          sentComparableCanonical,
          persistedComparableCanonical,
        );
        const firstDiffOffset = Math.max(
          0,
          Number(readbackClassification?.firstDiffOffset || 0),
        );
        const diffWindowStart = Math.max(0, firstDiffOffset - 40);
        const diffWindowSent = sentComparableCanonical.slice(
          diffWindowStart,
          diffWindowStart + 120,
        );
        const diffWindowPersisted = persistedComparableCanonical.slice(
          diffWindowStart,
          diffWindowStart + 120,
        );
        emitRuntimeShapeLog("MFE_CANONICAL_READBACK_DIFF_WINDOW", {
          stateId: state.id,
          language: state.lang,
          scopeKind: saveScope,
          firstDiffOffset,
          tokenBefore: String(readbackClassification?.tokenBefore || ""),
          tokenAfter: String(readbackClassification?.tokenAfter || ""),
          diffWindowStart,
          sentWindowEscaped: escapeMarkdownPreview(diffWindowSent),
          persistedWindowEscaped: escapeMarkdownPreview(diffWindowPersisted),
        });
        const listIndentationShapeDrift = hasListIndentationShapeDrift(
          sentComparableCanonical,
          persistedComparableCanonical,
        );
        emitDocStateLog("SAVE_READBACK_CLASSIFIED", {
          stateId: state.id,
          language: state.lang,
          originKey: state.originKey,
          currentScope: saveScope,
          reason: "saveAllEditors:readbackClassified",
          trigger: "save-commit",
          mode: saveMode,
          stateScopeKind,
          class: readbackClassification.className,
          firstDiffOffset: readbackClassification.firstDiffOffset,
          firstDiffOffsetRaw: readbackClassification.firstDiffOffsetRaw,
          firstSemanticDiffOffset:
            readbackClassification.firstSemanticDiffOffset,
          sentContext: readbackClassification.sentContext,
          persistedContext: readbackClassification.persistedContext,
          rawSentContext: readbackClassification.rawSentContext,
          rawPersistedContext: readbackClassification.rawPersistedContext,
          semanticContextSent: readbackClassification.semanticContextSent,
          semanticContextPersisted:
            readbackClassification.semanticContextPersisted,
          ...(readbackClassification.className === "text_token_drift"
            ? {
                tokenBefore: readbackClassification.tokenBefore,
                tokenAfter: readbackClassification.tokenAfter,
              }
            : {}),
          listIndentationShapeDrift,
          sentComparableNewlineDiagnostics: buildNewlineDiagnostics(
            sentComparableMarkdown,
          ),
          persistedComparableNewlineDiagnostics: buildNewlineDiagnostics(
            persistedComparableMarkdown,
          ),
          sentCanonicalNewlineDiagnostics: buildNewlineDiagnostics(
            sentComparableCanonical,
          ),
          persistedCanonicalNewlineDiagnostics: buildNewlineDiagnostics(
            persistedComparableCanonical,
          ),
        });
        if (
          readbackClassification.className === "style_only_normalization" &&
          listIndentationShapeDrift
        ) {
          emitDocStateLog("MFE_BACKEND_MARKDOWN_CAPABILITY_GAP", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:backendCapabilityGap:listIndentation",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            class: readbackClassification.className,
            subtype: "nested_list_indentation",
          });
          if (!backendCapabilityWarningShown && state.lang === currentLang) {
            debugWarn("[mfe:save] backend normalized nested list indentation", {
              stateId: state.id,
              language: state.lang,
            });
            backendCapabilityWarningShown = true;
          }
        }
        const readbackCompare = compareReadbackMarkdown({
          sent: sentComparableCanonical,
          persisted: persistedComparableCanonical,
        });
        const semanticReadback = compareReadbackSemanticAst(
          sentComparableCanonical,
          persistedComparableCanonical,
          primaryEditor?.schema || activeEditor?.schema || null,
          {
            firstDiffOffset: readbackClassification.firstDiffOffset,
            tokenBefore: readbackClassification.tokenBefore,
            tokenAfter: readbackClassification.tokenAfter,
          },
        );
        const readbackMatches = Boolean(readbackCompare.matches);
        if (!readbackMatches) {
          emitDocStateLog("SAVE_READBACK_MISMATCH", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:readbackMismatch",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            sentBytes: sentComparableMarkdown.length,
            persistedBytes: persistedComparableMarkdown.length,
            firstDiffOffset: readbackClassification.firstDiffOffset,
            firstDiffOffsetRaw: readbackClassification.firstDiffOffsetRaw,
            firstSemanticDiffOffset:
              readbackClassification.firstSemanticDiffOffset,
            sentContext: readbackClassification.sentContext,
            persistedContext: readbackClassification.persistedContext,
            rawSentContext: readbackClassification.rawSentContext,
            rawPersistedContext: readbackClassification.rawPersistedContext,
            semanticContextSent: readbackClassification.semanticContextSent,
            semanticContextPersisted:
              readbackClassification.semanticContextPersisted,
            class: readbackClassification.className,
            ...(readbackClassification.className === "text_token_drift"
              ? {
                  tokenBefore: readbackClassification.tokenBefore,
                  tokenAfter: readbackClassification.tokenAfter,
                }
              : {}),
          });
          if (readbackClassification.className === "text_token_drift") {
            emitDocStateLog("SAVE_READBACK_SEMANTIC_DRIFT", {
              stateId: state.id,
              language: state.lang,
              originKey: state.originKey,
              currentScope: saveScope,
              reason: "saveAllEditors:readbackSemanticDrift",
              trigger: "save-commit",
              mode: saveMode,
              stateScopeKind,
              class: readbackClassification.className,
              firstDiffOffset: readbackClassification.firstDiffOffset,
              firstDiffOffsetRaw: readbackClassification.firstDiffOffsetRaw,
              firstSemanticDiffOffset:
                readbackClassification.firstSemanticDiffOffset,
              sentContext: readbackClassification.sentContext,
              persistedContext: readbackClassification.persistedContext,
              rawSentContext: readbackClassification.rawSentContext,
              rawPersistedContext: readbackClassification.rawPersistedContext,
              semanticContextSent: readbackClassification.semanticContextSent,
              semanticContextPersisted:
                readbackClassification.semanticContextPersisted,
              tokenBefore: readbackClassification.tokenBefore,
              tokenAfter: readbackClassification.tokenAfter,
            });
          }
          const sentRawPreview = buildEdgePreview(sentComparableMarkdown, 200);
          const sentCanonicalPreview = buildEdgePreview(
            sentComparableCanonical,
            200,
          );
          const persistedRawPreview = buildEdgePreview(
            persistedComparableMarkdown,
            200,
          );
          const persistedCanonicalPreview = buildEdgePreview(
            persistedComparableCanonical,
            200,
          );
          emitRuntimeShapeLog("MFE_SERVER_CANONICALIZATION_DRIFT_DEBUG", {
            stateId: state.id,
            language: state.lang,
            scopeKind: saveScope,
            readbackClass: String(readbackClassification.className || ""),
            sentMarkdownHash: hashStateIdentity(sentComparableMarkdown),
            sentCanonicalHash: hashStateIdentity(sentComparableCanonical),
            persistedRawHash: hashStateIdentity(persistedComparableMarkdown),
            persistedCanonicalHash: hashStateIdentity(
              persistedComparableCanonical,
            ),
            sentMarkdownFirst200Escaped: sentRawPreview.firstEscaped,
            sentMarkdownLast200Escaped: sentRawPreview.lastEscaped,
            sentCanonicalFirst200Escaped: sentCanonicalPreview.firstEscaped,
            sentCanonicalLast200Escaped: sentCanonicalPreview.lastEscaped,
            persistedRawFirst200Escaped: persistedRawPreview.firstEscaped,
            persistedRawLast200Escaped: persistedRawPreview.lastEscaped,
            persistedCanonicalFirst200Escaped:
              persistedCanonicalPreview.firstEscaped,
            persistedCanonicalLast200Escaped:
              persistedCanonicalPreview.lastEscaped,
            firstDiffOffset: Number(
              readbackClassification.firstDiffOffset || -1,
            ),
            tokenBefore: String(readbackClassification.tokenBefore || ""),
            tokenAfter: String(readbackClassification.tokenAfter || ""),
            semanticAstComparable: Boolean(semanticReadback.comparable),
            semanticAstEquivalent: Boolean(semanticReadback.equivalent),
            semanticAstSentReason: String(semanticReadback.sentReason || ""),
            semanticAstPersistedReason: String(
              semanticReadback.persistedReason || "",
            ),
            sentNearestSyntaxNode: semanticReadback.sentNearestSyntaxNode,
            persistedNearestSyntaxNode:
              semanticReadback.persistedNearestSyntaxNode,
          });
        } else {
          emitDocStateLog("SAVE_READBACK_MATCH", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:readbackMatch",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            sentBytes: sentComparableMarkdown.length,
            persistedBytes: persistedComparableMarkdown.length,
          });
        }
        const structuralGraphReadback = assertStructuralMarkerGraphEqual(
          finalCanonicalBody,
          persistedSplit.body,
        );
        const structuralGraphDrift = !structuralGraphReadback.ok;
        if (structuralGraphDrift) {
          emitDocStateLog("SAVE_READBACK_STRUCTURAL_DRIFT", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:readbackStructuralDrift",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            graphReason: String(structuralGraphReadback.reason || "unknown"),
            beforeCount: Number(structuralGraphReadback.beforeCount || 0),
            afterCount: Number(structuralGraphReadback.afterCount || 0),
            mismatchIndex: Number(structuralGraphReadback.index || -1),
          });
        }

        const markerCountBefore = parseMarkersWithOffsets(
          normalizeCanonicalReadbackText(preSavePersistedSplit.body),
        ).length;
        const markerCountAfter = parseMarkersWithOffsets(
          normalizeCanonicalReadbackText(persistedSplit.body),
        ).length;
        const markerCountSentCanonical = parseMarkersWithOffsets(
          normalizeCanonicalReadbackText(finalCanonicalBody),
        ).length;
        const markerCountDrift = markerCountBefore !== markerCountAfter;
        if (markerCountDrift) {
          emitDocStateLog("MARKER_COUNT_DRIFT", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:markerCountDrift",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            markerCountBefore,
            markerCountAfter,
          });
        }
        const markerCountDriftSentCanonical =
          markerCountSentCanonical !== markerCountAfter;
        if (markerCountDriftSentCanonical) {
          emitDocStateLog("MARKER_COUNT_DRIFT_SENT_CANONICAL", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:markerCountDriftSentCanonical",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            markerCountSentCanonical,
            markerCountAfter,
            class: readbackClassification.className,
            firstDiffOffset: readbackClassification.firstDiffOffset,
            firstDiffOffsetRaw: readbackClassification.firstDiffOffsetRaw,
            firstSemanticDiffOffset:
              readbackClassification.firstSemanticDiffOffset,
            sentContext: readbackClassification.sentContext,
            persistedContext: readbackClassification.persistedContext,
            rawSentContext: readbackClassification.rawSentContext,
            rawPersistedContext: readbackClassification.rawPersistedContext,
          });
        }
        const markerBaseline = ensureLanguageMarkerBaseline(
          state,
          "saveAllEditors:markerBaseline",
        );
        const markerCountDriftLang = markerCountAfter !== markerBaseline;
        if (markerCountDriftLang) {
          emitDocStateLog("MARKER_COUNT_DRIFT_LANG", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:markerCountDriftLang",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            markerBaseline,
            markerCountAfter,
          });
        }

        const nonExactReadback =
          !readbackMatches || readbackCompare.normalizedBy !== "exact";
        const hasReadbackListTopologyDrift = hasListTopologyDrift(
          sentComparableCanonical,
          persistedComparableCanonical,
        );
        const isStyleNormalizationClass =
          readbackClassification.className === "style_only_normalization" ||
          readbackClassification.className === "marker_blankline_normalization";
        const hasSemanticAnchorDrift =
          readbackClassification.firstSemanticDiffOffset !== -1 ||
          readbackClassification.className === "text_token_drift";
        const semanticEquivalentByAst = Boolean(
          semanticReadback.comparable && semanticReadback.equivalent,
        );
        const hasSemanticReadbackDrift =
          (hasSemanticAnchorDrift && !semanticEquivalentByAst) ||
          (hasReadbackListTopologyDrift && !isStyleNormalizationClass) ||
          (listIndentationShapeDrift && !isStyleNormalizationClass);
        if (nonExactReadback && semanticEquivalentByAst) {
          emitDocStateLog("SAVE_READBACK_AST_EQUIVALENT", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:readbackAstEquivalent",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            class: readbackClassification.className,
            firstDiffOffset: readbackClassification.firstDiffOffset,
            firstSemanticDiffOffset:
              readbackClassification.firstSemanticDiffOffset,
          });
        }
        if (nonExactReadback && !hasSemanticReadbackDrift) {
          emitDocStateLog("SAVE_READBACK_STYLE_NORMALIZATION_OBSERVED", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:readbackStyleNormalizationObserved",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            class: readbackClassification.className,
            firstDiffOffset: readbackClassification.firstDiffOffset,
            firstDiffOffsetRaw: readbackClassification.firstDiffOffsetRaw,
            firstSemanticDiffOffset:
              readbackClassification.firstSemanticDiffOffset,
          });
        }
        const blockedReadbackMismatch =
          nonExactReadback && hasSemanticReadbackDrift;
        const unsupportedFeatures = detectUnsupportedMarkdownFeatures(
          sentComparableCanonical,
        );
        const documentTokenDriftObserved =
          isDocumentSaveScope &&
          readbackClassification.className === "text_token_drift";
        if (blockedReadbackMismatch) {
          emitDocStateLog("SAVE_SERVER_NORMALIZATION_VIOLATION", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:serverNormalizationViolation",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            class: readbackClassification.className,
            tokenBefore: String(readbackClassification.tokenBefore || ""),
            tokenAfter: String(readbackClassification.tokenAfter || ""),
            firstDiffOffset: readbackClassification.firstDiffOffset,
            firstSemanticDiffOffset:
              readbackClassification.firstSemanticDiffOffset,
            semanticAstEquivalent: semanticEquivalentByAst,
            unsupportedFeatures,
          });
          emitDocStateLog("SAVE_READBACK_MISMATCH_BLOCKED", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:readbackMismatchBlocked",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            class: readbackClassification.className,
            semanticAstEquivalent: semanticEquivalentByAst,
            unsupportedFeatures,
          });
        }
        if (documentTokenDriftObserved) {
          emitDocStateLog("SAVE_READBACK_DOCUMENT_TOKEN_DRIFT_OBSERVED", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:readbackDocumentTokenDriftObserved",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
            class: readbackClassification.className,
            tokenBefore: String(readbackClassification.tokenBefore || ""),
            tokenAfter: String(readbackClassification.tokenAfter || ""),
            firstDiffOffset: readbackClassification.firstDiffOffset,
            firstSemanticDiffOffset:
              readbackClassification.firstSemanticDiffOffset,
          });
        }
        const verificationFailed =
          blockedReadbackMismatch ||
          markerCountDriftSentCanonical ||
          structuralGraphDrift;
        if (verificationFailed) {
          if (blockedReadbackMismatch) {
            if (unsupportedFeatures.includes("inline_footnote")) {
              throw new Error(
                "[mfe] save blocked: backend does not preserve inline footnote syntax (^[]).",
              );
            }
            throw new Error(
              "[mfe] save blocked: persisted markdown differs from sent markdown",
            );
          }
          if (markerCountDriftSentCanonical) {
            throw new Error(
              "[mfe] save blocked: persistence mutated marker topology",
            );
          }
          if (structuralGraphDrift) {
            throw new Error(
              "[mfe] save blocked: persistence mutated marker topology",
            );
          }
          throw new Error(
            "[mfe] save readback verification failed for language",
          );
        }

        if (state.lang === currentLang) {
          const saveUiMarkdown =
            saveScope === "document"
              ? finalCanonicalBody
              : scopedEditedMarkdown;
          const preserveSentDocumentCache =
            isDocumentStateKind &&
            (readbackCompare.normalizedBy ===
              "marker_blankline_normalization" ||
              readbackClassification.className === "text_token_drift");
          if (preserveSentDocumentCache) {
            emitDocStateLog(
              "SAVE_READBACK_MARKER_BLANKLINE_CANONICAL_PRESERVED",
              {
                stateId: state.id,
                language: state.lang,
                originKey: state.originKey,
                currentScope: saveScope,
                reason: "saveAllEditors:readbackMarkerBlanklinePreserveSent",
                trigger: "save-commit",
                mode: saveMode,
                stateScopeKind,
              },
            );
          }
          await handlePrimarySaveResponse({
            data,
            finalMarkdown: saveUiMarkdown,
            options: {
              updateActiveEditor: true,
              documentCacheFallbackB64: isDocumentScopeActive()
                ? encodeMarkdownBase64(finalCanonicalMarkdown)
                : "",
              preferDocumentCacheFallback: preserveSentDocumentCache,
              savedScopeKind: saveScope,
            },
            activeFieldScope,
            activeFieldId,
            activeTarget,
            primaryEditor,
            statusManager,
            primaryDraftsByFieldId,
            draftMarkdownByScopedKey,
            getActiveScopedHtmlKey,
            syncDirtyStatusForActiveField,
            setDocumentDraftMarkdown: (value) => {
              documentDraftMarkdown = value;
            },
            traceStateMutation,
            writeDocumentMarkdownCache,
            requestRenderedFragments: (params) =>
              requestRenderedFragmentsDatastar({
                ...params,
                patchCycleCounter: {
                  next: () => ++patchCycleCounter,
                },
                hasPendingUnsavedChanges,
                resolveHostImageSrc,
                debugWarn,
                debugInfo,
                isInlineOpen,
                draftScopedKeys: Array.from(draftMarkdownByScopedKey.keys()),
              }),
            setLastCompileReport: (value) => {
              lastCompileReport = value;
            },
            getLanguagesConfig,
            resolveHostImageSrc,
            debugWarn,
            debugInfo,
            debugTable,
            isDevMode,
            annotateBoundImages,
            initEditors,
            setActiveMarkdownState: ({ rawMarkdown, displayMarkdown }) => {
              activeRawMarkdown = rawMarkdown;
              activeDisplayMarkdown = displayMarkdown;
            },
            enforceBodyOnlyEditorInput,
            sanitizeEditorMarkdownForScope,
            decodeMaybeB64,
            encodeMarkdownBase64,
            normalizeCanonicalMarkdownForIngress,
            normalizeScopeKind,
            normalizeLangValue,
            runWithoutDirtyTracking,
            getMetaAttr,
          });
        }
        const markSavedOk = state.markSaved(finalCanonicalBody, {
          reason: "saveAllEditors:markStateSaved",
          trigger: "save-commit",
          readbackClassification,
          readbackClass: readbackClassification.className,
        });
        if (!markSavedOk) {
          emitDocStateLog("SAVE_COMMIT_ASSERT_FAIL", {
            stateId: state.id,
            language: state.lang,
            originKey: state.originKey,
            currentScope: saveScope,
            reason: "saveAllEditors:markStateSavedReturnedFalse",
            trigger: "save-commit",
            mode: saveMode,
            stateScopeKind,
          });
          throw new Error("[mfe] save blocked: unable to commit saved state");
        }
        results.push({
          ok: true,
          state,
          hasFragments: Boolean(data?.fragments),
        });
      } catch (error) {
        emitDocStateLog("STATE_SAVE_FAILED", {
          stateId: state.id,
          language: state.lang,
          originKey: state.originKey,
          currentScope: state.currentScope || activeFieldScope || "",
          reason: "saveAllEditors:languageFailed",
          trigger: "save-commit",
          dirtyBefore: state.isDirty(),
          dirtyAfter: state.isDirty(),
          hashBefore: "save-failed",
          hashAfter: "save-failed",
          error: String(error?.message || error || "save-failed"),
        });
        results.push({
          ok: false,
          state,
          error,
          hasFragments: false,
        });
      }
    }
    return results;
  })()
    .then((results) => {
      const { failed, savedStateIds, hasFragments } =
        summarizeSaveResults(results);
      if (isFullscreenOpen() && failed.length === 0) {
        clearGlobalToast();
        traceStateMutation({
          reason: hadExplicitDirtyBeforeSave
            ? "saveAllEditors:setSaved"
            : "saveAllEditors:setNoChangesAfterSave",
          trigger: "save-commit",
          mutate: () => {
            statusManager.clearAllDirty();
            if (hadExplicitDirtyBeforeSave) {
              statusManager.setSaved();
            } else {
              statusManager.setNoChanges();
            }
          },
        });
      } else if (failed.length === 0) {
        showWindowToast(
          hasFragments ? "Image upload complete" : "Content saved",
          "success",
        );
      }
      emitStatesSavedBatch(savedStateIds, {
        language: normalizeLangValue(getLanguagesConfig().current) || "*",
        originKey:
          activeOriginFieldKey || activeOriginKey || activeFieldId || "batch",
        currentScope: activeFieldScope || "",
        reason: "saveAllEditors:batch",
        trigger: "save-commit",
      });
      if (failed.length > 0) {
        const failureMessage = String(
          failed[0]?.error?.message || `${failed.length} language save failed`,
        );
        if (isFullscreenOpen()) {
          clearGlobalToast();
          traceStateMutation({
            reason: "saveAllEditors:setError",
            trigger: "save-commit",
            mutate: () => {
              statusManager.setError();
            },
          });
          debugWarn("[mfe:save] failure", failureMessage);
        } else {
          showWindowToast("Save failed", "alert", { persistent: true });
        }
        return false;
      }
      return true;
    })
    .catch((error) => {
      emitRuntimeShapeLog("MFE_SAVE_LOOP_ERROR", {
        errorMsg: String(error?.message || "unknown"),
        errorStack: String(error?.stack || "").slice(0, 500),
      });
      console.error("[mfe] Save promise error:", error);
      if (isFullscreenOpen()) {
        clearGlobalToast();
        traceStateMutation({
          reason: "saveAllEditors:setError",
          trigger: "save-commit",
          mutate: () => {
            statusManager.setError();
          },
        });
        debugWarn("[mfe:save] promise rejected", String(error?.message || ""));
      } else {
        showWindowToast("Save failed", "alert", { persistent: true });
      }
      return false;
    })
    .finally(() => {
      if (pendingSavePromise === run) {
        traceStateMutation({
          reason: "saveAllEditors:clearPendingPromise",
          trigger: "save-commit",
          mutate: () => {
            pendingSavePromise = null;
            syncDirtyStatusForActiveField();
          },
        });
      }
    });
  traceStateMutation({
    reason: "saveAllEditors:setPendingPromise",
    trigger: "save-commit",
    mutate: () => {
      pendingSavePromise = run;
    },
  });
  return pendingSavePromise;
}

/**
 * Applies split-pane presentation sizing for the fullscreen shell.
 * Does not bind translation state or mutate canonical document authority.
 */
function applySplitSecondarySize(percent) {
  return applySplitSecondarySizeHelper({
    percent,
    editorShell,
    setSplitSecondarySizePercent: (value) => {
      splitSecondarySizePercent = value;
    },
  });
}

/**
 * Hydrates translation-side document states used by the split pane.
 * Does not decide secondary editor authority or save routing.
 */
function hydrateTranslationsForActiveScope(reasonPrefix = "openSplit") {
  return hydrateTranslationsForActiveScopeHelper({
    reasonPrefix,
    buildTranslationHydrationKey,
    getActiveSessionStateKey,
    activeOriginFieldKey,
    activeOriginKey,
    activeFieldId,
    activeTarget,
    activeFieldScope,
    activeFieldSection,
    activeFieldSubsection,
    activeFieldName,
    pendingTranslationHydrationByKey,
    normalizeLangValue,
    getLanguagesConfig,
    fetchTranslations,
    isStateTraceEnabled,
    getDocumentStateForActiveField,
    ingestDocumentStateMarkdown,
  });
}

/**
 * Installs split-pane resize handlers for the fullscreen chrome.
 * Does not create panes or own editor lifecycle authority.
 */
function setupSplitResizeHandle() {
  return setupSplitResizeHandleHelper({
    splitHandle,
    editorShell,
    splitResizeCleanup,
    fullscreenEventRegistry,
    onResizePercent: applySplitSecondarySize,
    setSplitResizeEventScope: (value) => {
      splitResizeEventScope = value;
    },
    setSplitResizeCleanup: (value) => {
      splitResizeCleanup = value;
    },
  });
}

/**
 * Opens the fullscreen split-pane chrome and secondary editor shell.
 * Does not own secondary language mutation authority.
 */
function openSplit() {
  return openSplitHelper({
    editorShell,
    secondaryEditor,
    getLanguagesConfig,
    normalizeLangValue,
    splitPreferredLanguage,
    splitSecondarySizePercent,
    applySplitSecondarySize,
    createEditorInstance,
    activeFieldType,
    activeFieldName,
    refreshToolbarState,
    setupSplitResizeHandle,
    hydrateTranslationsForActiveScope,
    setSecondaryLanguage,
    setSplitRegion: (value) => {
      splitRegion = value;
    },
    setSplitHandle: (value) => {
      splitHandle = value;
    },
    setSplitPane: (value) => {
      splitPane = value;
    },
    setSecondaryEditor: (value) => {
      secondaryEditor = value;
    },
    setActiveEditor: (value) => {
      activeEditor = value;
    },
    getSecondaryEditor: () => secondaryEditor,
  });
}

/**
 * Closes the fullscreen split-pane chrome and destroys the secondary editor shell.
 * Does not clear translation document state ownership.
 */
function closeSplit() {
  return closeSplitHelper({
    splitResizeCleanup,
    secondaryEditor,
    splitRegion,
    editorShell,
    primaryEditor,
    refreshToolbarState,
    setSecondaryEditor: (value) => {
      secondaryEditor = value;
    },
    setSplitRegion: (value) => {
      splitRegion = value;
    },
    setSplitPane: (value) => {
      splitPane = value;
    },
    setSplitHandle: (value) => {
      splitHandle = value;
    },
    setActiveEditor: (value) => {
      activeEditor = value;
    },
  });
}

function setSecondaryLanguage(lang) {
  if (!secondaryEditor) return;
  secondaryLang = lang;
  splitPreferredLanguage = normalizeLangValue(lang);
  revokeRuntimeProjectionAuthorityForEditor(
    secondaryEditor,
    "setSecondaryLanguage:scopeRebind",
  );
  const state = getDocumentStateForActiveField(lang, {
    reason: "setSecondaryLanguage:bind",
    trigger: "scope-navigation",
    initialPersistedMarkdown: "",
    initialDraftMarkdown: "",
  });
  activeDocumentState = state;
  const activeScopeMeta = captureExplicitApplyScopeMeta(
    "setSecondaryLanguage",
  );
  const canonicalScopeMeta = buildCanonicalSessionScopeMeta({
    scopeKind: activeScopeMeta.scopeKind || activeFieldScope || "field",
    section: activeScopeMeta.section || activeFieldSection || "",
    subsection: activeScopeMeta.subsection || activeFieldSubsection || "",
    name: activeScopeMeta.name || activeFieldName || "",
  });
  const canonicalSession = state
    ? setCanonicalMutationSessionForState(
        state.id,
        String(state.getDraft() || ""),
        canonicalScopeMeta,
      )
    : null;
  const scopeSliceMarkdown = enforceBodyOnlyEditorInput(
    readScopeSliceForScopeMeta(
      lang,
      activeScopeMeta,
      "setSecondaryLanguage:read",
    ),
    {
      source: "setSecondaryLanguage",
      lang,
      scope: activeFieldScope || "field",
    },
  );
  const markdown = canonicalSession
    ? String(canonicalSession?.projection?.displayText || "")
    : scopeSliceMarkdown;
  const sanitizedMarkdown = sanitizeEditorMarkdownForScope(
    markdown,
    activeFieldScope,
  );
  runWithoutDirtyTracking(() => {
    const doc = parseMarkdownToDoc(
      sanitizedMarkdown || "",
      secondaryEditor.schema,
    );
    secondaryEditor.commands.setContent(doc.toJSON(), false);
  });
  if (shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    runWithoutDirtyTracking(() => {
      stripTrailingEmptyParagraph(secondaryEditor);
    });
  }
  if (canonicalSession && state) {
    const runtimeProjection =
      canonicalSession?.runtimeProjection ||
      canonicalSession?.projection ||
      null;
    const canonicalProjectionDisplay = normalizeLineEndingsToLf(
      String(runtimeProjection?.displayText || ""),
    );
    const secondaryBoundaryProjection = stampProjectionIdentityForSession(
      String(state.id || ""),
      canonicalSession?.scopeMeta,
      canonicalSession?.scopeSlice?.protectedSpans,
      buildProjectionWithResolvedMarkerAnchors(secondaryEditor, {
        displayText: canonicalProjectionDisplay,
        segmentMap: Array.isArray(runtimeProjection?.segmentMap)
          ? runtimeProjection.segmentMap
          : [],
        protectedSpans: Array.isArray(runtimeProjection?.protectedSpans)
          ? runtimeProjection.protectedSpans
          : Array.isArray(canonicalSession?.scopeSlice?.protectedSpans)
            ? canonicalSession.scopeSlice.protectedSpans
            : [],
        editableBoundaries: Array.isArray(runtimeProjection?.editableBoundaries)
          ? runtimeProjection.editableBoundaries
          : [],
        boundaryDocPositions: Array.isArray(
          runtimeProjection?.boundaryDocPositions,
        )
          ? runtimeProjection.boundaryDocPositions
          : [],
        projectionMeta:
          runtimeProjection?.projectionMeta &&
          typeof runtimeProjection.projectionMeta === "object"
            ? runtimeProjection.projectionMeta
            : {
                updateMode: "deterministic-recompute",
                deterministicRecomputeCount: 0,
                mappingUpdateCount: 0,
                runtimeBoundariesTrusted: true,
              },
      }),
    );
    writeDocumentBoundaryProjection(
      secondaryEditor,
      secondaryBoundaryProjection,
    );
    const seededBuffer = String(getMarkdownFromEditor(secondaryEditor) || "");
    syncCanonicalProjectionRuntimeForEditor(
      String(state.id || ""),
      secondaryEditor,
      seededBuffer,
    );
    performCanonicalSeedNormalizationHandshake(
      String(state.id || ""),
      secondaryEditor,
    );
  }
  setOriginalBlockCount(
    secondaryEditor,
    activeFieldType,
    activeFieldName,
    originalBlockCounts,
  );
  highlightExtraContent(secondaryEditor);

  if (state) {
    const stateDraft = String(state.getDraft() || "");
    const scopeKind = normalizeScopeKind(activeFieldScope || "field");
    const isStructuralScope = isStructuralScopeKind(scopeKind);
    if (
      isStructuralScope &&
      normalizeComparableMarkdown(String(markdown || "")) !==
        normalizeComparableMarkdown(stateDraft)
    ) {
      emitDocStateLog("MFE_SPLIT_STRUCTURAL_INGEST_BLOCKED", {
        stateId: state.id,
        language: lang,
        originKey: state.originKey,
        currentScope: activeFieldScope || scopeKind,
        reason: "setSecondaryLanguage:structuralIngestBlocked",
        trigger: "system-rehydrate",
        scopeKind,
      });
    }
  }
}

/**
 * Toggles split-pane chrome visibility for fullscreen language editing.
 * Does not bind the secondary editor to canonical state authority.
 */
function toggleSplit() {
  return toggleSplitHelper({
    secondaryEditor,
    setSplitEnabledByUser: (value) => {
      splitEnabledByUser = value;
    },
    openSplit,
    closeSplit,
  });
}

function toggleOutlineView() {
  const enable = !isOutlineViewActive();
  outlinePersistForSession = Boolean(enable);
  applyEditorViewMode(enable ? "document" : "scoped");
}

function openDocumentFromBreadcrumbPath() {
  if (!activeTarget) return;
  const pageId = activeTarget.getAttribute("data-page") || "0";
  const canonicalState = getCanonicalMarkdownState();
  const canonicalMarkdown = String(canonicalState?.markdown || "");
  const markdown = canonicalMarkdown || getDocumentConfigMarkdownRaw();
  const virtual = createVirtualDocumentTarget({
    pageId,
    markdown,
    originKey: String(activeOriginFieldKey || activeOriginKey || ""),
  });
  openFullscreenEditorForElement(virtual);
}

function openDocumentOutlineView() {
  outlinePersistForSession = true;
  applyEditorViewMode("document");
  if (isDocumentScopeActive()) return;
  scopedModeTarget = activeTarget || null;
  scopedModeMarkdown = primaryEditor
    ? getMarkdownFromEditor(primaryEditor)
    : "";
  openDocumentFromBreadcrumbPath();
  afterNextPaint(() => applyEditorViewMode("document"));
}

function normalizeLangValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function emitApplyScopeRoutingBug(detail = {}) {
  const payload = {
    currentScope: String(detail.currentScope || ""),
    incomingScopeKind: String(detail.incomingScopeKind || ""),
    resolvedApplyScopeKind: String(detail.resolvedApplyScopeKind || ""),
    stateId: String(detail.stateId || ""),
    reason: String(detail.reason || "apply-scope-routing"),
  };
  if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error("MFE_APPLY_SCOPE_ROUTING_BUG", JSON.stringify(payload));
  }
  emitDocStateLog("MFE_APPLY_SCOPE_ROUTING_BUG", {
    stateId: payload.stateId,
    currentScope: payload.currentScope,
    incomingScopeKind: payload.incomingScopeKind,
    resolvedApplyScopeKind: payload.resolvedApplyScopeKind,
    reason: payload.reason,
    trigger: "routing-check",
  });
}

function resolveApplyScopeKind(scopeKind, reason = "") {
  const normalized = String(scopeKind || "")
    .trim()
    .toLowerCase();
  if (CANONICAL_SCOPE_SET.has(normalized)) {
    return normalized;
  }
  emitApplyScopeRoutingBug({
    currentScope: activeFieldScope || "",
    incomingScopeKind: normalized,
    resolvedApplyScopeKind: "",
    stateId: activeDocumentState?.id || "",
    reason: reason || "resolveApplyScopeKind",
  });
  throw new Error(`[mfe] apply routing: invalid scope kind "${scopeKind}"`);
}

function resolveApplyScopeKindFromActiveScope(reason = "") {
  const currentScope = resolveApplyScopeKind(
    activeFieldScope || "",
    reason || "resolveApplyScopeKindFromActiveScope",
  );
  return currentScope;
}

/**
 * Capture the current UI scope once for mutation/save work.
 * Downstream edit/save code must reuse this snapshot instead of re-reading globals.
 */
function captureExplicitApplyScopeMeta(reason = "") {
  const scopeMeta = getActiveApplyScopeMeta();
  return {
    ...scopeMeta,
    scopeKind: resolveApplyScopeKind(
      scopeMeta.scopeKind || activeFieldScope || "field",
      `${reason || "captureExplicitApplyScopeMeta"}:scopeKind`,
    ),
  };
}

function getActiveApplyScopeMeta() {
  const scopeKind = resolveApplyScopeKindFromActiveScope(
    "getActiveApplyScopeMeta",
  );

  const originScopeMeta = parseOriginScopeMeta(
    activeOriginKey || activeFieldId || activeOriginFieldKey || "",
  );
  const originSection = String(originScopeMeta?.section || "");
  const originSubsection = String(originScopeMeta?.subsection || "");
  let resolvedSection = activeFieldSection || originSection;
  let resolvedSubsection = activeFieldSubsection || originSubsection;

  if (originScopeMeta) {
    if (scopeKind === "field") {
      resolvedSection = originSection || resolvedSection;
      resolvedSubsection = originSubsection;
    } else if (scopeKind === "section") {
      resolvedSection = originSection || resolvedSection;
      resolvedSubsection = "";
    } else if (scopeKind === "subsection") {
      resolvedSection = originSection || resolvedSection;
      resolvedSubsection = originSubsection || resolvedSubsection;
    }
  }

  let name = activeFieldName || String(originScopeMeta?.name || "");
  if (scopeKind === "section") {
    name = resolvedSection || String(originScopeMeta?.name || "") || name;
  } else if (scopeKind === "subsection") {
    name = resolvedSubsection || String(originScopeMeta?.name || "") || name;
  }

  return {
    scopeKind,
    currentScope: scopeKind,
    section: resolvedSection,
    subsection: resolvedSubsection,
    name,
    originKey: String(
      activeOriginKey || activeFieldId || activeOriginFieldKey || "",
    ),
  };
}

function readScopeSliceFromMarkdown(markdown, scopeMeta) {
  return readScopeSliceFromMarkdownCore(markdown, scopeMeta, {
    resolveMarkdownForScopeFromCanonical,
  });
}

/**
 * Read a scope slice using explicit scope metadata only.
 * Fullscreen reference flows must use this helper instead of ambient scope fallback.
 */
function readScopeSliceForScopeMeta(lang, scopeMeta, reason = "") {
  if (!scopeMeta || typeof scopeMeta !== "object" || !scopeMeta.scopeKind) {
    throw new Error(
      "[mfe] routing invariant: explicit scope metadata required for scope read",
    );
  }
  const state = getDocumentStateForActiveField(lang, {
    reason: `${reason || "readScopeSliceForScopeMeta"}:bind`,
    trigger: "scope-navigation",
  });
  if (!state) return "";
  const draftMarkdown = String(
    state.getDraft() || state.getPersistedMarkdown() || "",
  );
  return readScopeSliceFromMarkdown(draftMarkdown, scopeMeta);
}

/**
 * Read a scope slice using ambient active scope when no explicit scope is provided.
 * This helper is non-reference and should not be used by fullscreen mutation/save flows.
 */
function readScopeSliceUsingFallbackScope(
  lang,
  scopeMeta = getActiveApplyScopeMeta(),
  reason = "",
) {
  return readScopeSliceForScopeMeta(lang, scopeMeta, reason);
}

function revokeRuntimeProjectionAuthorityForEditor(editor, reason = "") {
  if (!editor) return false;
  const liveProjection = readDocumentBoundaryProjection(editor);
  const liveProjectionMeta =
    liveProjection?.projectionMeta && typeof liveProjection.projectionMeta === "object"
      ? liveProjection.projectionMeta
      : {};
  const liveStateId = String(liveProjectionMeta.stateId || "");
  if (liveStateId) {
    markCanonicalSessionRuntimeProjectionAuthority(
      liveStateId,
      "revoked",
      reason || "runtime-projection:revoked",
    );
  }
  emitDocStateLog("MFE_RUNTIME_PROJECTION_REVOKED", {
    stateId: liveStateId || String(activeDocumentState?.id || ""),
    language: String(activeDocumentState?.lang || ""),
    currentScope: String(
      liveProjectionMeta.scopeKey || activeFieldScope || "",
    ),
    reason: reason || "runtime-projection:revoked",
    trigger: "scope-navigation",
  });
  emitRuntimeProjectionAuthorityTransition({
    stateId: liveStateId || String(activeDocumentState?.id || ""),
    language: String(activeDocumentState?.lang || ""),
    currentScope: String(activeFieldScope || ""),
    reason: reason || "runtime-projection:revoked",
    trigger: "scope-navigation",
    scopeKey: String(liveProjectionMeta.scopeKey || ""),
    authorityState: "revoked",
    previousAuthorityState: String(liveProjectionMeta.authorityState || ""),
    physicalProjectionPresent: Boolean(liveProjection),
    runtimeBoundariesTrusted: Boolean(
      liveProjectionMeta.runtimeBoundariesTrusted,
    ),
    updateMode: String(liveProjectionMeta.updateMode || ""),
  });
  return writeDocumentBoundaryProjection(editor, null);
}

function applyScopeSlice(state, scopeMeta, scopedMarkdown, reason, trigger) {
  if (!state) return { ok: false, markdown: "" };
  const incomingScopeKind = resolveApplyScopeKind(
    scopeMeta?.scopeKind || "",
    `${reason || "applyScopeSlice"}:incomingScopeKind`,
  );
  const currentScope = resolveApplyScopeKind(
    scopeMeta?.currentScope || incomingScopeKind,
    `${reason || "applyScopeSlice"}:currentScope`,
  );
  const stateScopeKind = "document";
  if (
    stateScopeKind === "document" &&
    currentScope === "document" &&
    incomingScopeKind !== "document"
  ) {
    emitApplyScopeRoutingBug({
      currentScope,
      incomingScopeKind,
      resolvedApplyScopeKind: incomingScopeKind,
      stateId: state.id,
      reason: reason || "applyScopeSlice",
    });
    if (isDevMode()) {
      throw new Error(
        "[mfe] routing invariant: document scope update cannot use field-slice merge",
      );
    }
    return { ok: false, markdown: String(state.getDraft() || "") };
  }
  const before = String(state.getDraft() || state.getPersistedMarkdown() || "");
  scopedMarkdown = String(scopedMarkdown || "");
  let nextDraft = before;
  let mutationResult = null;
  const isLiveEditorUpdate = String(reason || "").startsWith("editor:update:");
  const normalizedScopedMarkdown =
    isLiveEditorUpdate && isStructuralScopeKind(incomingScopeKind)
      ? normalizeLineEndingsToLf(scopedMarkdown)
      : scopedMarkdown;
  const scopeMetaForMutation = {
    scopeKind: incomingScopeKind,
    section: scopeMeta?.section || "",
    subsection: scopeMeta?.subsection || "",
    name: scopeMeta?.name || "",
  };
  const strictSafetyThrow =
    String(reason || "").startsWith("saveAllEditors:") ||
    String(trigger || "") === "save-commit";
  const session = getScopeSessionForState(state.id);
  if (session && !doesScopeSessionMatch(session, scopeMetaForMutation)) {
    emitSaveSafetyBlocked({
      state,
      saveScope: incomingScopeKind,
      reason: `${reason || "applyScopeSlice"}:scopeSessionMismatch`,
      trigger: trigger || "user-command",
      scopeKeyExpected: buildScopeKeyFromMeta(scopeMetaForMutation),
      scopeKeyActual: String(session.scopeKey || ""),
    });
    if (strictSafetyThrow || isDevMode()) {
      throw createSaveSafetyBlockedError();
    }
    return { ok: false, markdown: before };
  }
  const structuralDoc = parseStructuralDocument(before);
  const stateLang = normalizeLangValue(String(state.lang || ""));
  const primaryLang = normalizeLangValue(getLanguagesConfig().current);
  const secondaryNormalizedLang = normalizeLangValue(secondaryLang);
  const editorForState =
    stateLang === primaryLang
      ? primaryEditor
      : stateLang === secondaryNormalizedLang
        ? secondaryEditor
        : activeEditor || primaryEditor;
  const scopeSession =
    session ||
    createScopeSession({
      stateId: String(state.id || ""),
      lang: String(state.lang || ""),
      originKey: String(state.originKey || ""),
      openedFrom: String(reason || "applyScopeSlice"),
      scopeMeta: scopeMetaForMutation,
    });
  const runtimeProjectionResolution = resolveValidatedRuntimeProjectionForMutation(
    {
      state,
      scopeMeta: scopeMetaForMutation,
      canonicalBody: before,
      editor: editorForState,
      reason: reason || "applyScopeSlice",
    },
  );
  const scopedEditResult = applyScopedEdit({
    session: scopeSession,
    structuralDocument: structuralDoc,
    editorContent: normalizedScopedMarkdown,
    runtimeProjection: runtimeProjectionResolution.runtimeProjection,
  });
  if (!scopedEditResult || scopedEditResult.ok === false) {
    throw new Error(
      String(scopedEditResult?.reason || "[mfe] mutation-plan failed"),
    );
  }
  nextDraft = String(scopedEditResult.canonicalBody || before);
  mutationResult = {
    canonicalBody: nextDraft,
    startOffset: Number(scopedEditResult.startOffset || 0),
    endOffset: Number(scopedEditResult.endOffset || 0),
    scopedComparableMarkdown: String(scopedEditResult.scopedComparableMarkdown || ""),
    scopedOutboundMarkdown: String(scopedEditResult.scopedOutboundMarkdown || ""),
  };
  if (hasMarkerLineBoundaryViolations(nextDraft)) {
    emitSaveSafetyBlocked({
      state,
      saveScope: incomingScopeKind,
      reason: `${reason || "applyScopeSlice"}:markerBoundaryAdjacency`,
      trigger: trigger || "user-command",
      scopeKeyExpected: buildScopeKeyFromMeta(scopeMetaForMutation),
      scopeKeyActual: String(scopeSession.scopeKey || ""),
    });
    if (strictSafetyThrow || isDevMode()) {
      throw createSaveSafetyBlockedError();
    }
    return { ok: false, markdown: before };
  }
  setCanonicalMutationSessionForState(state.id, nextDraft, {
    scopeKind: incomingScopeKind,
    section: scopeMeta?.section || "",
    subsection: scopeMeta?.subsection || "",
    name: scopeMeta?.name || "",
  });
  emitDocStateLog("MFE_MUTATION_PLAN_APPLIED", {
    stateId: state.id,
    language: state.lang,
    originKey: state.originKey,
    currentScope,
    reason: reason || "applyScopeSlice:mutationPlanApplied",
    trigger: trigger || "user-command",
    scopeKind: incomingScopeKind,
    scopeKey: String(scopeSession.scopeKey || ""),
    startOffset: mutationResult.startOffset,
    endOffset: mutationResult.endOffset,
  });

  const effectiveChangedRanges = computeChangedRanges(
    normalizeLineEndingsToLf(before),
    normalizeLineEndingsToLf(nextDraft),
  );
  const leakedRanges = effectiveChangedRanges.filter(
    (range) =>
      range.start < mutationResult.startOffset ||
      range.endBefore > mutationResult.endOffset,
  );
  emitDocStateLog("APPLY_DIFF_SUMMARY", {
    stateId: state.id,
    language: state.lang,
    originKey: state.originKey,
    currentScope,
    reason: reason || "applyScopeSlice:canonicalMutation",
    trigger: trigger || "user-command",
    scopeKind: incomingScopeKind,
    scopeName: scopeMeta?.name || "",
    scopeSection: scopeMeta?.section || "",
    scopeSubsection: scopeMeta?.subsection || "",
    expectedStart: mutationResult.startOffset,
    expectedEnd: mutationResult.endOffset,
    changedRangeCount: effectiveChangedRanges.length,
    leakedRangeCount: leakedRanges.length,
  });
  if (leakedRanges.length > 0) {
    throw new Error(
      "[mfe] apply scope leak: canonical mutation changed bytes outside target scope",
    );
  }

  state.setDraft(nextDraft, {
    reason: reason || "applyScopeSlice",
    trigger: trigger || "user-command",
  });
  return { ok: true, markdown: nextDraft };
}

function applyMarkdownToStateForReferenceScope(
  state,
  markdown,
  incomingScopeKind,
  reason,
  options = {},
) {
  if (!state) return { ok: false, markdown: "" };
  if (hasLeadingFrontmatter(markdown)) {
    emitFrontmatterLeakBlocked({
      source: reason || "applyMarkdownToState",
      lang: state.lang,
      scope: activeFieldScope || "field",
    });
    if (isDevMode()) {
      throw new Error(
        "[mfe] frontmatter leak: apply pipeline accepts body only",
      );
    }
    return { ok: false, markdown: String(state.getDraft() || "") };
  }
  const rawApplyScopeMeta =
    options.applyScopeMeta && typeof options.applyScopeMeta === "object"
      ? options.applyScopeMeta
      : null;
  const scopeAuthority = resolveReferenceScopeAuthorityForMutation({
    scopeMeta: rawApplyScopeMeta,
    incomingScopeKind,
  });
  if (!scopeAuthority.ok) {
    emitApplyScopeRoutingBug({
      currentScope: scopeAuthority.currentScopeKind || "",
      incomingScopeKind: scopeAuthority.incomingScopeKind || incomingScopeKind,
      resolvedApplyScopeKind: scopeAuthority.currentScopeKind || "",
      stateId: state.id,
      reason: `${reason || "applyMarkdownToStateForReferenceScope"}:${scopeAuthority.reason}`,
    });
    if (scopeAuthority.reason === "incoming-scope-mismatch") {
      throw new Error(
        "[mfe] routing invariant: incoming scope kind must match explicit scope context",
      );
    }
    if (scopeAuthority.reason === "missing-explicit-scope-meta") {
      throw new Error(
        "[mfe] routing invariant: explicit scope context required for this mutation",
      );
    }
    throw new Error("[mfe] routing invariant: failed to resolve scope authority");
  }
  const applyScopeMeta = {
    ...scopeAuthority.scopeMeta,
    currentScope: scopeAuthority.currentScopeKind,
  };
  const currentScope = scopeAuthority.currentScopeKind;
  const incomingKind = scopeAuthority.incomingScopeKind;
  const resolvedApplyScopeKind = currentScope;
  if (currentScope === "document" && resolvedApplyScopeKind !== "document") {
    emitApplyScopeRoutingBug({
      currentScope,
      incomingScopeKind: incomingKind,
      resolvedApplyScopeKind,
      stateId: state.id,
      reason: reason || "applyMarkdownToState:resolvedScope",
    });
    throw new Error(
      "[mfe] routing invariant: document scope must resolve to document",
    );
  }
  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info(
      "PIPELINE_ROUTE",
      JSON.stringify({
        reason: reason || "applyMarkdownToStateForReferenceScope",
        currentScope,
        incomingScopeKind: incomingKind,
        resolvedApplyScopeKind,
        stateId: state.id,
      }),
    );
  }
  emitDocStateLog("APPLY_ROUTING", {
    stateId: state.id,
    currentScope,
    incomingScopeKind: incomingKind,
    resolvedApplyScopeKind,
    reason: reason || "applyMarkdownToStateForReferenceScope",
    trigger: options.trigger || "user-command",
  });
  if (currentScope === "document" && incomingKind !== "document") {
    emitApplyScopeRoutingBug({
      currentScope,
      incomingScopeKind: incomingKind,
      resolvedApplyScopeKind,
      stateId: state.id,
      reason: reason || "applyMarkdownToState",
    });
    if (isDevMode()) {
      throw new Error(
        "[mfe] routing invariant: incomingScopeKind=field forbidden during document-scope editor update",
      );
    }
    return { ok: false, markdown: String(state.getDraft() || "") };
  }
  const lang = state.lang;
  if ((options.mode || "draft") === "hydrate") {
    const draft = normalizeCanonicalMarkdownForIngress(String(markdown || ""), {
      enforceDocumentBodyLeadingBreakPolicy: true,
    });
    state.hydrateFromServer(draft, {
      reason,
      trigger: options.trigger || "system-rehydrate",
    });
    return { ok: true, markdown: draft };
  }

  return applyScopeSlice(
    state,
    {
      scopeKind: resolvedApplyScopeKind,
      currentScope,
      section: applyScopeMeta.section || "",
      subsection: applyScopeMeta.subsection || "",
      name: applyScopeMeta.name || "",
    },
    markdown,
    reason,
    options.trigger || "user-command",
  );
}

function applyMarkdownToStateUsingFallbackScope(
  state,
  markdown,
  incomingScopeKind,
  reason,
  options = {},
) {
  if (!state) return { ok: false, markdown: "" };
  const rawApplyScopeMeta =
    options.applyScopeMeta && typeof options.applyScopeMeta === "object"
      ? options.applyScopeMeta
      : null;
  const fallbackScopeKind = rawApplyScopeMeta
    ? ""
    : resolveApplyScopeKindFromActiveScope(
        `${reason || "applyMarkdownToStateUsingFallbackScope"}:activeScope`,
      );
  const scopeAuthority = resolveNonReferenceScopeAuthorityForMutation({
    scopeMeta: rawApplyScopeMeta,
    incomingScopeKind,
    fallbackScopeKind,
    requireExplicitScope: Boolean(options.requireExplicitScope),
  });
  if (!scopeAuthority.ok) {
    emitApplyScopeRoutingBug({
      currentScope: scopeAuthority.currentScopeKind || fallbackScopeKind || "",
      incomingScopeKind: scopeAuthority.incomingScopeKind || incomingScopeKind,
      resolvedApplyScopeKind:
        scopeAuthority.currentScopeKind || fallbackScopeKind || "",
      stateId: state.id,
      reason: `${reason || "applyMarkdownToStateUsingFallbackScope"}:${scopeAuthority.reason}`,
    });
    if (scopeAuthority.reason === "incoming-scope-mismatch") {
      throw new Error(
        "[mfe] routing invariant: incoming scope kind must match explicit scope context",
      );
    }
    if (scopeAuthority.reason === "missing-explicit-scope-meta") {
      throw new Error(
        "[mfe] routing invariant: explicit scope context required for this mutation",
      );
    }
    throw new Error("[mfe] routing invariant: failed to resolve scope authority");
  }
  return applyMarkdownToStateForReferenceScope(
    state,
    markdown,
    scopeAuthority.incomingScopeKind,
    reason,
    {
      ...options,
      applyScopeMeta: scopeAuthority.scopeMeta,
      requireExplicitScope: true,
    },
  );
}

function validateStateSavePreflight(state, markdown, reason) {
  if (!state) {
    return { ok: false, error: "[mfe] scope-shape: missing state" };
  }
  const stateScopeKind = "document";
  if (!String(markdown || "").trim()) {
    const error = "[mfe] scope-shape: empty document markdown save rejected";
    return { ok: false, error };
  }
  return { ok: true };
}

function validateSavePipelineInvariants({
  state,
  saveScope,
  isDocumentSaveScope,
  finalCanonicalMarkdown,
  outboundMarkdownForSave,
  scopedEditedMarkdownSourceFirst,
}) {
  if (!state) {
    return { ok: false, error: "[mfe] save-pipeline: missing state" };
  }
  if (typeof outboundMarkdownForSave !== "string") {
    return {
      ok: false,
      error: "[mfe] save-pipeline: outbound markdown must be string",
    };
  }
  if (!outboundMarkdownForSave.trim()) {
    return {
      ok: false,
      error: "[mfe] save-pipeline: outbound markdown is empty",
    };
  }
  if (isDocumentSaveScope && typeof finalCanonicalMarkdown !== "string") {
    return {
      ok: false,
      error: "[mfe] save-pipeline: final canonical markdown must be string",
    };
  }
  if (
    !isDocumentSaveScope &&
    (!scopedEditedMarkdownSourceFirst ||
      typeof scopedEditedMarkdownSourceFirst.markdown !== "string")
  ) {
    return {
      ok: false,
      error:
        "[mfe] save-pipeline: scoped markdown artifact missing before save",
    };
  }
  if (isDocumentSaveScope && saveScope !== "document") {
    return {
      ok: false,
      error:
        "[mfe] save-pipeline: invalid routing (document mode with non-document scope)",
    };
  }
  return { ok: true };
}

/**
 * Initialize the fullscreen editor shell and bind it to the canonical save path.
 * Fullscreen save ownership is fixed to saveAllEditors rather than a pluggable callback.
 */
function initEditor(markdownContent, fieldType = "tag") {
  activeFieldType = fieldType;

  if (fullscreenSessionEventScope) {
    fullscreenSessionEventScope.disposeAll();
  }
  fullscreenSessionEventScope =
    fullscreenEventRegistry.createScope("fullscreen-session");

  // Create container (starts at top, centered)
  const container = document.createElement("div");
  container.setAttribute("data-editor-container", "true");
  container.setAttribute("data-field-type", fieldType);
  container.className = "mfe-container";
  container.ondblclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  editorContainer = container;

  // OLD: breadcrumbs are now handled by WindowManager
  // Don't create breadcrumbs here anymore
  // breadcrumbsEl = document.createElement("div");
  // breadcrumbsEl.className = "mfe-breadcrumbs";
  // container.appendChild(breadcrumbsEl);

  editorShell = document.createElement("div");
  editorShell.className = "mfe-editor-shell";
  container.appendChild(editorShell);

  const primaryPane = document.createElement("div");
  primaryPane.className = "mfe-editor-pane mfe-editor-pane--primary";
  const primaryHeader = document.createElement("div");
  primaryHeader.className =
    "mfe-editor-pane-header mfe-editor-pane-header--spacer";
  primaryPane.appendChild(primaryHeader);
  editorShell.appendChild(primaryPane);

  // Create primary editor
  primaryEditor = createEditorInstance(primaryPane, fieldType, activeFieldName);
  activeEditor = primaryEditor;

  // Parse markdown into editor schema and set content
  const primaryBody = enforceBodyOnlyEditorInput(markdownContent || "", {
    source: "initEditor:primary",
    lang: getLanguagesConfig().current,
    scope: activeFieldScope || "field",
  });
  let canonicalSession = getCanonicalMutationSessionForState(
    activeDocumentState?.id || "",
  );
  const cleanBody = canonicalSession
    ? String(canonicalSession?.projection?.displayText || "")
    : sanitizeEditorMarkdownForScope(primaryBody, activeFieldScope);
  runWithoutDirtyTracking(() => {
    const doc = parseMarkdownToDoc(cleanBody || "", primaryEditor.schema);
    primaryEditor.commands.setContent(doc.toJSON(), false);
  });
  if (canonicalSession) {
    const runtimeProjection =
      canonicalSession?.runtimeProjection ||
      canonicalSession?.projection ||
      null;
    const seededBuffer = String(getMarkdownFromEditor(primaryEditor) || "");
    const seededEditorDocMarkdown = seededBuffer;
    const projectionDisplay = String(runtimeProjection?.displayText || "");
    const canonicalProjectionDisplay =
      normalizeLineEndingsToLf(projectionDisplay);
    const canonicalSeededBuffer = normalizeLineEndingsToLf(seededBuffer);
    emitRuntimeBoundaryWriteTrace({
      reason: "initEditor:seed-projection-write",
      mode: String(
        runtimeProjection?.projectionMeta?.updateMode ||
          "deterministic-recompute",
      ),
      trDocChanged: null,
      selectionFrom: Number(primaryEditor?.state?.selection?.from ?? -1),
      selectionTo: Number(primaryEditor?.state?.selection?.to ?? -1),
      previousRuntimeBoundaries:
        readDocumentBoundaryProjection(primaryEditor)?.editableBoundaries || [],
      newRuntimeBoundaries: Array.isArray(runtimeProjection?.editableBoundaries)
        ? runtimeProjection.editableBoundaries
        : [],
      deterministicBoundaries: recomputeEditableBoundariesFromSegmentMap(
        Array.isArray(runtimeProjection?.segmentMap)
          ? runtimeProjection.segmentMap
          : [],
        canonicalProjectionDisplay,
      ),
      stateId: String(activeDocumentState?.id || ""),
      scopeKey: buildCanonicalScopeKey(canonicalSession?.scopeMeta || {}),
      runtimeBoundariesTrusted: true,
    });
    const primaryBoundaryProjection = stampProjectionIdentityForSession(
      String(activeDocumentState?.id || ""),
      canonicalSession?.scopeMeta,
      canonicalSession?.scopeSlice?.protectedSpans,
      buildProjectionWithResolvedMarkerAnchors(primaryEditor, {
        displayText: canonicalProjectionDisplay,
        segmentMap: Array.isArray(runtimeProjection?.segmentMap)
          ? runtimeProjection.segmentMap
          : [],
        protectedSpans: Array.isArray(runtimeProjection?.protectedSpans)
          ? runtimeProjection.protectedSpans
          : Array.isArray(canonicalSession?.scopeSlice?.protectedSpans)
            ? canonicalSession.scopeSlice.protectedSpans
            : [],
        editableBoundaries: Array.isArray(runtimeProjection?.editableBoundaries)
          ? runtimeProjection.editableBoundaries
          : [],
        boundaryDocPositions: Array.isArray(
          runtimeProjection?.boundaryDocPositions,
        )
          ? runtimeProjection.boundaryDocPositions
          : [],
        projectionMeta:
          runtimeProjection?.projectionMeta &&
          typeof runtimeProjection.projectionMeta === "object"
            ? runtimeProjection.projectionMeta
            : {
                updateMode: "deterministic-recompute",
                deterministicRecomputeCount: 0,
                mappingUpdateCount: 0,
                runtimeBoundariesTrusted: true,
              },
      }),
    );
    writeDocumentBoundaryProjection(primaryEditor, primaryBoundaryProjection);
    emitRuntimeShapeLog("MFE_CANONICAL_SESSION_SEED_DIAGNOSTIC", {
      stateId: String(activeDocumentState?.id || ""),
      projectionDisplayHash: hashStateIdentity(projectionDisplay),
      projectionDisplayFirst80Escaped: escapeMarkdownPreview(
        projectionDisplay.slice(0, 80),
      ),
      projectionDisplayLast80Escaped: escapeMarkdownPreview(
        projectionDisplay.slice(-80),
      ),
      projectionDisplayFirst40Escaped: escapeMarkdownPreview(
        projectionDisplay.slice(0, 40),
      ),
      projectionDisplayLast40Escaped: escapeMarkdownPreview(
        projectionDisplay.slice(-40),
      ),
      seededEditorHash: hashStateIdentity(seededBuffer),
      seededEditorDocHash: hashStateIdentity(seededEditorDocMarkdown),
      seededEditorDocFirst80Escaped: escapeMarkdownPreview(
        seededEditorDocMarkdown.slice(0, 80),
      ),
      seededEditorDocLast80Escaped: escapeMarkdownPreview(
        seededEditorDocMarkdown.slice(-80),
      ),
      seededEditorFirst40Escaped: escapeMarkdownPreview(
        seededBuffer.slice(0, 40),
      ),
      seededEditorLast40Escaped: escapeMarkdownPreview(seededBuffer.slice(-40)),
      exactMatch: seededBuffer === projectionDisplay,
      canonicalProjectionHash: hashStateIdentity(canonicalProjectionDisplay),
      canonicalSeededHash: hashStateIdentity(canonicalSeededBuffer),
      canonicalMatch: canonicalProjectionDisplay === canonicalSeededBuffer,
    });
    syncCanonicalProjectionRuntimeForEditor(
      String(activeDocumentState?.id || ""),
      primaryEditor,
      seededBuffer,
    );
    canonicalSession =
      performCanonicalSeedNormalizationHandshake(
        String(activeDocumentState?.id || ""),
        primaryEditor,
      ) || canonicalSession;
    const postSeedSerializedMarkdown = String(
      getMarkdownFromEditor(primaryEditor) || "",
    );
    const canonicalPostSeedSerializedMeta = canonicalizeForCompareAndUnproject(
      postSeedSerializedMarkdown,
    );
    const canonicalPostSeedSerialized = canonicalPostSeedSerializedMeta.text;
    const finalizedSession = getCanonicalMutationSessionForState(
      String(activeDocumentState?.id || ""),
    );
    const finalizedBaselineDisplayMeta = canonicalizeForCompareAndUnproject(
      String(finalizedSession?.projection?.displayText || ""),
    );
    const finalizedBaselineDisplay = finalizedBaselineDisplayMeta.text;
    emitRuntimeShapeLog("MFE_CANONICAL_SESSION_POST_SEED_DIAGNOSTIC", {
      stateId: String(activeDocumentState?.id || ""),
      postSeedSerializedHash: hashStateIdentity(postSeedSerializedMarkdown),
      postSeedSerializedFirst80Escaped: escapeMarkdownPreview(
        postSeedSerializedMarkdown.slice(0, 80),
      ),
      postSeedSerializedLast80Escaped: escapeMarkdownPreview(
        postSeedSerializedMarkdown.slice(-80),
      ),
      canonicalPostSeedSerializedHash: hashStateIdentity(
        canonicalPostSeedSerialized,
      ),
      canonicalFinalizedBaselineHash: hashStateIdentity(
        finalizedBaselineDisplay,
      ),
      canonicalPostSeedTrailingNewlinesStripped: Number(
        canonicalPostSeedSerializedMeta.strippedTrailingNewlineCount || 0,
      ),
      canonicalFinalizedTrailingNewlinesStripped: Number(
        finalizedBaselineDisplayMeta.strippedTrailingNewlineCount || 0,
      ),
      canonicalPostSeedMatch:
        canonicalPostSeedSerialized === finalizedBaselineDisplay,
    });
    if (canonicalPostSeedSerialized !== finalizedBaselineDisplay) {
      const finalizedScopeKind = normalizeScopeKind(
        finalizedSession?.scopeMeta?.scopeKind || activeFieldScope || "field",
      );
      if (finalizedScopeKind !== "document") {
        throw new Error(
          "[mfe] invariant violation: canonical session seed normalization mismatch persists after baseline adoption",
        );
      }
      emitRuntimeShapeLog("MFE_CANONICAL_SESSION_POST_SEED_MISMATCH_ACCEPTED", {
        stateId: String(activeDocumentState?.id || ""),
        scopeKind: finalizedScopeKind,
        reason: "document-scope-preserve-formatting",
      });
    }
  }
  if (shouldWarnForExtraContent(fieldType, activeFieldName)) {
    runWithoutDirtyTracking(() => {
      stripTrailingEmptyParagraph(primaryEditor);
    });
  }
  setOriginalBlockCount(
    primaryEditor,
    fieldType,
    activeFieldName,
    originalBlockCounts,
  );
  highlightExtraContent(primaryEditor);

  // Create toolbar (will be moved to menu bar after window opens)
  const toolbar = createToolbar();

  // Build breadcrumb hierarchy for window manager
  const breadcrumbItems = buildBreadcrumbItems();

  // Open the window
  const win = openWindow({
    id: "mfe-editor",
    content: container,
    onBeforeClose: confirmDiscardUnsavedChanges,
    onClose: cleanupEditorOnly,
    showMenuBar: true,
    menuBarDisabled: false,
    breadcrumbItems: breadcrumbItems,
    breadcrumbClickHandler: handleBreadcrumbClick,
    className: "mfe-editor-window",
    background: "white",
    onMount: (overlay) => {
      const menuBarInner = resolveOverlayMenubarInner(overlay);
      attachToolbarToMenubarInner(menuBarInner, toolbar);
    },
  });
  overlayEl = win.dom;
  setFullscreenShellOpen(true);
  applyEditorViewMode(editorViewMode);

  setupKeyboardShortcuts();
  afterNextPaint(() => primaryEditor.view.focus());
}

function cleanupEditorOnly() {
  const currentSessionStateIds = listStatesForActiveSession(
    getActiveSessionStateKey(),
  ).map((state) => String(state?.id || ""));
  const liveProjectionStateIds = [
    readDocumentBoundaryProjection(primaryEditor)?.projectionMeta?.stateId || "",
    readDocumentBoundaryProjection(secondaryEditor)?.projectionMeta?.stateId || "",
    String(activeDocumentState?.id || ""),
  ].filter(Boolean);
  const runtimeStateIdsToClear = [...new Set([
    ...currentSessionStateIds,
    ...liveProjectionStateIds,
  ])];
  revokeRuntimeProjectionAuthorityForEditor(
    secondaryEditor,
    "cleanupEditorOnly:teardownSecondary",
  );
  revokeRuntimeProjectionAuthorityForEditor(
    primaryEditor,
    "cleanupEditorOnly:teardownPrimary",
  );
  runtimeStateIdsToClear.forEach((stateId) => {
    clearStateRuntimeTracking(stateId, "cleanupEditorOnly:clearStateRuntimeTracking");
  });
  if (typeof splitResizeCleanup === "function") {
    splitResizeCleanup();
  }
  if (secondaryEditor) {
    secondaryEditor.destroy();
    secondaryEditor = null;
  }
  if (primaryEditor) {
    primaryEditor.destroy();
    primaryEditor = null;
  }
  activeEditor = null;
  refreshToolbarState = null;

  if (fullscreenSessionEventScope) {
    fullscreenSessionEventScope.disposeAll();
    fullscreenSessionEventScope = null;
  }
  disposeFullscreenKeydown = null;
  scopeSessionByStateId.clear();

  setFullscreenShellOpen(false);
  traceStateMutation({
    reason: "cleanupEditorOnly:resetStatusAndPending",
    trigger: "lifecycle",
    mutate: () => {
      statusManager.reset();
      lastPrimaryDirtyFieldId = null;
      pendingSavePromise = null;
    },
  });

  activeTarget = null;
  activeFieldName = null;
  activeFieldType = null;
  traceStateMutation({
    reason: "cleanupEditorOnly:resetActiveScope",
    trigger: "lifecycle",
    mutate: () => {
      activeFieldScope = "field";
      activeFieldSection = "";
      activeFieldSubsection = "";
      activeFieldId = null;
      activeOriginKey = null;
      activeOriginFieldKey = null;
    },
  });
  activeSession = null;
  activeRawMarkdown = null;
  activeDisplayMarkdown = null;
  scopedModeMarkdown = null;
  scopedModeTarget = null;
  if (skipOutlineResetDuringClose) {
    skipOutlineResetDuringClose = false;
  } else {
    editorViewMode = "scoped";
    outlinePersistForSession = false;
  }
  activeDocumentState = null;
  editorShell = null;
  editorContainer = null;
  overlayEl = null;
  splitPane = null;
  splitRegion = null;
  splitHandle = null;
  breadcrumbsEl = null;
  breadcrumbAnchorIdentityKey = "";
  sessionScopeLens = null;
  sessionScopeIdentityKey = "";
  sessionScopeAnchorContentId = "document:root";
  sessionScopeActiveContentId = "document:root";
  updateDocumentModeBodyClass();
}

/**
 * Opens fullscreen image-picker UI and applies the selected image mutation.
 * Does not own the canonical save path beyond invoking existing mutation callbacks.
 */
function openImagePicker(initialData = null, imagePos = null) {
  return openImagePickerHelper({
    initialData,
    imagePos,
    getActiveEditor: () => activeEditor,
    getPrimaryEditor: () => primaryEditor,
    getSecondaryEditor: () => secondaryEditor,
    getSecondaryLang: () => secondaryLang,
    markUserIntentToken,
    debugWarn,
    statusManager,
    traceStateMutation,
    normalizeLangValue,
    getLanguagesConfig,
    captureExplicitApplyScopeMeta,
    getDocumentStateForActiveField,
    getMarkdownFromEditor,
    applyMarkdownToStateForReferenceScope,
    normalizeComparableMarkdown,
    getDocumentConfigMarkdownRaw,
    setDocumentDraftMarkdown: (value) => {
      documentDraftMarkdown = value;
    },
    getActiveScopedHtmlKey,
    draftMarkdownByScopedKey,
    activeFieldId,
    afterNextPaint,
  });
}

// Expose globally for toolbar button and extension
window.mfeOpenImagePicker = openImagePicker;

/**
 * Builds the fullscreen toolbar chrome and wires view toggles to existing callbacks.
 * Does not own fullscreen lifecycle or canonical mutation authority.
 */
function createToolbar() {
  return createToolbarHelper({
    getActiveEditor: () => activeEditor,
    getCurrentLanguage: () =>
      String(activeDocumentState?.lang || getLanguagesConfig().current || ""),
    markUserIntentToken,
    saveAllEditors,
    toggleSplit,
    isSplitEnabled: () => splitEnabledByUser,
    openDocumentOutlineView,
    getActiveSession: () => activeSession,
    getActiveFieldScope: () => activeFieldScope,
    isDocumentScopeActive,
    isOutlineViewActive,
    toggleOutlineView,
    setRefreshToolbarState: (value) => {
      refreshToolbarState = value;
    },
    setSaveStatusEl: (value) => {
      saveStatusEl = value;
    },
    statusManager,
  });
}

/**
 * Registers fullscreen keyboard shortcuts against the shared event scope.
 * Does not decide save semantics beyond invoking the existing save entrypoint.
 */
function setupKeyboardShortcuts() {
  return setupKeyboardShortcutsHelper({
    getDisposeFullscreenKeydown: () => disposeFullscreenKeydown,
    setDisposeFullscreenKeydown: (value) => {
      disposeFullscreenKeydown = value;
    },
    getFullscreenSessionEventScope: () => fullscreenSessionEventScope,
    setFullscreenSessionEventScope: (value) => {
      fullscreenSessionEventScope = value;
    },
    fullscreenEventRegistry,
    getActiveEditor: () => activeEditor,
    getCurrentLanguage: () =>
      String(activeDocumentState?.lang || getLanguagesConfig().current || ""),
    saveAllEditors,
  });
}

/**
 * Get markdown from editor state
 */
function resolveScopeAtSaveBoundary(fallbackScope = "field") {
  const scopeFromTarget = getMetaAttr(activeTarget, "scope") || "";
  const scopeFromState = activeFieldScope || "";
  return scopeFromTarget || scopeFromState || fallbackScope || "field";
}

/**
 * Highlight extra paragraphs that won't be saved in tag fields
 */
function highlightExtraContent(editor = activeEditor) {
  if (!editor) {
    return;
  }

  if (!shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    if (editor?.view?.dom) {
      editor.view.dom.removeAttribute("data-extra-warning-active");
    }
    return;
  }

  const currentBlockCount = countSignificantTopLevelBlocks(editor.state.doc);

  const originalBlockCount = getOriginalBlockCount(editor, originalBlockCounts);

  // Only show warning if user has ADDED blocks beyond the original
  // (This applies to any field - if originalBlockCount is 1, only 1 block should be added)
  if (currentBlockCount <= originalBlockCount) {
    editor.view.dom.setAttribute("data-extra-warning-active", "false");
    return;
  }

  editor.view.dom.setAttribute("data-extra-warning-active", "true");
}

const EXTRA_SCOPE_SAVE_ERROR =
  "Can't save yet. Keep only the first line here, then save again.";
const SECTION_COMPOSITE_PREVIEW_READONLY_ERROR =
  "This section has no direct body. Edit its subsection content instead.";
function hasBlockingExtraContent(editor = activeEditor) {
  if (!editor) {
    return false;
  }
  if (!shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    return false;
  }
  const currentBlockCount = countSignificantTopLevelBlocks(editor.state.doc);
  const originalBlockCount = getOriginalBlockCount(editor, originalBlockCounts);
  return currentBlockCount > originalBlockCount;
}

/**
 * Remove visual indicators for tag field content
 */
/**
 * Build a breadcrumb label for the window hierarchy
 */
/**
 * Read the active fullscreen hierarchy from the current target state.
 * Does not mutate the scope lens or canonical markdown.
 */
function getActiveHierarchy() {
  return getActiveHierarchyHelper({
    activeFieldScope,
    activeFieldName,
    activeFieldType,
    activeFieldSection,
    activeFieldSubsection,
    activeTarget,
  });
}

function getConfiguredSectionsIndex() {
  const cfg = window.MarkdownFrontEditorConfig || {};
  return Array.isArray(cfg.sectionsIndex) ? cfg.sectionsIndex : [];
}

/**
 * Build the session scope lens from current indexes.
 * Does not read live editor state or canonical markdown.
 */
function buildSessionScopeLens() {
  return buildSessionScopeLensHelper({
    sectionsIndex: getConfiguredSectionsIndex(),
    fieldsIndex: getFieldsIndex(),
    contentIndexTargets: buildContentIndex()?.targets || [],
  });
}

/**
 * Read a lens node from the active session scope lens.
 * Does not infer missing nodes.
 */
function getLensNode(contentId) {
  return getLensNodeHelper({
    sessionScopeLens,
    contentId,
  });
}

/**
 * Sync the active session scope lens globals from payload identity.
 * Does not open editors or mutate canonical markdown.
 */
function syncSessionScopeLens(payload, identityKey) {
  const nextState = syncSessionScopeLensHelper({
    sessionScopeLens,
    sessionScopeIdentityKey,
    sessionScopeAnchorContentId,
    sessionScopeActiveContentId,
    payload,
    identityKey,
    sectionsIndex: getConfiguredSectionsIndex(),
    fieldsIndex: getFieldsIndex(),
    contentIndexTargets: buildContentIndex()?.targets || [],
  });
  sessionScopeLens = nextState.sessionScopeLens;
  sessionScopeIdentityKey = nextState.sessionScopeIdentityKey;
  sessionScopeAnchorContentId = nextState.sessionScopeAnchorContentId;
  sessionScopeActiveContentId = nextState.sessionScopeActiveContentId;
}

/**
 * Derive hierarchy metadata from the active payload.
 * Does not inspect editor instances or mutate session state.
 */
function deriveHierarchyFromPayload(payload) {
  const scope = payload?.fieldScope || "field";
  const type = payload?.fieldType || "tag";
  const isContainer = type === "container";
  const name = payload?.fieldName || "";
  let section = payload?.fieldSection || "";
  let subsection = payload?.fieldSubsection || "";

  if (scope === "section") {
    section = name;
    subsection = "";
  } else if (scope === "subsection") {
    subsection = name;
    if (!section && subsection) {
      section = findSectionNameForSubsection(subsection) || "";
    }
  } else if (!section && subsection) {
    section = findSectionNameForSubsection(subsection) || "";
  }

  if (scope === "document" && !section && !subsection) {
    const originScopeMeta = parseOriginScopeMeta(
      payload?.originFieldKey || payload?.originKey || payload?.fieldId || "",
    );
    if (originScopeMeta) {
      section = originScopeMeta.section || "";
      subsection = originScopeMeta.subsection || "";
    }
  }

  const resolvedName =
    scope === "document" && name === "document"
      ? parseOriginScopeMeta(
          payload?.originFieldKey ||
            payload?.originKey ||
            payload?.fieldId ||
            "",
        )?.name || name
      : name;

  return {
    scope,
    name: resolvedName,
    section,
    subsection,
    type,
    isContainer,
  };
}

/**
 * Resolve the anchor content id for the current payload.
 * Does not rebuild the scope lens.
 */
function resolveSessionScopeAnchorContentId(payload) {
  const originKey = String(
    payload?.originFieldKey || payload?.originKey || payload?.fieldId || "",
  );
  const originResolved = resolveAnchorContentIdFromOriginKeyHelper(originKey);
  if (originResolved && originResolved !== "document:root") {
    return originResolved;
  }
  const hierarchy = deriveHierarchyFromPayload(payload || {});
  return (
    resolveContentIdForScopeMetaHelper({
      scope: hierarchy.scope || "field",
      type: hierarchy.type || "tag",
      section: hierarchy.section || "",
      subsection: hierarchy.subsection || "",
      name: hierarchy.name || "",
    }) || "document:root"
  );
}

/**
 * Resolve the active content id for the current payload.
 * Does not rebuild the scope lens.
 */
function resolveSessionScopeActiveContentId(payload) {
  const hierarchy = deriveHierarchyFromPayload(payload || {});
  return (
    resolveContentIdForScopeMetaHelper({
      scope: hierarchy.scope || "field",
      type: hierarchy.type || "tag",
      section: hierarchy.section || "",
      subsection: hierarchy.subsection || "",
      name: hierarchy.name || "",
    }) || "document:root"
  );
}

/**
 * Resolve hierarchy from the active session scope lens globals.
 * Does not fall back to DOM-derived active target state.
 */
function resolveHierarchyFromSessionScopeLens() {
  const activeNode = getLensNode(sessionScopeActiveContentId);
  const anchorNode = getLensNode(sessionScopeAnchorContentId);
  const fallbackNode = getLensNode("document:root");
  const node = anchorNode || activeNode || fallbackNode;
  if (!node) return null;
  const scope = node.scope || "field";
  const name = node.name || "";
  const section = node.section || "";
  const subsection = node.subsection || "";
  const type = node.type || (node.isContainer ? "container" : "tag");
  const isContainer = type === "container";
  return { scope, name, section, subsection, type, isContainer };
}

/**
 * Resolve a breadcrumb target to an existing lens node.
 * Does not rebuild the lens or open editors.
 */
function resolveLensNodeForBreadcrumb(params = {}) {
  return resolveLensNodeForBreadcrumbHelper({
    sessionScopeLens,
    ...params,
  });
}

/**
 * Resolve marker-bearing canonical markdown for the current fullscreen lens.
 * Does not mutate canonical state or runtime projection caches.
 */
function resolveMarkerBearingCanonicalMarkdownForLens() {
  return resolveMarkerBearingCanonicalMarkdownForLensHelper({
    getCanonicalMarkdownState,
    getLanguagesConfig,
    getStateForLanguage: (lang) => getStateForLanguage(normalizeLangValue(lang)),
    activeDocumentState,
    getDocumentConfigMarkdownRaw,
    hasCanonicalMarkers,
  });
}

/**
 * Resolve canonical markdown for a specific lens node.
 * Does not build or mutate the lens graph.
 */
function resolveCanonicalMarkdownForLensNode(node) {
  return resolveCanonicalMarkdownForLensNodeHelper(node, {
    getCanonicalMarkdownState,
    getLanguagesConfig,
    getStateForLanguage: (lang) => getStateForLanguage(normalizeLangValue(lang)),
    activeDocumentState,
    getDocumentConfigMarkdownRaw,
    hasCanonicalMarkers,
  });
}

/**
 * Resolve indexed markdown for a lens node.
 * Does not synthesize canonical fallback content.
 */
function resolveIndexedMarkdownForLensNode(node) {
  return resolveIndexedMarkdownForLensNodeHelper(node, decodeMaybeB64);
}

/**
 * Resolve marker-bearing markdown for a lens node with canonical fallback.
 * Does not change session or breadcrumb state.
 */
function resolveMarkerBearingMarkdownForLensNode(node) {
  return resolveMarkerBearingMarkdownForLensNodeHelper(node, {
    decodeMaybeB64,
    hasCanonicalMarkers,
    getCanonicalMarkdownState,
    getLanguagesConfig,
    getStateForLanguage: (lang) => getStateForLanguage(normalizeLangValue(lang)),
    activeDocumentState,
    getDocumentConfigMarkdownRaw,
    debugWarn,
  });
}

/**
 * Stamp the active origin key on a virtual breadcrumb target.
 * Does not derive or mutate the origin key.
 */
function applyActiveOriginKeyToVirtualTarget(virtual) {
  return applyActiveOriginKeyToVirtualTargetHelper(virtual, {
    activeOriginFieldKey,
    activeOriginKey,
  });
}

/**
 * Build a virtual target element for breadcrumb navigation.
 * Does not open the editor or mutate session state.
 */
function buildVirtualTargetFromLensNode(node) {
  const markdownB64 = encodeMarkdownBase64(resolveMarkerBearingMarkdownForLensNode(node));
  return buildVirtualTargetFromLensNodeHelper(node, {
    activeTarget,
    activeOriginFieldKey,
    activeOriginKey,
    encodeMarkdownBase64,
    decodeMaybeB64,
    hasCanonicalMarkers,
    getCanonicalMarkdownState,
    getLanguagesConfig,
    getStateForLanguage: (lang) => getStateForLanguage(normalizeLangValue(lang)),
    activeDocumentState,
    getDocumentConfigMarkdownRaw,
    debugWarn,
    markdownB64,
  });
}

/**
 * Recompute breadcrumb anchor state from a payload and current lens.
 * Does not open editors or mutate canonical markdown.
 */
function updateBreadcrumbAnchorFromPayload(payload) {
  const pageId = String(payload?.pageId || "0");
  const originKey = String(
    payload?.originFieldKey || payload?.originKey || payload?.fieldId || "",
  );
  const nextIdentityKey = `${pageId}|${originKey}`;
  syncSessionScopeLens(payload, nextIdentityKey);
  sessionScopeAnchorContentId = resolveSessionScopeAnchorContentId(payload);
  sessionScopeActiveContentId = resolveSessionScopeActiveContentId(payload);
  if (breadcrumbAnchor && breadcrumbAnchorIdentityKey === nextIdentityKey) {
    return;
  }
  breadcrumbAnchor = deriveHierarchyFromPayload(payload);
  breadcrumbAnchorIdentityKey = nextIdentityKey;
}

/**
 * Build breadcrumb parts from active hierarchy and lens state.
 * Does not resolve click behavior.
 */
function buildBreadcrumbParts() {
  return buildBreadcrumbPartsHelper({
    activeHierarchy: getActiveHierarchy(),
    lensHierarchy: resolveHierarchyFromSessionScopeLens(),
    breadcrumbAnchor,
  });
}

/**
 * Build breadcrumb items with current/link state.
 * Does not resolve navigation targets beyond item metadata.
 */
function buildBreadcrumbItems() {
  return buildBreadcrumbItemsHelper({
    parts: buildBreadcrumbParts(),
    currentTarget: getBreadcrumbsCurrentTarget(),
  });
}

/**
 * Resolve the current breadcrumb target from lens state and fullscreen mode.
 * Does not build breadcrumb labels.
 */
function getBreadcrumbsCurrentTarget() {
  return getBreadcrumbsCurrentTargetHelper({
    sessionScopeLens,
    sessionScopeActiveContentId,
    isDocumentScopeActive,
    activeFieldScope,
    activeFieldType,
  });
}

function getCanonicalPreviewSnapshot() {
  const canonicalState = getCanonicalMarkdownState();
  const isCanonicalState =
    canonicalState &&
    typeof canonicalState === "object" &&
    typeof canonicalState.markdown === "string" &&
    Array.isArray(canonicalState.applied);
  return {
    markdown:
      canonicalState && typeof canonicalState.markdown === "string"
        ? canonicalState.markdown
        : "",
    canonicalHydrated: Boolean(isCanonicalState),
  };
}

function isEmptySectionBodyWithSubsections(sectionName, snapshot = null) {
  if (!sectionName) return false;
  const canonicalSnapshot = snapshot || getCanonicalPreviewSnapshot();
  assertCanonicalPreviewSnapshot(canonicalSnapshot, isDevMode());
  const canonicalMarkdown = canonicalSnapshot.markdown;
  const subsectionNames = getSubsectionNamesFromCanonical(
    canonicalMarkdown,
    sectionName,
  );
  if (!subsectionNames.length) return false;

  const sectionBody = resolveMarkdownForScopeFromCanonical({
    markdown: canonicalMarkdown,
    scope: "section",
    section: sectionName,
    subsection: "",
    name: sectionName,
  });
  return trimTrailingLineBreaks(sectionBody).trim() === "";
}

function getSubsectionNamesFromCanonical(markdown, sectionName) {
  const text = typeof markdown === "string" ? markdown : "";
  if (!text || !sectionName) return [];
  const markerRegex =
    /^[\t ]*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->[\t ]*(?:\r\n|\n|\r|$)/gm;
  const names = [];
  let currentSection = "";
  let match;

  while ((match = markerRegex.exec(text))) {
    const marker = String(match[1] || "");
    if (marker.startsWith("section:")) {
      currentSection = marker.slice("section:".length);
      continue;
    }
    if (currentSection !== sectionName) continue;
    if (marker.startsWith("sub:")) {
      const name = marker.slice("sub:".length).trim();
      if (name) names.push(name);
      continue;
    }
    if (marker.startsWith("subsection:")) {
      const name = marker.slice("subsection:".length).trim();
      if (name) names.push(name);
    }
  }

  return Array.from(new Set(names));
}

function resolveSyntheticSectionPreviewHtml({
  fieldScope,
  fieldName,
  fieldSection,
  canonicalSnapshot = null,
}) {
  if (fieldScope !== "section") return null;
  const sectionName = fieldName || fieldSection || "";
  const snapshot = canonicalSnapshot || getCanonicalPreviewSnapshot();
  assertCanonicalPreviewSnapshot(snapshot, isDevMode());
  if (!isEmptySectionBodyWithSubsections(sectionName, snapshot)) return null;
  const canonicalMarkdown = snapshot.markdown;
  const subsectionNames = getSubsectionNamesFromCanonical(
    canonicalMarkdown,
    sectionName,
  );
  const html = subsectionNames
    .map((subsectionName) => {
      const subsectionMarkdown = resolveMarkdownForScopeFromCanonical({
        markdown: canonicalMarkdown,
        scope: "subsection",
        section: sectionName,
        subsection: subsectionName,
        name: subsectionName,
      });
      return renderMarkdownToHtml(subsectionMarkdown);
    })
    .filter(Boolean)
    .join("\n");
  return html || null;
}

function isReadOnlySyntheticSectionScope() {
  if (activeFieldScope !== "section") return false;
  const sectionName = activeFieldName || activeFieldSection || "";
  return isEmptySectionBodyWithSubsections(sectionName);
}

function closeEditor() {
  // Close is immediate; save completion feedback is delivered via toast if needed.
  closeWindow("mfe-editor");
  return Promise.resolve(true);
}

/**
 * Initialize editors for all editable elements
 */
function initEditors() {
  normalizeFieldHostIdentity(document);
  annotateBoundImages();
}

function annotateBoundImages(root = document) {
  annotateEditableImages(root);
  annotateMfeHostImages(root);
  annotateInferredImages(root);
}

function getActiveScopedHtmlKey() {
  return scopedHtmlKeyFromMeta(
    activeFieldScope || "field",
    activeFieldSection || "",
    activeFieldSubsection || "",
    activeFieldName || "",
  );
}

function encodeMarkdownBase64(markdown) {
  const value = markdown || "";
  return btoa(unescape(encodeURIComponent(value)));
}

function normalizeCanonicalReadbackText(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function parseMarkersWithOffsets(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  const markerRegex =
    /^[\t ]*<!--\s*([a-zA-Z0-9_:.\/-]+)\s*-->[\t ]*(?:\r\n|\n|\r|$)/gm;
  const resolveFieldMarkerIdentity = (
    rawMarkerName,
    fallbackSection,
    fallbackSubsection,
  ) => {
    const raw = String(rawMarkerName || "");
    const normalized = raw.replace(/^field:/i, "");
    const parts = normalized
      .split(/[/:]/)
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    if (parts.length >= 3) {
      return {
        section: parts[0],
        subsection: parts[1],
        name: parts[2],
      };
    }
    if (parts.length === 2) {
      return {
        section: parts[0],
        subsection: "",
        name: parts[1],
      };
    }
    if (parts.length === 1) {
      return {
        section: fallbackSection,
        subsection: fallbackSubsection,
        name: parts[0],
      };
    }
    return {
      section: fallbackSection,
      subsection: fallbackSubsection,
      name: raw,
    };
  };
  const markers = [];
  let currentSection = "";
  let currentSubsection = "";
  let match;
  while ((match = markerRegex.exec(text))) {
    const rawName = String(match[1] || "");
    const lineStart = match.index;
    const lineEnd = markerRegex.lastIndex;
    let kind = "field";
    let name = rawName;
    let markerSection = currentSection;
    let markerSubsection = currentSubsection;
    if (rawName.startsWith("section:")) {
      kind = "section";
      name = rawName.slice("section:".length);
      currentSection = name;
      currentSubsection = "";
      markerSection = currentSection;
      markerSubsection = currentSubsection;
    } else if (rawName.startsWith("subsection:")) {
      kind = "subsection";
      name = rawName.slice("subsection:".length);
      currentSubsection = name;
      markerSection = currentSection;
      markerSubsection = currentSubsection;
    } else if (rawName.startsWith("sub:")) {
      kind = "subsection";
      name = rawName.slice("sub:".length);
      currentSubsection = name;
      markerSection = currentSection;
      markerSubsection = currentSubsection;
    } else {
      const fieldIdentity = resolveFieldMarkerIdentity(
        rawName,
        currentSection,
        currentSubsection,
      );
      markerSection = fieldIdentity.section || markerSection;
      name = fieldIdentity.name || name;
      markerSubsection = fieldIdentity.subsection;
    }
    markers.push({
      rawName,
      kind,
      name,
      section: markerSection,
      subsection: markerSubsection,
      lineStart,
      lineEnd,
    });
  }
  return markers;
}

function resolveScopePatchRange(canonicalBody, scopeMeta) {
  const text = typeof canonicalBody === "string" ? canonicalBody : "";
  const scopeKind = normalizeScopeKind(scopeMeta?.scopeKind || "field");
  if (scopeKind === "document") {
    return { startOffset: 0, endOffset: text.length, markers: [] };
  }
  const markers = parseMarkersWithOffsets(text);
  if (!markers.length) {
    throw new Error("[mfe] scope patch: no markers in canonical body");
  }
  const sectionName = String(scopeMeta?.section || "");
  const subsectionName = String(scopeMeta?.subsection || "");
  const scopeName = String(scopeMeta?.name || "");
  const targetSection =
    scopeKind === "section" ? scopeName || sectionName : sectionName;
  const targetSubsection =
    scopeKind === "subsection" ? scopeName || subsectionName : subsectionName;

  const buildFieldNameVariants = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return [];
    const trimmed = raw.replace(/[\.\u2026]+$/g, "");
    const variants = new Set([raw]);
    if (trimmed) {
      variants.add(trimmed);
      variants.add(`${trimmed}...`);
      variants.add(`${trimmed}…`);
    }
    return Array.from(variants).filter(Boolean);
  };

  const findFieldTargetIndex = ({ section, subsection, name }) => {
    const normalizedSection = String(section || "");
    const normalizedSubsection = String(subsection || "");
    const normalizedName = String(name || "");
    const nameVariants = buildFieldNameVariants(normalizedName);
    if (!nameVariants.length) return -1;

    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      if (
        marker.kind === "field" &&
        marker.section === normalizedSection &&
        marker.subsection === normalizedSubsection &&
        nameVariants.includes(String(marker.name || ""))
      ) {
        return index;
      }
    }

    const fieldMatches = markers
      .map((marker, index) => ({ marker, index }))
      .filter(
        ({ marker }) =>
          marker.kind === "field" &&
          marker.section === normalizedSection &&
          nameVariants.includes(String(marker.name || "")),
      );
    if (fieldMatches.length === 1) {
      return fieldMatches[0].index;
    }
    if (fieldMatches.length > 1 && !normalizedSubsection) {
      const rootMatches = fieldMatches.filter(
        ({ marker }) => String(marker.subsection || "") === "",
      );
      if (rootMatches.length === 1) {
        return rootMatches[0].index;
      }
    }

    const byName = markers
      .map((marker, index) => ({ marker, index }))
      .filter(
        ({ marker }) =>
          marker.kind === "field" &&
          nameVariants.includes(String(marker.name || "")),
      );
    if (normalizedSection) {
      const bySection = byName.filter(
        ({ marker }) => String(marker.section || "") === normalizedSection,
      );
      if (bySection.length === 1) {
        return bySection[0].index;
      }
    }
    if (byName.length > 1) {
      const rootByName = byName.filter(
        ({ marker }) => String(marker.subsection || "") === "",
      );
      if (rootByName.length === 1) {
        return rootByName[0].index;
      }
    }
    if (byName.length === 1) {
      return byName[0].index;
    }

    const normalizedRawNames = nameVariants
      .map((variant) => String(variant || "").replace(/^field:/i, ""))
      .filter(Boolean);
    const rawCandidates = new Set(
      normalizedRawNames
        .flatMap((rawName) => [
          rawName,
          normalizedSection ? `field:${normalizedSection}:${rawName}` : "",
          normalizedSection && normalizedSubsection
            ? `field:${normalizedSection}:${normalizedSubsection}:${rawName}`
            : "",
        ])
        .filter(Boolean),
    );
    const rawMatches = markers
      .map((marker, index) => ({ marker, index }))
      .filter(({ marker }) => {
        if (marker.kind !== "field") return false;
        const markerRaw = String(marker.rawName || "");
        if (rawCandidates.has(markerRaw)) return true;
        return normalizedRawNames.some((rawName) =>
          markerRaw.endsWith(`:${rawName}`),
        );
      });
    if (rawMatches.length === 1) {
      return rawMatches[0].index;
    }
    if (rawMatches.length > 1 && normalizedSection) {
      const sectionRawMatches = rawMatches.filter(({ marker }) => {
        const markerRaw = String(marker.rawName || "");
        return markerRaw.includes(`field:${normalizedSection}`);
      });
      if (sectionRawMatches.length === 1) {
        return sectionRawMatches[0].index;
      }
    }

    return -1;
  };

  let targetIndex = -1;
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    if (scopeKind === "section") {
      if (marker.kind === "section" && marker.name === targetSection) {
        targetIndex = index;
        break;
      }
      continue;
    }
    if (scopeKind === "subsection") {
      if (
        marker.kind === "subsection" &&
        marker.section === sectionName &&
        marker.name === targetSubsection
      ) {
        targetIndex = index;
        break;
      }
      continue;
    }
    const fieldTarget = findFieldTargetIndex({
      section: sectionName,
      subsection: subsectionName,
      name: scopeName,
    });
    if (fieldTarget >= 0) {
      targetIndex = fieldTarget;
      break;
    }
    break;
  }
  if (targetIndex < 0 && scopeKind === "field") {
    targetIndex = findFieldTargetIndex({
      section: sectionName,
      subsection: subsectionName,
      name: scopeName,
    });
  }
  if (targetIndex < 0 && scopeKind === "field") {
    const originMeta = parseOriginScopeMeta(
      scopeMeta?.originKey ||
        activeOriginKey ||
        activeFieldId ||
        activeOriginFieldKey ||
        "",
    );
    if (originMeta?.scopeKind === "field") {
      targetIndex = findFieldTargetIndex({
        section: originMeta.section,
        subsection: originMeta.subsection,
        name: originMeta.name,
      });
    }
  }
  if (targetIndex < 0) {
    const debugMeta = {
      scopeKind,
      sectionName,
      subsectionName,
      scopeName,
      originKey:
        scopeMeta?.originKey ||
        activeOriginKey ||
        activeFieldId ||
        activeOriginFieldKey ||
        "",
      markerCount: markers.length,
      fieldMarkers: markers
        .filter((marker) => marker.kind === "field")
        .slice(0, 12)
        .map((marker) => ({
          rawName: marker.rawName,
          section: marker.section,
          subsection: marker.subsection,
          name: marker.name,
        })),
    };
    throw new Error(
      `[mfe] scope patch: marker not found for ${scopeKind} ${JSON.stringify(debugMeta)}`,
    );
  }

  const targetMarker = markers[targetIndex];
  const effectiveSection = String(targetMarker?.section || sectionName || "");
  const effectiveSubsection = String(
    targetMarker?.subsection || subsectionName || "",
  );

  const startOffset = markers[targetIndex].lineEnd;
  let endOffset = text.length;
  for (let index = targetIndex + 1; index < markers.length; index += 1) {
    const marker = markers[index];
    if (scopeKind === "section") {
      if (marker.kind === "section") {
        endOffset = marker.lineStart;
        break;
      }
      continue;
    }
    if (scopeKind === "subsection") {
      if (
        marker.kind === "section" ||
        (marker.kind === "subsection" && marker.section === effectiveSection)
      ) {
        endOffset = marker.lineStart;
        break;
      }
      continue;
    }
    if (
      marker.kind === "section" ||
      (marker.kind === "subsection" && marker.section === effectiveSection) ||
      (marker.kind === "field" &&
        marker.section === effectiveSection &&
        marker.subsection === effectiveSubsection)
    ) {
      endOffset = marker.lineStart;
      break;
    }
  }

  const rawEndOffset = endOffset;

  while (endOffset > startOffset) {
    const charCode = text.charCodeAt(endOffset - 1);
    if (charCode === 10) {
      endOffset -= 1;
      if (endOffset > startOffset && text.charCodeAt(endOffset - 1) === 13) {
        endOffset -= 1;
      }
      continue;
    }
    if (charCode === 13) {
      endOffset -= 1;
      continue;
    }
    break;
  }

  return {
    startOffset,
    endOffset,
    rawEndOffset,
    markers,
  };
}

function readScopedComparableFromCanonicalBody(canonicalBody, scopeMeta) {
  const body = typeof canonicalBody === "string" ? canonicalBody : "";
  const range = resolveScopePatchRange(body, scopeMeta);
  return String(body.slice(range.startOffset, range.endOffset) || "");
}

function readScopedOutboundFromCanonicalBody(canonicalBody, scopeMeta) {
  const body = typeof canonicalBody === "string" ? canonicalBody : "";
  const range = resolveScopePatchRange(body, scopeMeta);
  const scopeKind = normalizeScopeKind(scopeMeta?.scopeKind || "field");
  const useRawBoundary = scopeKind === "section" || scopeKind === "subsection";
  let startOffset = range.startOffset;
  const endOffset =
    useRawBoundary && Number.isInteger(range.rawEndOffset)
      ? range.rawEndOffset
      : range.endOffset;
  if (useRawBoundary) {
    const outboundCandidate = String(body.slice(startOffset, endOffset) || "");
    if (
      /^(?:\r\n|\n|\r)(?=[\t ]*<!--\s*[a-zA-Z0-9_:.\/-]+\s*-->)/.test(
        outboundCandidate,
      )
    ) {
      if (
        body.charCodeAt(startOffset) === 13 &&
        body.charCodeAt(startOffset + 1) === 10
      ) {
        startOffset += 2;
      } else {
        startOffset += 1;
      }
    }
  }
  return String(body.slice(startOffset, endOffset) || "");
}

async function fetchPersistedMarkdownReadback(pageId, lang) {
  const translations = await fetchTranslations(
    "document",
    pageId || "0",
    "document",
    "",
  );
  if (!translations || typeof translations !== "object") {
    return "";
  }
  const langKey = normalizeLangValue(lang);
  const direct = translations[lang] ?? translations[langKey];
  return typeof direct === "string" ? direct : "";
}

function composeDocumentMarkdownForSave(markdown, options = {}) {
  const body = trimTrailingLineBreaks(
    typeof markdown === "string" ? markdown : "",
  );
  const lang = normalizeLangValue(options.lang || getLanguagesConfig().current);
  const state =
    options.state || getStateForLanguage(lang) || activeDocumentState;
  const frontmatterRaw = state
    ? String(state.getFrontmatterRaw?.() || "")
    : getFrontmatterForLanguage(lang);
  const bodyStartsWithMarker = /^<!--/.test(body);
  const bodyStartsWithHeading = /^#{1,6}[ \t]/.test(body);
  const bodyStartsWithNewline = /^(?:\r\n|\n|\r)/.test(body);
  const frontmatterEndsWithNewline = /(?:\r\n|\n|\r)$/.test(frontmatterRaw);
  const bodyHasLeadingFrontmatter = hasLeadingFrontmatter(body);
  const bodyStartsWithoutLeadingBreak =
    body.length > 0 && !bodyStartsWithNewline;
  const shouldInsertFrontmatterSeparator =
    bodyStartsWithoutLeadingBreak &&
    (bodyStartsWithMarker || bodyStartsWithHeading);
  const separatorInsertedCount = shouldInsertFrontmatterSeparator ? 1 : 0;
  const frontmatterSeparatorReason = shouldInsertFrontmatterSeparator
    ? bodyStartsWithMarker
      ? "bodyStartsWithMarker"
      : "bodyStartsWithHeading"
    : "none";
  const composedBody = shouldInsertFrontmatterSeparator ? `\n${body}` : body;
  const hasComposableFrontmatterBoundary =
    Boolean(frontmatterRaw) &&
    !bodyHasLeadingFrontmatter &&
    composedBody.length > 0;
  const boundaryPreviewEscaped = hasComposableFrontmatterBoundary
    ? escapeMarkdownPreview(
        `${frontmatterRaw.slice(Math.max(0, frontmatterRaw.length - 30))}${composedBody.slice(0, 30)}`,
      )
    : "";
  const composedPayload =
    !frontmatterRaw || bodyHasLeadingFrontmatter
      ? body
      : !composedBody
        ? frontmatterRaw
        : `${frontmatterRaw}${composedBody}`;
  emitRuntimeShapeLog("FRONTMATTER_BODY_COMPOSE_DIAGNOSTIC", {
    lang,
    rawFrontmatterByteLength: frontmatterRaw.length,
    rawFrontmatterLeadingLineBreakUnits:
      countLeadingLineBreakUnits(frontmatterRaw),
    rawFrontmatterEscaped: {
      first40Escaped: escapeMarkdownPreview(frontmatterRaw.slice(0, 40)),
      last40Escaped: escapeMarkdownPreview(
        frontmatterRaw.slice(Math.max(0, frontmatterRaw.length - 40)),
      ),
    },
    rawBodyByteLength: body.length,
    rawBodyLeadingLineBreakUnits: countLeadingLineBreakUnits(body),
    rawBodyEscaped: {
      first40Escaped: escapeMarkdownPreview(body.slice(0, 40)),
      last40Escaped: escapeMarkdownPreview(
        body.slice(Math.max(0, body.length - 40)),
      ),
    },
    frontmatterEndsWithNewline,
    bodyStartsWithNewline,
    insertedFrontmatterSeparatorNewline: shouldInsertFrontmatterSeparator,
    separatorInsertedCount,
    frontmatterSeparatorReason,
    boundaryPreviewEscaped,
    composedPayloadByteLength: composedPayload.length,
    composedPayloadLeadingLineBreakUnits:
      countLeadingLineBreakUnits(composedPayload),
    composedPayloadEscaped: {
      first40Escaped: escapeMarkdownPreview(composedPayload.slice(0, 40)),
      last40Escaped: escapeMarkdownPreview(
        composedPayload.slice(Math.max(0, composedPayload.length - 40)),
      ),
    },
  });
  if (!frontmatterRaw) return body;
  if (bodyHasLeadingFrontmatter) return body;
  emitRuntimeShapeLog("FRONTMATTER_RECOMPOSE_ON_SAVE", {
    lang,
    frontmatterBytes: frontmatterRaw.length,
    bodyBytes: body.length,
  });
  if (!composedBody) return frontmatterRaw;
  return `${frontmatterRaw}${composedBody}`;
}

function isOutlineViewActive() {
  return editorViewMode === "document";
}

function isDocumentScopeActive() {
  return (activeFieldScope || "") === "document";
}

function getDocumentConfigMarkdown() {
  return getDocumentConfigMarkdownRaw();
}

function getDocumentConfigMarkdownRaw() {
  const b64 = window.MarkdownFrontEditorConfig?.documentMarkdownB64 || "";
  return normalizeCanonicalMarkdownForIngress(decodeMaybeB64(b64), {
    enforceDocumentBodyLeadingBreakPolicy: true,
  });
}

function getDocumentSourceMarkdown() {
  return getDocumentConfigMarkdownRaw();
}

function refreshEditorDecorations(editor) {
  if (!editor?.view?.dispatch || !editor?.state?.tr) return;
  const tr = editor.state.tr.setMeta("mfe-document-mode-refresh", Date.now());
  editor.view.dispatch(tr);
}

function refreshAllEditorDecorations() {
  refreshEditorDecorations(primaryEditor);
  refreshEditorDecorations(secondaryEditor);
}

function updateDocumentModeBodyClass() {
  setDocumentModeShellOpen(isOutlineViewActive());
}

function setPrimaryEditorMarkdown(markdown) {
  if (!primaryEditor) return;
  const text = enforceBodyOnlyEditorInput(
    typeof markdown === "string" ? markdown : "",
    {
      source: "setPrimaryEditorMarkdown",
      lang: getLanguagesConfig().current,
      scope: activeFieldScope || "field",
    },
  );
  const sanitizedText = sanitizeEditorMarkdownForScope(text, activeFieldScope);
  const selection = primaryEditor.state.selection;
  runWithoutDirtyTracking(() => {
    try {
      const doc = parseMarkdownToDoc(sanitizedText, primaryEditor.schema);
      primaryEditor.commands.setContent(doc.toJSON(), false);
    } catch (_error) {
      debugWarn("[mfe:primary] parse-failed:setPrimaryEditorMarkdown", {
        scope: activeFieldScope || "field",
        lang: getLanguagesConfig().current,
        error: _error?.message || String(_error),
      });
    }
  });
  try {
    primaryEditor.commands.setTextSelection(selection);
  } catch (_e) {}
}

function applyEditorViewMode(mode) {
  if (outlinePersistForSession && mode !== "document") {
    return;
  }
  editorViewMode = mode === "document" ? "document" : "scoped";
  updateDocumentModeBodyClass();
  refreshAllEditorDecorations();
  updateWindowById("mfe-editor", {
    breadcrumbItems: buildBreadcrumbItems(),
    breadcrumbClickHandler: handleBreadcrumbClick,
  });
  if (typeof refreshToolbarState === "function") {
    refreshToolbarState();
  }
}

function decodeMaybeB64(value) {
  if (!value) return "";
  try {
    return normalizeLineEndingsToLf(decodeMarkdownBase64(value));
  } catch (_e) {
    return "";
  }
}

function getCanonicalMarkdownState() {
  const documentDraft =
    typeof documentDraftMarkdown === "string" ? documentDraftMarkdown : "";
  const configDocument = getDocumentConfigMarkdownRaw();
  const scopedDraftEntries = Array.from(draftMarkdownByScopedKey.entries());

  const canonicalState = computeCanonicalMarkdownStateFromInputs({
    documentDraft,
    configDocument,
    scopedDraftEntries,
  });
  assertCanonicalStateShape(
    canonicalState,
    "fullscreen:getCanonicalMarkdownState",
  );

  if (isDevMode()) {
    const deterministicCanonicalState = computeCanonicalMarkdownStateFromInputs(
      {
        documentDraft,
        configDocument,
        scopedDraftEntries,
      },
    );
    if (canonicalState.markdown !== deterministicCanonicalState.markdown) {
      throw new Error("[mfe] canonical: non-deterministic markdown output");
    }
    if (
      JSON.stringify(canonicalState.applied) !==
      JSON.stringify(deterministicCanonicalState.applied)
    ) {
      throw new Error("[mfe] canonical: non-deterministic overlay selection");
    }

    const targets = new Set();
    canonicalState.applied.forEach((entry) => {
      const targetKey = String(entry?.targetKey || "");
      if (!targetKey) {
        throw new Error("[mfe] canonical: overlay target key missing");
      }
      if (targets.has(targetKey)) {
        throw new Error(`[mfe] canonical: duplicate winner for ${targetKey}`);
      }
      targets.add(targetKey);
    });

    assertCanonicalMarkerTopology(canonicalState.markdown);
  }

  return canonicalState;
}

// helpers exposed solely for unit tests ------------------------------------------------
export function __testResolveEditorUpdateSource(transaction) {
  // wrapper around internal helper so tests can exercise classification logic
  return resolveEditorUpdateSource(transaction);
}

export function __testMarkEditorInputSource(source) {
  // expose the internal mutator so tests can simulate keyboard/pointer activity
  return markEditorInputSource(source);
}

function resolveCanonicalMarkdownForPayload(payload, canonicalMarkdown) {
  if (typeof canonicalMarkdown !== "string") {
    throw new Error(
      "[mfe] canonical: markdown must be string for payload resolution",
    );
  }
  const scope = payload?.fieldScope || "field";
  const name = payload?.fieldName || "";
  const section = scope === "section" ? name : payload?.fieldSection || "";
  const subsection =
    scope === "subsection" ? name : payload?.fieldSubsection || "";
  const markdown = resolveMarkdownForScopeFromCanonical({
    markdown: canonicalMarkdown,
    scope,
    section,
    subsection,
    name,
  });
  return markdown;
}

function resolveScopedMarkdownFromPayloadSource(
  payload,
  payloadMarkdown,
  currentLang,
) {
  const sourceMarkdown = ensureCanonicalMarkersForOpen({
    markdown: payloadMarkdown,
    scope: payload?.fieldScope || "field",
    lang: currentLang,
    source: "buildCanonicalPayload:payloadRaw",
  });
  try {
    return resolveCanonicalMarkdownForPayload(payload, sourceMarkdown);
  } catch (_error) {
    return sourceMarkdown;
  }
}

function hydrateCanonicalPayload(payloadMetaWithOrigin) {
  const currentLang = normalizeLangValue(getLanguagesConfig().current);
  const payloadMarkdown =
    typeof payloadMetaWithOrigin?.markdownContent === "string"
      ? payloadMetaWithOrigin.markdownContent
      : "";
  const payloadHasMarkers = hasCanonicalMarkers(payloadMarkdown);
  const canonicalStateMarkdown = String(
    getCanonicalMarkdownState().markdown || "",
  );
  const canonicalRoot = hasCanonicalMarkers(canonicalStateMarkdown)
    ? ensureCanonicalMarkersForOpen({
        markdown: canonicalStateMarkdown,
        scope: payloadMetaWithOrigin?.fieldScope,
        lang: currentLang,
        source: "buildCanonicalPayload:canonicalState",
      })
    : "";

  let markdown = "";
  if (canonicalRoot) {
    markdown = resolveCanonicalMarkdownForPayload(
      payloadMetaWithOrigin,
      canonicalRoot,
    );
  } else if (payloadHasMarkers) {
    markdown = resolveScopedMarkdownFromPayloadSource(
      payloadMetaWithOrigin,
      payloadMarkdown,
      currentLang,
    );
  } else {
    const fallbackRoot = ensureCanonicalMarkersForOpen({
      markdown: getDocumentConfigMarkdownRaw(),
      scope: payloadMetaWithOrigin?.fieldScope,
      lang: currentLang,
      source: "buildCanonicalPayload:configRaw",
      requireMarkers: payloadMetaWithOrigin?.fieldScope === "document",
    });
    markdown = resolveCanonicalMarkdownForPayload(
      payloadMetaWithOrigin,
      fallbackRoot,
    );
  }

  const checkedMarkdown = ensureCanonicalMarkersForOpen({
    markdown,
    scope: payloadMetaWithOrigin?.fieldScope,
    lang: currentLang,
    source: "buildCanonicalPayload:resolvedCanonical",
    requireMarkers: payloadMetaWithOrigin?.fieldScope === "document",
  });
  return {
    ...payloadMetaWithOrigin,
    markdownContent: checkedMarkdown,
    canonicalHydrated: true,
  };
}

function applyActivePayloadState(payload, options) {
  const resolvedOptions = options && typeof options === "object" ? options : {};
  const {
    previousSessionStateId = "",
    previousOriginFieldKey = "",
    previousPageId = "",
    stateReason = "openFullscreenEditorFromPayload:setActiveScope",
    bindReason = "openFullscreenEditorFromPayload:bindPrimaryState",
    ingestSource = "open-initial",
    enforceSource = "openFullscreenEditorFromPayload",
    setPrimaryEditorActive = false,
  } = resolvedOptions;

  const {
    markdownContent,
    fieldName,
    fieldType,
    fieldScope,
    fieldSection,
    fieldSubsection,
    pageId,
    fieldId,
  } = payload;

  const canonicalMarkdownRaw =
    typeof markdownContent === "string" ? markdownContent : "";
  const isDocumentScope = fieldScope === "document";
  const canonicalMarkdown = isDocumentScope
    ? normalizeCanonicalMarkdownForIngress(canonicalMarkdownRaw, {
        enforceDocumentBodyLeadingBreakPolicy: true,
      })
    : normalizeLineEndingsToLf(canonicalMarkdownRaw);
  let effectiveMarkdown = canonicalMarkdown;
  const syntheticSectionPreviewHtml = resolveSyntheticSectionPreviewHtml({
    fieldScope,
    fieldName,
    fieldSection,
  });
  if (!isDocumentScope) {
    scopedModeMarkdown = effectiveMarkdown;
  }

  traceStateMutation({
    reason: stateReason,
    trigger: "scope-navigation",
    mutate: () => {
      if (setPrimaryEditorActive) {
        activeEditor = primaryEditor;
        if (typeof refreshToolbarState === "function") {
          refreshToolbarState();
        }
      }
      activeTarget = payload.element;
      activeFieldName = fieldName;
      activeFieldType = fieldType;
      activeFieldScope = fieldScope;
      activeFieldSection = fieldSection;
      activeFieldSubsection = fieldSubsection;
      activeFieldId =
        payload.fieldId || fieldId || buildPayloadFieldId(payload);
      const identity = resolveSessionIdentityEnvelope(payload, {
        pageId: pageId || "0",
        activeSessionStateId: previousSessionStateId,
        activePageId: previousPageId,
        activeOriginFieldKey: previousOriginFieldKey,
        fallbackFieldId: activeFieldId,
      });
      activeOriginFieldKey =
        identity.originFieldKey ||
        payload.originFieldKey ||
        payload.originKey ||
        payload.fieldId ||
        fieldId ||
        activeFieldId;
      activeOriginKey = activeOriginFieldKey;
      activeSessionStateId =
        identity.sessionStateId ||
        buildSessionStateId(pageId || "0", activeOriginFieldKey || "");
      updateBreadcrumbAnchorFromPayload({
        ...payload,
        pageId: pageId || "0",
        fieldName,
        fieldType,
        fieldScope,
        fieldSection,
        fieldSubsection,
        fieldId: payload.fieldId || fieldId || activeFieldId,
        originFieldKey: activeOriginFieldKey || activeFieldId,
        originKey: activeOriginFieldKey || activeFieldId,
      });
      activeSession = resolveSession({
        scope: createScope({
          kind: fieldScope,
          pageId,
          section: fieldSection,
          subsection: fieldSubsection,
          name: fieldName,
          fieldType,
        }),
        view: createView({ kind: "rich" }),
        host: createHost({ kind: "fullscreen" }),
      });
      const currentLang = normalizeLangValue(getLanguagesConfig().current);
      rebindActiveDocumentState(
        {
          ...payload,
          fieldId: payload.fieldId || fieldId || activeFieldId,
          originFieldKey: activeOriginFieldKey || activeFieldId,
          originKey: activeOriginFieldKey || activeFieldId,
        },
        currentLang,
        {
          reason: bindReason,
          trigger: "scope-navigation",
          viewScope: fieldScope,
          sessionId: activeSessionStateId,
          initialPersistedMarkdown: getDocumentSourceMarkdown(),
          initialDraftMarkdown: getDocumentSourceMarkdown(),
        },
      );
      if (isDocumentScope && activeDocumentState) {
        console.log("BEFORE_HYDRATION", {
          stateId: activeDocumentState.id,
          timestamp: Date.now(),
        });
        effectiveMarkdown = ingestDocumentStateMarkdown(
          activeDocumentState,
          canonicalMarkdown,
          {
            lang: currentLang,
            source: ingestSource,
            trigger: "system-rehydrate",
          },
        );
      }
      const canonicalSessionState = activeDocumentState;
      if (canonicalSessionState) {
        const canonicalScopeMeta = buildCanonicalSessionScopeMeta({
          scopeKind: fieldScope,
          section: fieldSection,
          subsection: fieldSubsection,
          name: fieldName,
        });
        lockScopeSessionV2ForState(
          canonicalSessionState,
          canonicalScopeMeta,
          "openFullscreenEditorFromPayload",
        );
        const session = setCanonicalMutationSessionForState(
          canonicalSessionState.id,
          String(canonicalSessionState.getDraft() || ""),
          canonicalScopeMeta,
        );
        effectiveMarkdown = String(session?.projection?.displayText || "");
        emitRuntimeShapeLog("MFE_CANONICAL_SESSION_OPEN", {
          stateId: String(canonicalSessionState.id || ""),
          scopeKind: canonicalScopeMeta.scopeKind,
          sliceStart: Number(session?.scopeSlice?.sliceStart ?? -1),
          sliceEnd: Number(session?.scopeSlice?.sliceEnd ?? -1),
          baselineDisplayHash: String(session?.baselineDisplayHash || ""),
          baselineCanonicalSliceHash: hashStateIdentity(
            String(session?.scopeSlice?.canonicalSlice || ""),
          ),
        });
      }
      effectiveMarkdown = enforceBodyOnlyEditorInput(effectiveMarkdown, {
        source: enforceSource,
        lang: currentLang,
        scope: fieldScope,
      });
      activeRawMarkdown = effectiveMarkdown;
      activeDisplayMarkdown = effectiveMarkdown;
    },
  });

  return {
    effectiveMarkdown,
    isDocumentScope,
    syntheticSectionPreviewHtml,
    fieldName,
    fieldType,
    fieldScope,
    fieldSection,
    fieldSubsection,
    pageId,
    fieldId,
  };
}

function applyScopedDraftForTarget(target, markdown) {
  if (!target) {
    throw new Error(
      "[mfe] canonical: target is required to apply scoped draft",
    );
  }
  const scope = getMetaAttr(target, "scope") || "field";
  const name = getMetaAttr(target, "name") || "";
  const section =
    scope === "section" ? name : getMetaAttr(target, "section") || "";
  const subsection =
    scope === "subsection" ? name : getMetaAttr(target, "subsection") || "";
  const pageId = target.getAttribute("data-page") || "0";
  const nextMarkdown = trimTrailingLineBreaks(
    typeof markdown === "string" ? markdown : "",
  );

  if (scope === "document") {
    if (!hasCanonicalMarkers(nextMarkdown)) {
      emitRuntimeShapeLog("MFE_CANONICAL_WRITE_BLOCKED", {
        source: "applyScopedDraftForTarget:document",
        lang: normalizeLangValue(getLanguagesConfig().current),
        scope: "document",
      });
      if (isDevMode()) {
        throw new Error(
          "[mfe] canonical write blocked: markerless document draft",
        );
      }
      return false;
    }
    traceStateMutation({
      reason: "applyScopedDraftForTarget:document",
      trigger: "external-apply",
      mutate: () => {
        documentDraftMarkdown = nextMarkdown;
      },
    });
    getCanonicalMarkdownState();
    return true;
  }

  const scopeKey = scopedHtmlKeyFromMeta(scope, section, subsection, name);
  if (!scopeKey) {
    throw new Error(
      "[mfe] canonical: failed to resolve scope key for scoped draft",
    );
  }
  const fieldId = buildPayloadFieldId({
    pageId,
    fieldScope: scope,
    fieldSection: section,
    fieldSubsection: subsection,
    fieldName: name,
  });
  traceStateMutation({
    reason: "applyScopedDraftForTarget:scoped",
    trigger: "external-apply",
    mutate: () => {
      primaryDraftsByFieldId.set(fieldId, nextMarkdown);
      draftMarkdownByScopedKey.set(scopeKey, nextMarkdown);
    },
  });
  getCanonicalMarkdownState();
  return true;
}

async function flushToCanonical() {
  if (activeEditor && primaryEditor) {
    const ok = await keepPendingChangesBeforeSwitch();
    if (!ok) return false;
  }
  getCanonicalMarkdownState();
  return true;
}

/**
 * Builds virtual breadcrumb targets for fullscreen navigation clicks.
 * Does not open editors or mutate session ownership.
 */
function createBreadcrumbVirtualTarget(params) {
  const {
    scope,
    name,
    pageId,
    fieldType,
    section,
    subsection,
    markdownB64,
  } = params || {};
  const virtual = document.createElement("div");
  virtual.className = "fe-editable md-edit mfe-virtual";
  virtual.setAttribute("data-page", pageId || "0");
  virtual.setAttribute("data-mfe-scope", scope || "field");
  virtual.setAttribute("data-mfe-name", name || "");
  if (fieldType) {
    virtual.setAttribute("data-field-type", fieldType);
  }
  virtual.setAttribute("data-mfe-markdown-kind", "scoped");
  if (section) {
    virtual.setAttribute("data-mfe-section", section);
  }
  if (subsection) {
    virtual.setAttribute("data-mfe-subsection", subsection);
  }
  const scopeKey = buildScopeKeyFromMeta({
    scopeKind: scope || "field",
    section: section || "",
    subsection: subsection || "",
    name: name || "document",
  });
  if (scopeKey) {
    virtual.setAttribute("data-mfe-key", scopeKey);
  }
  virtual.setAttribute("data-markdown-b64", markdownB64 || "");
  applyActiveOriginKeyToVirtualTarget(virtual);
  return virtual;
}

/**
 * Resolves breadcrumb clicks to existing or virtual fullscreen targets.
 * Does not perform the open/replace lifecycle itself.
 */
function resolveBreadcrumbNavigationTarget(params) {
  const {
    type,
    id,
    sectionName,
    subsectionName,
    fieldName,
    index,
  } = params || {};
  if (!activeTarget) return null;

  const lensNode = resolveLensNodeForBreadcrumb({
    type,
    contentId: id,
    section: sectionName,
    subsection: subsectionName,
    name: fieldName,
  });
  if (lensNode) {
    return buildVirtualTargetFromLensNode(lensNode);
  }

  const indexed = id ? index.byId.get(id) : null;
  if (indexed?.element) {
    return indexed.element;
  }

  const indexedScope = String(indexed?.scope || "");
  const indexedScopeMismatch =
    Boolean(indexed?.markdownB64) && indexedScope === "document";
  if (indexed?.markdownB64 && !indexedScopeMismatch) {
    const virtualScope = type === "container" ? "field" : type;
    return createBreadcrumbVirtualTarget({
      scope: virtualScope,
      name: indexed.name || fieldName,
      pageId: activeTarget.getAttribute("data-page") || "0",
      fieldType: virtualScope === "section" ? "container" : "",
      section: indexed.section || "",
      subsection: indexed.subsection || "",
      markdownB64: indexed.markdownB64,
    });
  }

  return resolveBreadcrumbNavigationTargetHelper({
    ...(params || {}),
    activeTarget,
    resolveLensNodeForBreadcrumb,
    buildVirtualTargetFromLensNode,
    activeOriginFieldKey,
    activeOriginKey,
  });
}

/**
 * Handles breadcrumb click routing for fullscreen navigation.
 * Does not own fullscreen open lifecycle beyond delegating to the existing opener.
 */
async function handleBreadcrumbClick(e) {
  const target = e.target?.closest(".mfe-breadcrumb-link");

  if (!target) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  const type = target.getAttribute("data-breadcrumb-target");
  if (!type || !activeTarget) {
    return;
  }

  debugWarn("[mfe:scope] breadcrumb:click", {
    clickedTarget: type,
    scope: activeFieldScope || "",
    name: activeFieldName || "",
    section: activeFieldSection || "",
    subsection: activeFieldSubsection || "",
    type: activeFieldType || "",
    viewMode: editorViewMode,
    activeScopedKey: getActiveScopedHtmlKey(),
  });

  if (type === "document") {
    openDocumentFromBreadcrumbPath();
    return;
  }

  const index = buildContentIndex();
  const hierarchy =
    resolveHierarchyFromSessionScopeLens() ||
    breadcrumbAnchor ||
    getActiveHierarchy();
  const sectionName =
    target.getAttribute("data-breadcrumb-section") || hierarchy.section || "";
  const subsectionName =
    target.getAttribute("data-breadcrumb-subsection") ||
    hierarchy.subsection ||
    "";
  const fieldName =
    target.getAttribute("data-breadcrumb-name") || hierarchy.name || "";
  let id = target.getAttribute("data-breadcrumb-id") || "";
  if (!id) {
    id = getBreadcrumbContentId(type, sectionName, subsectionName, fieldName);
  }

  const resolvedTarget = resolveBreadcrumbNavigationTarget({
    type,
    id,
    sectionName,
    subsectionName,
    fieldName,
    index,
  });
  if (resolvedTarget) {
    openFullscreenEditorForElement(resolvedTarget);
  }
}

function openFullscreenEditorFromPayload(payload) {
  if (!payload || !payload.element) return;
  assertExclusiveActiveHost("fullscreen:openFromPayload");
  assertCanonicalPayloadSchema(payload, "fullscreen:openFromPayload");
  const previousSessionStateId = activeSessionStateId;
  const previousOriginFieldKey = activeOriginFieldKey;
  const previousPageId = activeTarget?.getAttribute("data-page") || "";
  if (activeEditor) {
    suppressNextCloseConfirm = true;
    skipOutlineResetDuringClose = true;
    closeEditor();
  }

  const {
    syntheticSectionPreviewHtml,
    fieldType,
  } = applyActivePayloadState(payload, {
    previousSessionStateId,
    previousOriginFieldKey,
    previousPageId,
    stateReason: "openFullscreenEditorFromPayload:setActiveScope",
    bindReason: "openFullscreenEditorFromPayload:bindPrimaryState",
    ingestSource: "open-initial",
    enforceSource: "openFullscreenEditorFromPayload",
    setPrimaryEditorActive: false,
  });

  if (isInlineShellOpen()) {
    const overlay = document.querySelector(".mfe-hover-overlay");
    if (overlay) overlay.style.display = "none";
  }
  try {
    initEditor(activeDisplayMarkdown, fieldType);
  } catch (err) {
    console.error("[mfe] initEditor failed", err);
    cleanupEditorOnly();
    return;
  }
  if (splitEnabledByUser) {
    openSplit();
  }
  if (syntheticSectionPreviewHtml && primaryEditor) {
    runWithoutDirtyTracking(() => {
      primaryEditor.commands.setContent(syntheticSectionPreviewHtml, false);
    });
    primaryEditor.setEditable(false);
  }
  traceStateMutation({
    reason: "openFullscreenEditorFromPayload:syncStatusAfterOpen",
    trigger: "scope-navigation",
    mutate: () => {
      syncDirtyStatusForActiveField();
    },
  });
}

function getPayloadFromElement(target) {
  if (!(target instanceof Element)) return null;
  const fieldScope = getMetaAttr(target, "scope") || "";
  if (!CANONICAL_SCOPE_SET.has(fieldScope)) {
    throw new Error(
      `[mfe] payload invariant: invalid target scope "${fieldScope}"`,
    );
  }
  const fieldName = getMetaAttr(target, "name") || "";
  if (fieldScope !== "document" && !fieldName) {
    throw new Error("[mfe] payload invariant: target name required");
  }
  const pageId = target.getAttribute("data-page") || "";
  if (!pageId) {
    throw new Error("[mfe] payload invariant: target pageId required");
  }
  const fieldSection = getMetaAttr(target, "section") || "";
  const fieldSubsection = getMetaAttr(target, "subsection") || "";
  const canonicalStampedKey = target.getAttribute("data-mfe-key") || "";
  const explicitOriginKey = target.getAttribute("data-mfe-origin-key") || "";
  const targetMarkdown = decodeMaybeB64(
    target.getAttribute("data-markdown-b64") || "",
  );
  const markdownKind = String(
    target.getAttribute("data-mfe-markdown-kind") || "",
  )
    .trim()
    .toLowerCase();
  const payloadMeta = {
    element: target,
    markdownContent: targetMarkdown,
    markdownKind,
    fieldName: fieldName || "document",
    fieldType: target.getAttribute("data-field-type") || "tag",
    fieldScope,
    fieldSection,
    fieldSubsection,
    pageId,
  };
  const derivedFieldId = buildPayloadFieldId(payloadMeta);
  const stampedOriginMeta = parseOriginScopeMeta(canonicalStampedKey);
  const expectedScopeKey = buildScopeKeyFromMeta({
    scopeKind: fieldScope,
    section: fieldSection,
    subsection: fieldSubsection,
    name: fieldName || "document",
  });
  const stampedScopeKey = stampedOriginMeta
    ? buildScopeKeyFromMeta(stampedOriginMeta)
    : "";
  const stampedShapeMismatch =
    fieldScope !== "document" &&
    Boolean(canonicalStampedKey) &&
    Boolean(expectedScopeKey) &&
    Boolean(stampedScopeKey) &&
    stampedScopeKey !== expectedScopeKey;
  if (stampedShapeMismatch) {
    emitRuntimeShapeLog("MFE_STAMPED_KEY_SHAPE_MISMATCH", {
      stampedKey: canonicalStampedKey,
      stampedScopeKey,
      expectedScopeKey,
      fieldScope,
      fieldSection,
      fieldSubsection,
      fieldName,
    });
  }
  const resolvedOriginKey =
    explicitOriginKey ||
    (canonicalStampedKey && !stampedShapeMismatch
      ? canonicalStampedKey
      : derivedFieldId);
  return {
    ...payloadMeta,
    fieldId: derivedFieldId,
    originKey: resolvedOriginKey,
    originFieldKey: resolvedOriginKey,
    rawOriginKey: resolvedOriginKey,
  };
}

function replaceActiveEditor(payload) {
  if (!payload || !primaryEditor) return false;
  assertExclusiveActiveHost("fullscreen:replaceActiveEditor");
  assertCanonicalPayloadSchema(payload, "fullscreen:replaceActiveEditor");
  const previousSessionStateId = activeSessionStateId;
  const previousOriginFieldKey = activeOriginFieldKey;
  const previousPageId = activeTarget?.getAttribute("data-page") || "";

  const {
    effectiveMarkdown,
    syntheticSectionPreviewHtml,
    fieldName,
    fieldType,
    fieldScope,
  } = applyActivePayloadState(payload, {
    previousSessionStateId,
    previousOriginFieldKey,
    previousPageId,
    stateReason: "replaceActiveEditor:setActiveScope",
    bindReason: "replaceActiveEditor:bindPrimaryState",
    ingestSource: "replace-active",
    enforceSource: "replaceActiveEditor",
    setPrimaryEditorActive: true,
  });

  revokeRuntimeProjectionAuthorityForEditor(
    primaryEditor,
    "replaceActiveEditor:scopeRebind",
  );

  // Store original markdown for losslessness validation (only if no draft was loaded)
  originalMarkdownByFieldId.set(activeFieldId, effectiveMarkdown);

  const html = syntheticSectionPreviewHtml || "";
  const previousSelection = primaryEditor.state.selection;
  runWithoutDirtyTracking(() => {
    if (syntheticSectionPreviewHtml) {
      primaryEditor.commands.setContent(html, false);
      return;
    }
    const cleanContent = sanitizeEditorMarkdownForScope(
      effectiveMarkdown,
      fieldScope,
    );
    const doc = parseMarkdownToDoc(cleanContent || "", primaryEditor.schema);
    primaryEditor.commands.setContent(doc.toJSON(), false);
  });
  if (!syntheticSectionPreviewHtml && activeDocumentState) {
    const canonicalStateId = String(activeDocumentState.id || "");
    const seededBuffer = String(getMarkdownFromEditor(primaryEditor) || "");
    syncCanonicalProjectionRuntimeForEditor(
      canonicalStateId,
      primaryEditor,
      seededBuffer,
    );
    performCanonicalSeedNormalizationHandshake(canonicalStateId, primaryEditor);
  }
  primaryEditor.setEditable(!syntheticSectionPreviewHtml);
  try {
    primaryEditor.commands.setTextSelection(previousSelection);
  } catch (_e) {}
  if (shouldWarnForExtraContent(fieldType, fieldName)) {
    runWithoutDirtyTracking(() => {
      stripTrailingEmptyParagraph(primaryEditor);
    });
  }
  setOriginalBlockCount(
    primaryEditor,
    fieldType,
    fieldName,
    originalBlockCounts,
  );
  highlightExtraContent(primaryEditor);
  traceStateMutation({
    reason: "replaceActiveEditor:syncStatusAfterReplace",
    trigger: "scope-navigation",
    mutate: () => {
      syncDirtyStatusForActiveField();
    },
  });

  if (secondaryEditor && secondaryLang) {
    const activeSecondaryLang = secondaryLang;
    hydrateTranslationsForActiveScope("replaceActiveEditor").finally(() => {
      if (secondaryEditor && activeSecondaryLang) {
        setSecondaryLanguage(activeSecondaryLang);
      }
    });
  }

  updateWindowById("mfe-editor", {
    breadcrumbItems: buildBreadcrumbItems(),
    breadcrumbClickHandler: handleBreadcrumbClick,
  });
  applyEditorViewMode(editorViewMode);

  afterNextPaint(() => primaryEditor?.view?.focus());
  return true;
}

function resolveHostImageSrc(host, src) {
  const value = (src || "").trim();
  if (!value) return value;
  if (value.match(/^(https?:|\/|\?|\/\/)/)) {
    return value;
  }

  const cleanName = value.split("?")[0].split("#")[0].split("/").pop() || value;

  const firstHostImage = host.querySelector("img");
  const currentSrc = firstHostImage?.getAttribute("src") || "";
  const currentPath = currentSrc.split("?")[0].split("#")[0];
  const slashIndex = currentPath.lastIndexOf("/");
  if (slashIndex > -1) {
    const currentDir = currentPath.slice(0, slashIndex + 1);
    if (currentDir) {
      return `${currentDir}${cleanName}`;
    }
  }

  const filesBaseFromConfig =
    window.MarkdownFrontEditorConfig?.pageFilesBaseUrl;
  const filesBase =
    typeof filesBaseFromConfig === "string" && filesBaseFromConfig.trim() !== ""
      ? filesBaseFromConfig.endsWith("/")
        ? filesBaseFromConfig
        : `${filesBaseFromConfig}/`
      : "";
  if (filesBase) {
    return `${filesBase}${cleanName}`;
  }

  const normalizedBase = getImageBaseUrl();
  return `${normalizedBase}${value.replace(/^\/+/, "")}`;
}

function openFullscreenEditorForElement(target) {
  normalizeFieldHostIdentity(document);
  const payloadMeta = getPayloadFromElement(target);
  if (!payloadMeta) return;
  const requestedOriginKey = resolveRequestedOriginKeyPure(payloadMeta, {
    fallbackFieldId: buildPayloadFieldId(payloadMeta),
  });
  const originFieldKey = payloadMeta.originFieldKey || requestedOriginKey;
  const payloadMetaWithOrigin = {
    ...payloadMeta,
    rawOriginKey: requestedOriginKey,
    originFieldKey,
    originKey: originFieldKey,
  };

  // Check if this target is already being edited inline
  // If so, user is just trying to refocus inline editor, not switch to fullscreen
  if (target.classList.contains("mfe-inline-active")) {
    if (isInlineOpen()) {
      return;
    }
    target.classList.remove("mfe-inline-active");
  }

  const buildCanonicalPayload = () =>
    hydrateCanonicalPayload(payloadMetaWithOrigin);

  const continueOpen = (payload) => {
    const forceScopeWindow =
      payload.fieldScope === "section" || payload.fieldScope === "subsection";
    const currentSingleBlock = shouldWarnForExtraContent(
      activeFieldType,
      activeFieldName,
    );
    const incomingSingleBlock = shouldWarnForExtraContent(
      payload.fieldType,
      payload.fieldName,
    );
    const forceSchemaRebuild =
      Boolean(primaryEditor) && currentSingleBlock !== incomingSingleBlock;
    const forceNewWindow = forceScopeWindow || forceSchemaRebuild;
    if (forceNewWindow) {
      return openFullscreenEditorFromPayload(payload);
    }
    // If an editor is already open, swap content in place instead of opening a new window
    const hasOpenWindow =
      isFullscreenOpen() && overlayEl && overlayEl.isConnected && primaryEditor;
    if (hasOpenWindow && replaceActiveEditor(payload)) {
      return;
    }
    return openFullscreenEditorFromPayload(payload);
  };

  const hasActiveEditor = Boolean(
    activeEditor && activeTarget && primaryEditor,
  );
  if (hasActiveEditor) {
    Promise.resolve(keepPendingChangesBeforeSwitch()).then((ok) => {
      if (!ok) return;
      continueOpen(buildCanonicalPayload());
    });
    return;
  }

  return continueOpen(buildCanonicalPayload());
}

function recompileMountGraph() {
  normalizeFieldHostIdentity(document);
  const sections = Array.isArray(
    window.MarkdownFrontEditorConfig?.sectionsIndex,
  )
    ? window.MarkdownFrontEditorConfig.sectionsIndex
    : [];
  const fields = Array.isArray(window.MarkdownFrontEditorConfig?.fieldsIndex)
    ? window.MarkdownFrontEditorConfig.fieldsIndex
    : [];
  const semanticLookup = buildSemanticLookup({ sections, fields });
  const compiled = compileMountTargetsByKey({
    changedKeys: [],
    root: document,
    getMetaAttr,
    semanticLookup,
  });
  lastCompileReport = compiled.report || null;
  if (lastCompileReport?.graphChecksum) {
    window.__MFE_GRAPH = lastCompileReport.graphChecksum;
  }
  debugWarn("[mfe:bind] recompileMountGraph", lastCompileReport || {});
  if (lastCompileReport) {
    const rows = [
      ...(lastCompileReport.ambiguous || []).map((v) => ({
        type: "ambiguous",
        value: v,
      })),
      ...(lastCompileReport.unresolved || []).map((v) => ({
        type: "unresolved",
        value: v,
      })),
    ];
    debugTable(rows);
  }
  return lastCompileReport || { nodes: 0, ambiguous: [], unresolved: [] };
}

function isDevMode() {
  return isDevModeHelper(window.MarkdownFrontEditorConfig || {});
}

function nodeTouchesMfe(node) {
  if (!node || node.nodeType !== 1) return false;
  const el = /** @type {Element} */ (node);
  if (
    el.matches?.("[data-mfe], [data-mfe-source], [data-mfe-key]") ||
    el.closest?.("[data-mfe], [data-mfe-source], [data-mfe-key]")
  ) {
    return true;
  }
  if (el.querySelector?.("[data-mfe], [data-mfe-source], [data-mfe-key]")) {
    return true;
  }
  return false;
}

function unwatchMountGraph() {
  if (mountWatchDebounceTimer) {
    clearTimeout(mountWatchDebounceTimer);
    mountWatchDebounceTimer = null;
  }
  if (mountWatchObserver) {
    mountWatchObserver.disconnect();
    mountWatchObserver = null;
  }
  return true;
}

function watchMountGraph() {
  if (!isDevMode()) {
    debugWarn("[mfe:bind] watch unavailable outside dev mode");
    return false;
  }
  unwatchMountGraph();
  mountWatchObserver = new MutationObserver((mutations) => {
    let shouldRecompile = false;
    for (const m of mutations) {
      if (
        m.type === "attributes" &&
        (m.attributeName === "data-mfe" ||
          m.attributeName === "data-mfe-source" ||
          m.attributeName === "data-mfe-key")
      ) {
        shouldRecompile = true;
        break;
      }
      if (m.type === "childList") {
        const touched = [...(m.addedNodes || []), ...(m.removedNodes || [])];
        if (touched.some((n) => nodeTouchesMfe(n))) {
          shouldRecompile = true;
          break;
        }
      }
    }
    if (!shouldRecompile) return;
    if (mountWatchDebounceTimer) clearTimeout(mountWatchDebounceTimer);
    mountWatchDebounceTimer = setTimeout(() => {
      mountWatchDebounceTimer = null;
      recompileMountGraph();
    }, 80);
  });
  mountWatchObserver.observe(document.documentElement || document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-mfe", "data-mfe-source", "data-mfe-key"],
  });
  debugWarn("[mfe:bind] watch enabled");
  return true;
}

/**
 * Public API for ProcessWire module
 */
window.MarkdownFrontEditor = {
  /**
   * Open the fullscreen editor using the canonical save pipeline.
   * The legacy callback parameter is accepted for compatibility but ignored.
   */
  // Initialize new editor via initEditor (which uses WindowManager)
  edit(markdownContent, onSave, fieldType = "tag") {
    if (typeof onSave === "function" && onSave !== saveAllEditors) {
      debugWarn(
        "[mfe] fullscreen: legacy onSave callback ignored in favor of canonical save pipeline",
      );
    }
    initEditor(markdownContent, fieldType);
  },

  openForElement(target) {
    const opened = openFullscreenForTarget(target);
    if (!opened) {
      throw new Error(
        "[mfe] fullscreen: router unavailable for openForElement",
      );
    }
    return opened;
  },

  openForElementFromCanonical(target, canonicalState = null) {
    normalizeFieldHostIdentity(document);
    if (canonicalState && typeof canonicalState.markdown === "string") {
      assertCanonicalStateShape(
        canonicalState,
        "fullscreen:openForElementFromCanonical",
      );
      const payloadMeta = getPayloadFromElement(target);
      if (!payloadMeta) {
        throw new Error("[mfe] payload invariant: target metadata unavailable");
      }
      const checkedCanonical = ensureCanonicalMarkersForOpen({
        markdown: canonicalState.markdown,
        scope: payloadMeta.fieldScope,
        lang: normalizeLangValue(getLanguagesConfig().current),
        source: "openForElementFromCanonical:routerCanonical",
      });
      const markdown = resolveCanonicalMarkdownForPayload(
        payloadMeta,
        checkedCanonical,
      );
      openFullscreenEditorFromPayload({
        ...payloadMeta,
        markdownContent: markdown,
        canonicalHydrated: true,
      });
      return;
    }
    openFullscreenEditorForElement(target);
  },

  close() {
    closeEditor();
  },

  async flushToCanonical() {
    return flushToCanonical();
  },

  applyScopedDraftForTarget(target, markdown) {
    return applyScopedDraftForTarget(target, markdown);
  },

  getCanonicalState() {
    return getCanonicalMarkdownState();
  },

  resolveMarkdownForTarget(target, canonicalState = null) {
    normalizeFieldHostIdentity(document);
    const payloadMeta = getPayloadFromElement(target);
    if (!payloadMeta) {
      throw new Error("[mfe] canonical: target metadata unavailable");
    }
    const resolvedCanonicalState =
      canonicalState && typeof canonicalState.markdown === "string"
        ? canonicalState
        : getCanonicalMarkdownState();
    return resolveCanonicalMarkdownForPayload(
      payloadMeta,
      resolvedCanonicalState.markdown,
    );
  },

  getMarkdown() {
    return getMarkdownFromEditor();
  },

  isOpen() {
    return activeEditor !== null;
  },

  recompile() {
    return recompileMountGraph();
  },

  watch() {
    return watchMountGraph();
  },

  unwatch() {
    return unwatchMountGraph();
  },
};

window.MarkdownFrontEditorRecompile = recompileMountGraph;
