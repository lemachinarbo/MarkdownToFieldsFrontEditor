import { validateStructuralTransition } from "./structural-validator.js";
import {
  splitLeadingFrontmatter,
  hasLeadingFrontmatter,
} from "./markdown-text-utils.js";

const DOC_STATE_PREFIX = "MFE_DOC_STATE";
let docStateSeq = 0;

function normalizeText(value) {
  return typeof value === "string" ? value : "";
}

function hashStateIdentity(value) {
  const text = normalizeText(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

function getGlobalObject() {
  if (typeof window !== "undefined") return window;
  if (typeof globalThis !== "undefined") return globalThis;
  return null;
}

function isDebugMode() {
  const globalObject = getGlobalObject();
  return Boolean(globalObject?.MarkdownFrontEditorConfig?.debug === true);
}

function pushDocStateLog(event) {
  const globalObject = getGlobalObject();
  if (!globalObject) return;
  const key = "__MFE_DOC_STATE_LOGS";
  globalObject[key] = Array.isArray(globalObject[key]) ? globalObject[key] : [];
  globalObject[key].push(event);
}

function emitDocStateEvent(type, payload) {
  const event = {
    type,
    seq: ++docStateSeq,
    ts: Date.now(),
    ...payload,
  };
  pushDocStateLog(event);
  if (isDebugMode()) {
    const line = JSON.stringify(event);
    if (typeof console !== "undefined" && typeof console.info === "function") {
      console.info(DOC_STATE_PREFIX, line);
    }
  }
  return event;
}

export function emitDocStateLog(type, payload = {}) {
  return emitDocStateEvent(type, payload);
}

function emitHydrateOverwriteBlocked(payload) {
  const message = {
    type: "MFE_HYDRATE_OVERWRITE_BLOCKED",
    ...payload,
  };
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("MFE_HYDRATE_OVERWRITE_BLOCKED", JSON.stringify(message));
  }
}

const READBACK_SHAPE_ALLOWED_CLASSES = Object.freeze(["exact"]);

function resolveReadbackClassFromContext(context = {}) {
  const direct = normalizeText(context.readbackClass);
  if (direct) return direct;
  const fromObject = normalizeText(context.readbackClassification?.className);
  if (fromObject) return fromObject;
  return "";
}

function isReadbackNormalizationClass(className) {
  const normalized = normalizeText(className);
  return READBACK_SHAPE_ALLOWED_CLASSES.includes(normalized);
}

function resolveDiagnosticStack() {
  try {
    return String(new Error().stack || "");
  } catch (_error) {
    return "";
  }
}

function emitStrictWithoutClassification(payload) {
  const message = {
    type: "MFE_STRICT_WITHOUT_CLASSIFICATION",
    ...payload,
  };
  emitDocStateEvent("MFE_STRICT_WITHOUT_CLASSIFICATION", payload);
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    //console.warn("MFE_STRICT_WITHOUT_CLASSIFICATION", JSON.stringify(message));
  }
}

function emitDocumentStateShapeViolation(payload) {
  const message = {
    type: "MFE_DOCUMENT_STATE_SHAPE_VIOLATION",
    ...payload,
  };
  emitDocStateEvent("MFE_DOCUMENT_STATE_SHAPE_VIOLATION", payload);
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("MFE_DOCUMENT_STATE_SHAPE_VIOLATION", JSON.stringify(message));
  }
}

export function buildPayloadFieldId(payloadMeta) {
  const meta =
    payloadMeta && typeof payloadMeta === "object" ? payloadMeta : {};
  const pageId = normalizeText(meta.pageId) || "0";
  const scope = normalizeText(meta.fieldScope || meta.scope) || "field";
  const name = normalizeText(meta.fieldName || meta.name);
  const section = normalizeText(meta.fieldSection || meta.section);
  const subsection = normalizeText(meta.fieldSubsection || meta.subsection);
  const sub = subsection || "";
  if (sub) {
    return `${pageId}:${scope}:${section}:${sub}:${name}`;
  }
  return `${pageId}:${scope}:${section}:${name}`;
}

function failOnScopeNavigationMutation(context) {
  if (context?.trigger === "scope-navigation") {
    throw new Error(
      "[mfe] document-state: mutation forbidden during scope navigation",
    );
  }
}

function assertAllowedIntent(intent, operation, state) {
  const allowed = new Set([
    "user-edit-transaction",
    "user-command",
    "save-commit",
    "explicit-discard",
    "teardown",
  ]);

  if (operation === "hydrate") {
    if (intent !== "system-rehydrate") {
      throw new Error(
        "[mfe] document-state: hydrate requires system-rehydrate",
      );
    }
    const canHydrate = !state.isDirty();
    if (!canHydrate) {
      return false;
    }
    return true;
  }

  if (!allowed.has(intent)) {
    throw new Error(`[mfe] document-state: unsupported trigger \"${intent}\"`);
  }

  return true;
}

export class DocumentState {
  constructor(payloadMeta, lang, options = {}) {
    const meta =
      payloadMeta && typeof payloadMeta === "object" ? payloadMeta : {};
    this.payloadMeta = {
      pageId: normalizeText(meta.pageId) || "0",
      fieldScope: normalizeText(meta.fieldScope || meta.scope) || "field",
      fieldSection: normalizeText(meta.fieldSection || meta.section),
      fieldSubsection: normalizeText(meta.fieldSubsection || meta.subsection),
      fieldName: normalizeText(meta.fieldName || meta.name),
      fieldId: normalizeText(meta.fieldId) || buildPayloadFieldId(meta),
    };
    this.originKey = normalizeText(meta.originKey) || this.payloadMeta.fieldId;
    this.sessionId =
      normalizeText(meta.sessionId) ||
      normalizeText(meta.originKey) ||
      this.payloadMeta.fieldId;
    this.lang = normalizeText(lang);
    this.id = `${this.sessionId}|${this.lang}`;
    Object.defineProperty(this, "scopeKind", {
      value: this.payloadMeta.fieldScope,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    this.currentScope =
      normalizeText(options.currentScope || options.viewScope) ||
      this.payloadMeta.fieldScope;
    const persistedSplit = splitLeadingFrontmatter(
      options.initialPersistedMarkdown,
    );
    const draftInput = normalizeText(options.initialDraftMarkdown);
    const draftSplit = draftInput
      ? splitLeadingFrontmatter(draftInput)
      : persistedSplit;
    this.frontmatterRaw = draftSplit.frontmatter || persistedSplit.frontmatter;
    this._persisted = persistedSplit.body;
    this._draft = draftSplit.body;
    if (!draftInput) {
      this._draft = this._persisted;
    }
    this.flags = {
      unreplayable: false,
    };
    this.lastReadbackClassification = null;

    emitDocStateEvent("STATE_OPENED", {
      stateId: this.id,
      language: this.lang,
      stateScopeKind: this.scopeKind,
      originKey: this.originKey,
      currentScope: this.currentScope,
      reason: normalizeText(options.reason || "state-created"),
      trigger: normalizeText(options.trigger || "session-open"),
      dirtyBefore: false,
      dirtyAfter: this.isDirty(),
      hashBefore: "",
      hashAfter: hashStateIdentity(this._draft),
    });
  }

  static getOrCreate(store, payloadMeta, lang, options = {}) {
    if (!(store instanceof Map)) {
      throw new Error("[mfe] document-state: store must be a Map");
    }
    const fieldId =
      normalizeText(payloadMeta?.fieldId) || buildPayloadFieldId(payloadMeta);
    const originKey = normalizeText(payloadMeta?.originKey) || fieldId;
    const sessionId =
      normalizeText(payloadMeta?.sessionId) || originKey || fieldId;
    const stateId = `${sessionId}|${normalizeText(lang)}`;
    const existing = store.get(stateId);
    if (existing) {
      existing.recordRebound({
        reason: normalizeText(options.reason || "state-rebound"),
        trigger: normalizeText(options.trigger || "scope-navigation"),
        currentScope:
          normalizeText(options.currentScope || options.viewScope) ||
          normalizeText(payloadMeta?.fieldScope || payloadMeta?.scope) ||
          existing.currentScope,
      });
      return existing;
    }

    const state = new DocumentState(
      {
        ...(payloadMeta || {}),
        sessionId,
        originKey,
        fieldId,
      },
      lang,
      options,
    );
    store.set(state.id, state);
    return state;
  }

  _recordMutationEvent({
    type,
    reason,
    trigger,
    dirtyBefore,
    dirtyAfter,
    hashBefore,
    hashAfter,
    operation,
  }) {
    emitDocStateEvent(type, {
      operation: normalizeText(operation),
      stateId: this.id,
      language: this.lang,
      stateScopeKind: this.scopeKind,
      originKey: this.originKey,
      currentScope: this.currentScope,
      reason,
      trigger,
      dirtyBefore,
      dirtyAfter,
      hashBefore,
      hashAfter,
    });
  }

  _assertDocumentStateShape(nextBody, context = {}) {
    if (this.scopeKind !== "document") {
      return true;
    }
    const previousBody = normalizeText(this._draft || this._persisted);
    const nextCandidateBody = normalizeText(nextBody);
    const transition = validateStructuralTransition(
      previousBody,
      nextCandidateBody,
    );
    const previousGraph = transition.previous.markerGraph;
    const nextGraph = transition.next.markerGraph;
    const previousGapGraph = transition.previous.boundaryGapGraph;
    const nextGapGraph = transition.next.boundaryGapGraph;
    const readbackClass = resolveReadbackClassFromContext(context);
    if (!readbackClass) {
      emitStrictWithoutClassification({
        stateId: this.id,
        language: this.lang,
        stateScopeKind: this.scopeKind,
        originKey: this.originKey,
        currentScope: this.currentScope,
        reason: normalizeText(context.reason || "shape-assert"),
        trigger: normalizeText(context.trigger || "unknown"),
        previousMarkerCount: previousGraph.length,
        nextMarkerCount: nextGraph.length,
        previousGapBoundaryCount: previousGapGraph.length,
        nextGapBoundaryCount: nextGapGraph.length,
        stack: resolveDiagnosticStack(),
      });
      return transition.ok;
    }
    if (transition.ok) {
      return true;
    }
    if (isReadbackNormalizationClass(readbackClass)) {
      return true;
    }
    emitDocumentStateShapeViolation({
      stateId: this.id,
      language: this.lang,
      stateScopeKind: this.scopeKind,
      originKey: this.originKey,
      currentScope: this.currentScope,
      reason: normalizeText(context.reason || "shape-assert"),
      trigger: normalizeText(context.trigger || "unknown"),
      previousBytes: previousBody.length,
      nextBytes: nextCandidateBody.length,
      previousMarkerCount: previousGraph.length,
      nextMarkerCount: nextGraph.length,
      previousGapBoundaryCount: previousGapGraph.length,
      nextGapBoundaryCount: nextGapGraph.length,
      transitionReason: transition.reason,
    });
    if (isDebugMode()) {
      throw new Error("[mfe] document-state shape violation");
    }
    return false;
  }

  _mutateDraft({
    markdown,
    type,
    reason,
    trigger,
    operation = "APPLY_SLICE",
    enforceDocumentShape = true,
  }) {
    failOnScopeNavigationMutation({ trigger });
    const dirtyBefore = this.isDirty();
    const hashBefore = hashStateIdentity(this._draft);
    const nextDraft = normalizeText(markdown);
    if (
      enforceDocumentShape &&
      !this._assertDocumentStateShape(nextDraft, {
        reason,
        trigger,
      })
    ) {
      return false;
    }
    if (this._draft === nextDraft) {
      return false;
    }
    this._draft = nextDraft;
    this.flags.unreplayable = false;
    this._recordMutationEvent({
      type,
      operation,
      reason,
      trigger,
      dirtyBefore,
      dirtyAfter: this.isDirty(),
      hashBefore,
      hashAfter: hashStateIdentity(this._draft),
    });
    return true;
  }

  setDraft(markdown, context = {}) {
    const trigger = normalizeText(context.trigger || "user-edit-transaction");
    if (trigger === "save-commit") {
      if (isDebugMode()) {
        throw new Error(
          "[mfe] document-state: STATE_UPDATED forbidden during save-commit",
        );
      }
      return false;
    }
    if (!assertAllowedIntent(trigger, "draft", this)) {
      return false;
    }
    if (hasLeadingFrontmatter(markdown)) {
      if (isDebugMode()) {
        throw new Error(
          "[mfe] document-state: frontmatter is forbidden in bodyDraft",
        );
      }
      return false;
    }
    return this._mutateDraft({
      markdown,
      type: "STATE_UPDATED",
      operation: "APPLY_SLICE",
      reason: normalizeText(context.reason || "setDraft"),
      trigger,
    });
  }

  getDraft() {
    return this._draft;
  }

  getPersistedMarkdown() {
    return this._persisted;
  }

  getFrontmatterRaw() {
    return normalizeText(this.frontmatterRaw);
  }

  setFrontmatterRaw(frontmatterRaw = "") {
    this.frontmatterRaw = normalizeText(frontmatterRaw);
  }

  recomposeMarkdownForSave(bodyDraft = this._draft) {
    const body = normalizeText(bodyDraft);
    if (hasLeadingFrontmatter(body)) return body;
    if (!this.frontmatterRaw) return body;
    if (!body) return this.frontmatterRaw;
    return `${this.frontmatterRaw}${body}`;
  }

  acceptStructuralMutation(markdown, context = {}) {
    const trigger = normalizeText(context.trigger || "system-structural-mutation");
    return this._mutateDraft({
      markdown,
      type: "STATE_STRUCTURAL_MUTATION",
      operation: "APPLY_SLICE",
      reason: normalizeText(context.reason || "acceptStructuralMutation"),
      trigger,
      enforceDocumentShape: false,
    });
  }

  clearDraft(context = {}) {
    const trigger = normalizeText(context.trigger || "explicit-discard");
    if (!assertAllowedIntent(trigger, "draft", this)) {
      return false;
    }
    return this._mutateDraft({
      markdown: "",
      type: "STATE_DESTROYED",
      operation: "APPLY_SLICE",
      reason: normalizeText(context.reason || "clearDraft"),
      trigger,
      enforceDocumentShape: false,
    });
  }

  hydrateFromServer(markdown, context = {}) {
    const trigger = normalizeText(context.trigger || "system-rehydrate");
    const allow = assertAllowedIntent(trigger, "hydrate", this);
    if (!allow) {
      emitHydrateOverwriteBlocked({
        stateId: this.id,
        language: this.lang,
        stateScopeKind: this.scopeKind,
        originKey: this.originKey,
        reason: normalizeText(context.reason || "hydrate-blocked"),
        trigger,
      });
      return false;
    }

    const dirtyBefore = this.isDirty();
    const hashBefore = hashStateIdentity(this._draft);
    const hydratedSplit = splitLeadingFrontmatter(markdown);
    if (
      !this._assertDocumentStateShape(hydratedSplit.body, {
        reason: normalizeText(context.reason || "hydrateFromServer"),
        trigger,
      })
    ) {
      return false;
    }
    this.frontmatterRaw = hydratedSplit.frontmatter;
    this._persisted = hydratedSplit.body;
    this._draft = hydratedSplit.body;
    this.flags.unreplayable = false;
    this._recordMutationEvent({
      type: "STATE_HYDRATED",
      operation: "APPLY_SLICE",
      reason: normalizeText(context.reason || "hydrateFromServer"),
      trigger,
      dirtyBefore,
      dirtyAfter: this.isDirty(),
      hashBefore,
      hashAfter: hashStateIdentity(this._draft),
    });
    return true;
  }

  markSaved(markdown = this._draft, context = {}) {
    const trigger = normalizeText(context.trigger || "save-commit");
    if (!assertAllowedIntent(trigger, "draft", this)) {
      return false;
    }
    failOnScopeNavigationMutation({ trigger });
    const dirtyBefore = this.isDirty();
    const hashBefore = hashStateIdentity(this._draft);
    const normalized = normalizeText(markdown);
    const split = hasLeadingFrontmatter(normalized)
      ? splitLeadingFrontmatter(normalized)
      : {
          frontmatter: this.frontmatterRaw,
          body: normalized,
        };
    if (
      context.readbackClassification &&
      typeof context.readbackClassification === "object"
    ) {
      this.lastReadbackClassification = { ...context.readbackClassification };
    }
    if (this.scopeKind === "document") {
      const previousBody = normalizeText(this._draft || this._persisted);
      const nextCandidateBody = normalizeText(split.body);
      const transition = validateStructuralTransition(
        previousBody,
        nextCandidateBody,
      );
      const previousGraph = transition.previous.markerGraph;
      const nextGraph = transition.next.markerGraph;
      const previousGapGraph = transition.previous.boundaryGapGraph;
      const nextGapGraph = transition.next.boundaryGapGraph;
      const readbackClass = resolveReadbackClassFromContext(context);
      const graphMatched = transition.ok;
      const classAllowed = isReadbackNormalizationClass(readbackClass);
      const branchTaken = !readbackClass
        ? graphMatched
          ? "strict-without-classification-graph-match"
          : "strict-without-classification-graph-failed"
        : graphMatched
          ? "graph-match"
          : classAllowed
            ? "readback-class-allowed"
            : "shape-violation";
      emitDocStateEvent("SAVE_COMMIT_INVARIANT_DECISION", {
        previousMarkerCount: previousGraph.length,
        nextMarkerCount: nextGraph.length,
        previousGapBoundaryCount: previousGapGraph.length,
        nextGapBoundaryCount: nextGapGraph.length,
        readbackClass,
        allowedClasses: [...READBACK_SHAPE_ALLOWED_CLASSES],
        branchTaken,
        violationRaised:
          branchTaken === "shape-violation" ||
          branchTaken === "strict-without-classification-graph-failed",
        transitionReason: transition.reason,
      });
    }
    if (
      !this._assertDocumentStateShape(split.body, {
        reason: normalizeText(context.reason || "markSaved"),
        trigger,
        readbackClass: resolveReadbackClassFromContext(context),
      })
    ) {
      return false;
    }
    this.frontmatterRaw = split.frontmatter;
    this._persisted = split.body;
    this._draft = split.body;
    this.flags.unreplayable = false;
    this._recordMutationEvent({
      type: "STATE_SAVED",
      operation: "SAVE_LANG",
      reason: normalizeText(context.reason || "markSaved"),
      trigger,
      dirtyBefore,
      dirtyAfter: this.isDirty(),
      hashBefore,
      hashAfter: hashStateIdentity(this._draft),
    });
    return true;
  }

  getLastReadbackClassification() {
    return this.lastReadbackClassification
      ? { ...this.lastReadbackClassification }
      : null;
  }

  recordRebound(context = {}) {
    const nextScope =
      normalizeText(context.currentScope || this.currentScope) ||
      this.currentScope;
    this.currentScope = nextScope;
    emitDocStateEvent("STATE_REBOUND", {
      operation: "REBOUND_SCOPE",
      stateId: this.id,
      language: this.lang,
      stateScopeKind: this.scopeKind,
      originKey: this.originKey,
      currentScope: this.currentScope,
      reason: normalizeText(context.reason || "state-rebound"),
      trigger: normalizeText(context.trigger || "scope-navigation"),
      dirtyBefore: this.isDirty(),
      dirtyAfter: this.isDirty(),
      hashBefore: hashStateIdentity(this._draft),
      hashAfter: hashStateIdentity(this._draft),
    });
  }

  isDirty() {
    return this._draft !== this._persisted;
  }

  markUnreplayable() {
    this.flags.unreplayable = true;
  }

  isUnreplayable() {
    return Boolean(this.flags.unreplayable);
  }
}

export function getDocumentState(store, payloadMeta, lang, options = {}) {
  return DocumentState.getOrCreate(store, payloadMeta, lang, options);
}

export function clearDocumentState(store, stateId) {
  if (!(store instanceof Map) || !stateId) return false;
  const state = store.get(stateId);
  if (!state) return false;
  const didClear = state.clearDraft({
    reason: "clearDocumentState",
    trigger: "teardown",
  });
  const removed = store.delete(stateId);
  if (removed && !didClear) {
    emitDocStateEvent("STATE_DESTROYED", {
      stateId: state.id,
      language: state.lang,
      stateScopeKind: state.scopeKind,
      originKey: state.originKey,
      currentScope: state.currentScope,
      reason: "clearDocumentState:removeOnly",
      trigger: "teardown",
      dirtyBefore: state.isDirty(),
      dirtyAfter: false,
      hashBefore: hashStateIdentity(state.getDraft()),
      hashAfter: hashStateIdentity(""),
    });
  }
  return removed;
}

export function listDocumentStates(store) {
  if (!(store instanceof Map)) return [];
  return Array.from(store.values());
}

export function emitStatesSavedBatch(stateIds, context = {}) {
  const ids = Array.isArray(stateIds)
    ? stateIds.filter((value) => typeof value === "string" && value)
    : [];
  if (ids.length === 0) return null;
  return emitDocStateEvent("STATES_SAVED_BATCH", {
    stateId: ids.join(","),
    language: normalizeText(context.language || "*"),
    originKey: normalizeText(context.originKey || "batch"),
    currentScope: normalizeText(context.currentScope || ""),
    reason: normalizeText(context.reason || "batch-save"),
    trigger: normalizeText(context.trigger || "save-commit"),
    dirtyBefore: Boolean(context.dirtyBefore),
    dirtyAfter: Boolean(context.dirtyAfter),
    hashBefore: normalizeText(context.hashBefore || "batch"),
    hashAfter: normalizeText(context.hashAfter || "batch"),
    stateIds: ids,
  });
}

export function __testResetDocStateSeq() {
  docStateSeq = 0;
}
