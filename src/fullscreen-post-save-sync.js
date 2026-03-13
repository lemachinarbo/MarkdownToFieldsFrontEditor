import {
  buildSemanticLookup,
  collectMountTargetsByKey,
  compileMountTargetsByKey,
  detectCanonicalScopedKeyOrderViolation,
  syncEditableMarkdownAttributesFromFieldsIndex as syncFieldsIndexToEditableAttrs,
} from "./sync-by-key.js";
import {
  buildFragmentStaleScopeEventDetail,
  sortCanonicalScopedKeys,
} from "./fragment-stale-scope-event.js";
import { clearDraftsCoveredByChangedKeys } from "./draft-utils.js";
import {
  fetchCsrfToken,
  getFragmentsUrl,
  parseMarkdownToDoc,
  trimTrailingLineBreaks,
} from "./editor-core.js";
import {
  normalizeLineEndingsToLf,
  splitLeadingFrontmatter,
} from "./markdown-text-utils.js";
import {
  applyChangedHtmlEditableOnly,
  applyDatastarPatchElement,
  applyDatastarPatchToNodes,
  applyEditableFallbackInSectionHosts,
  hasDescendantScopedDrafts,
  isDescendantKey,
  isScopeOrDescendantKey,
  keyDepth,
  parseDatastarEventBlock,
  syncNonEditableImagesFromPatch,
} from "./fullscreen-preview-sync.js";
import { resolveMarkdownForScopeFromCanonical } from "./canonical-state.js";

/**
 * Requests rendered fragment patches and applies safe patch ordering rules.
 * Does not participate in canonical save authority or mutation routing.
 */
export async function requestRenderedFragmentsDatastar({
  pageId,
  lang,
  keys,
  mountTargets,
  graphChecksum,
  graphNodeCount,
  graphKeys,
  patchCycleCounter,
  hasPendingUnsavedChanges,
  resolveHostImageSrc,
  debugWarn,
  debugInfo,
  isInlineOpen,
  draftScopedKeys = [],
}) {
  const cycleId = Number(patchCycleCounter?.next?.() || 0);
  debugWarn("[mfe:fragment-api] request", {
    cycleId,
    pageId,
    lang: lang || "",
    keys: Array.isArray(keys) ? keys : [],
    mountTargetKeys: Object.keys(mountTargets || {}),
  });
  const csrf = await fetchCsrfToken();
  const formData = new FormData();
  formData.append("pageId", String(pageId || "0"));
  if (lang) formData.append("lang", String(lang));
  const renderPath =
    typeof window !== "undefined" && window.location
      ? `${window.location.pathname || ""}${window.location.search || ""}`
      : "";
  if (renderPath) formData.append("renderPath", renderPath);
  formData.append("transport", "datastar");
  formData.append("keys", JSON.stringify(keys || []));
  formData.append("mountTargets", JSON.stringify(mountTargets || {}));
  if (graphChecksum) formData.append("graphChecksum", String(graphChecksum));
  if (Number.isFinite(graphNodeCount) && graphNodeCount > 0) {
    formData.append("graphNodeCount", String(graphNodeCount));
  }
  if (Array.isArray(graphKeys) && graphKeys.length > 0) {
    formData.append("graphKeys", JSON.stringify(graphKeys));
  }
  if (csrf) formData.append(csrf.name, csrf.value);

  const response = await fetch(getFragmentsUrl(), {
    method: "POST",
    body: formData,
    credentials: "same-origin",
    headers: {
      Accept: "text/event-stream",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) return { updated: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let updated = 0;
  let events = 0;
  let patches = 0;
  let signals = 0;
  const applied = [];
  const queued = [];
  const missingKeys = [];
  const skippedSectionKeys = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n/);
    buffer = chunks.pop() || "";
    chunks.forEach((chunk) => {
      const evt = parseDatastarEventBlock(chunk);
      if (!evt) return;
      events += 1;
      if (evt.event === "datastar-patch-signals") {
        signals += 1;
        try {
          const parsedSignals = JSON.parse(evt.payload?.signals || "{}");
          const missing = Array.isArray(parsedSignals?.mfe_missing)
            ? parsedSignals.mfe_missing
            : [];
          missing.forEach((key) => {
            if (typeof key === "string" && key.trim() !== "") {
              missingKeys.push(key.trim());
            }
          });
        } catch (error) {
          debugWarn("[mfe:fragment-api] invalid signal payload", {
            payload: evt.payload || {},
            message: error?.message || String(error),
          });
        }
        debugWarn("[mfe:fragment-api] signal", evt.payload || {});
        return;
      }
      if (evt.event !== "datastar-patch-elements") return;
      patches += 1;
      queued.push({
        key: evt.payload.key || "",
        selector: evt.payload.selector || "",
        mode: evt.payload.mode || "inner",
        elements: evt.payload.elements || "",
      });
    });
  }
  if (buffer.trim() !== "") {
    const evt = parseDatastarEventBlock(buffer);
    if (evt && evt.event === "datastar-patch-elements") {
      patches += 1;
      queued.push({
        key: evt.payload.key || "",
        selector: evt.payload.selector || "",
        mode: evt.payload.mode || "inner",
        elements: evt.payload.elements || "",
      });
    }
  }

  queued.sort((a, b) => keyDepth(a.key) - keyDepth(b.key));
  const staleScopeEventDetail = buildFragmentStaleScopeEventDetail({
    cycleId,
    requestedKeys: Array.isArray(keys) ? keys : [],
    missingKeys,
  });
  const staleScopeKeys = Array.isArray(staleScopeEventDetail?.staleScopeKeys)
    ? staleScopeEventDetail.staleScopeKeys
    : [];
  const orderedMissingKeys = Array.isArray(staleScopeEventDetail?.missingKeys)
    ? staleScopeEventDetail.missingKeys
    : sortCanonicalScopedKeys(missingKeys);
  if (staleScopeEventDetail) {
    window.dispatchEvent(
      new CustomEvent("mfe:fragment-stale-scope", {
        detail: staleScopeEventDetail,
      }),
    );
  }
  const appliedParents = new Set();
  const queuedScopedKeys = queued
    .map((entry) => String(entry.key || "").trim())
    .filter(Boolean);
  const strictSectionReplace =
    window.MarkdownFrontEditorConfig?.strictSectionReplace !== false;
  queued.forEach((patch) => {
    if (
      staleScopeKeys.some((scopeKey) =>
        isScopeOrDescendantKey(patch.key, scopeKey),
      )
    ) {
      if (
        (patch.key?.startsWith("section:") ||
          patch.key?.startsWith("subsection:")) &&
        !skippedSectionKeys.includes(patch.key)
      ) {
        skippedSectionKeys.push(patch.key);
      }
      debugWarn("[mfe:fragment-api] scope patch skipped", {
        cycleId,
        key: patch.key,
        selector: patch.selector,
        reason: "stale-scope-incomplete",
      });
      return;
    }
    for (const parent of appliedParents) {
      if (isDescendantKey(patch.key, parent)) {
        debugWarn("[mfe:fragment-api] patch skipped child-after-parent", {
          key: patch.key,
          parent,
          selector: patch.selector,
        });
        return;
      }
    }
    const patchHtml = patch.elements || "";
    const candidateNodes = Array.from(document.querySelectorAll(patch.selector || ""));
    const keyParts = String(patch.key || "").split(":");
    const isSectionParentKey =
      patch.key?.startsWith("section:") && keyParts.length === 2;
    const isSubsectionParentKey =
      patch.key?.startsWith("subsection:") && keyParts.length === 3;
    const hasQueuedDescendantKey = queuedScopedKeys.some((queuedKey) =>
      isDescendantKey(queuedKey, patch.key),
    );
    const isNestedScopeReplaceRisk =
      (isSectionParentKey || isSubsectionParentKey) &&
      candidateNodes.some(
        (node) =>
          node &&
          (node.classList?.contains("fe-editable") ||
            node.querySelector?.(".fe-editable")),
      ) &&
      !patchHtml.includes("fe-editable");
    const isParentWithoutEditablePayload =
      (isSectionParentKey || isSubsectionParentKey) &&
      hasQueuedDescendantKey &&
      !patchHtml.includes("fe-editable");
    if (isParentWithoutEditablePayload) {
      const safeNodes = candidateNodes.filter(
        (node) =>
          node &&
          !node.classList?.contains("fe-editable") &&
          !node.querySelector?.(".fe-editable"),
      );
      if (safeNodes.length > 0) {
        const safeUpdated = applyDatastarPatchToNodes({
          nodes: safeNodes,
          mode: patch.mode || "inner",
          elements: patchHtml,
          cycleId,
        });
        updated += safeUpdated;
        applied.push({
          key: patch.key || "",
          selector: patch.selector || "",
          mode: patch.mode || "inner",
          htmlLen: (patch.elements || "").length,
          updated: safeUpdated,
        });
        debugWarn("[mfe:fragment-api] scope patch partial", {
          cycleId,
          key: patch.key,
          selector: patch.selector,
          reason: "descendant-keys-safe-noneditable",
          safeNodeCount: safeNodes.length,
          updated: safeUpdated,
        });
        return;
      }

      const imageSynced = candidateNodes.reduce(
        (count, node) =>
          count + syncNonEditableImagesFromPatch(node, patchHtml, resolveHostImageSrc),
        0,
      );
      if (imageSynced > 0) {
        applied.push({
          key: patch.key || "",
          selector: patch.selector || "",
          mode: "image-sync",
          htmlLen: (patch.elements || "").length,
          updated: imageSynced,
        });
        updated += imageSynced;
        debugWarn("[mfe:fragment-api] scope patch partial", {
          cycleId,
          key: patch.key,
          selector: patch.selector,
          reason: "descendant-keys-noneditable-image-sync",
          updated: imageSynced,
        });
        return;
      }

      if (!skippedSectionKeys.includes(patch.key)) {
        skippedSectionKeys.push(patch.key);
      }
      debugWarn("[mfe:fragment-api] scope patch skipped", {
        cycleId,
        key: patch.key,
        selector: patch.selector,
        reason: "descendant-keys-present",
        hasQueuedDescendantKey,
      });
      return;
    }
    if (isNestedScopeReplaceRisk) {
      if (strictSectionReplace) {
        const hasInlineOpen = isInlineOpen();
        const hasFullscreenUnsaved = hasPendingUnsavedChanges();
        const hasDescendantDrafts = hasDescendantScopedDrafts(
          patch.key,
          draftScopedKeys,
        );
        const canStrictReplace =
          !hasInlineOpen && !hasFullscreenUnsaved && !hasDescendantDrafts;
        if (!canStrictReplace) {
          if (!skippedSectionKeys.includes(patch.key)) {
            skippedSectionKeys.push(patch.key);
          }
          debugWarn("[mfe:fragment-api] scope patch skipped", {
            cycleId,
            key: patch.key,
            selector: patch.selector,
            reason: "unsafe-state",
            hasInlineOpen,
            hasFullscreenUnsaved,
            hasDescendantDrafts,
          });
          return;
        }
      } else {
        if (!skippedSectionKeys.includes(patch.key)) {
          skippedSectionKeys.push(patch.key);
        }
        debugWarn("[mfe:fragment-api] scope patch skipped", {
          cycleId,
          key: patch.key,
          selector: patch.selector,
          reason: "strict-disabled",
        });
        return;
      }
    }
    const appliedCount = applyDatastarPatchElement({
      selector: patch.selector || "",
      mode: patch.mode || "inner",
      elements: patchHtml,
      cycleId,
    });
    updated += appliedCount;
    if (appliedCount > 0 && patch.key) {
      appliedParents.add(patch.key);
    }
    applied.push({
      key: patch.key || "",
      selector: patch.selector || "",
      mode: patch.mode || "inner",
      htmlLen: (patch.elements || "").length,
      updated: appliedCount,
    });
    debugWarn("[mfe:fragment-api] patch", {
      cycleId,
      key: patch.key || "",
      selector: patch.selector || "",
      mode: patch.mode || "inner",
      htmlLen: (patch.elements || "").length,
      updated: appliedCount,
    });
    if (isNestedScopeReplaceRisk && appliedCount > 0) {
      debugInfo("[mfe:fragment-api] scope patch applied", {
        cycleId,
        key: patch.key,
        selector: patch.selector,
        updated: appliedCount,
        strictSectionReplace,
      });
    }
  });

  const result = {
    cycleId,
    updated,
    events,
    patches,
    signals,
    missingKeys: orderedMissingKeys,
    skippedSectionKeys,
    staleScopeKeys,
    applied,
  };
  debugWarn("[mfe:fragment-api] result", result);
  return result;
}

/**
 * Applies post-save fragment patches and reseeds the active fullscreen editor.
 * Does not participate in canonical save authority or mutation routing.
 */
export async function handlePrimarySaveResponse({
  data,
  finalMarkdown,
  options = {},
  activeFieldScope,
  activeFieldId,
  activeTarget,
  primaryEditor,
  statusManager,
  primaryDraftsByFieldId,
  draftMarkdownByScopedKey,
  getActiveScopedHtmlKey,
  syncDirtyStatusForActiveField,
  setDocumentDraftMarkdown,
  traceStateMutation,
  writeDocumentMarkdownCache,
  requestRenderedFragments,
  setLastCompileReport,
  getLanguagesConfig,
  resolveHostImageSrc,
  debugWarn,
  debugInfo,
  debugTable,
  isDevMode,
  annotateBoundImages,
  initEditors,
  setActiveMarkdownState,
  enforceBodyOnlyEditorInput,
  sanitizeEditorMarkdownForScope,
  decodeMaybeB64,
  encodeMarkdownBase64,
  normalizeCanonicalMarkdownForIngress,
  normalizeScopeKind,
  normalizeLangValue,
  runWithoutDirtyTracking,
  getMetaAttr,
}) {
  const {
    updateActiveEditor = true,
    documentCacheFallbackB64 = "",
    preferDocumentCacheFallback = false,
    savedScopeKind = "",
  } = options;
  const resolvedSavedScopeKind =
    normalizeScopeKind(savedScopeKind || activeFieldScope || "field");
  const activeScopedKey = getActiveScopedHtmlKey();
  const htmlMapKeys =
    data?.htmlMap && typeof data.htmlMap === "object"
      ? Object.keys(data.htmlMap)
      : [];
  const htmlMapOrderViolation =
    htmlMapKeys.length > 1
      ? detectCanonicalScopedKeyOrderViolation(htmlMapKeys)
      : null;
  if (htmlMapOrderViolation) {
    debugWarn("[mfe:save-sync] htmlMap key ordering violation", {
      actual: htmlMapOrderViolation.actual,
      expected: htmlMapOrderViolation.expected,
    });
  }
  const htmlMap =
    data.fragments ||
    data.htmlMap ||
    (typeof data.html === "object" ? data.html : {});
  const changedKeys =
    Array.isArray(data.changed) && data.changed.length
      ? data.changed
      : activeScopedKey
        ? [activeScopedKey]
        : [];
  const rawRequestedKeysFromServer = Array.from(
    new Set((Array.isArray(changedKeys) ? changedKeys : []).filter(Boolean)),
  );
  const canonicalResponseKeys = new Set(
    htmlMap && typeof htmlMap === "object" ? Object.keys(htmlMap) : [],
  );
  const requestedKeysFromServer =
    canonicalResponseKeys.size > 0
      ? rawRequestedKeysFromServer.filter((key) => canonicalResponseKeys.has(key))
      : rawRequestedKeysFromServer;
  debugWarn("[mfe:save-sync] fragment response", {
    activeScopedKey,
    changedKeys,
    requestedKeys: requestedKeysFromServer,
    hasFragments: Boolean(data.fragments),
    fragmentsKeys: data.fragments ? Object.keys(data.fragments).length : 0,
    htmlMapKeys: data.htmlMap ? Object.keys(data.htmlMap).length : 0,
  });
  traceStateMutation({
    reason: "handlePrimarySaveResponse:applySavedState",
    trigger: "save-commit",
    mutate: () => {
      if (resolvedSavedScopeKind === "document") {
        primaryDraftsByFieldId.clear();
        draftMarkdownByScopedKey.clear();
        setDocumentDraftMarkdown("");
      } else {
        clearDraftsCoveredByChangedKeys({
          changedKeys,
          draftMarkdownByScopedKey,
          primaryDraftsByFieldId,
          clearDirtyByFieldId: (fieldId) => statusManager.clearDirty(fieldId),
        });
        if (activeFieldId) {
          primaryDraftsByFieldId.delete(activeFieldId);
        }
        if (activeScopedKey) {
          draftMarkdownByScopedKey.delete(activeScopedKey);
        }
      }
      syncDirtyStatusForActiveField();
    },
  });

  if (data.sectionsIndex) {
    window.MarkdownFrontEditorConfig = window.MarkdownFrontEditorConfig || {};
    window.MarkdownFrontEditorConfig.sectionsIndex = data.sectionsIndex;
  }
  if (data.fieldsIndex) {
    window.MarkdownFrontEditorConfig = window.MarkdownFrontEditorConfig || {};
    window.MarkdownFrontEditorConfig.fieldsIndex = data.fieldsIndex;
  }
  const nextDocumentB64 = preferDocumentCacheFallback
    ? documentCacheFallbackB64 || data.documentMarkdownB64
    : data.documentMarkdownB64 || documentCacheFallbackB64;
  if (nextDocumentB64) {
    writeDocumentMarkdownCache({
      markdownB64: nextDocumentB64,
      source: "handlePrimarySaveResponse",
    });
  }
  const sections = Array.isArray(window.MarkdownFrontEditorConfig?.sectionsIndex)
    ? window.MarkdownFrontEditorConfig.sectionsIndex
    : [];
  const fields = Array.isArray(window.MarkdownFrontEditorConfig?.fieldsIndex)
    ? window.MarkdownFrontEditorConfig.fieldsIndex
    : [];
  const semanticLookup = buildSemanticLookup({ sections, fields });

  const compiled = compileMountTargetsByKey({
    changedKeys: requestedKeysFromServer,
    root: document,
    getMetaAttr,
    semanticLookup,
  });
  const mountTargets =
    compiled.targetsByKey ||
    collectMountTargetsByKey({
      changedKeys: requestedKeysFromServer,
      root: document,
      getMetaAttr,
      semanticLookup,
    });
  const requestedKeys = Object.keys(mountTargets || {});
  const nonMountedRequestedKeys = requestedKeysFromServer.filter(
    (key) => !requestedKeys.includes(key),
  );
  setLastCompileReport(compiled.report || null);
  debugWarn("[mfe:fragment-sync] mount targets", {
    changedKeys: requestedKeysFromServer,
    targetKeys: requestedKeys,
    nonMountedRequestedKeys,
    report: compiled.report || null,
  });
  if (compiled.report?.graphChecksum) {
    window.__MFE_GRAPH = compiled.report.graphChecksum;
  }
  if (compiled.report?.ambiguous?.length || compiled.report?.unresolved?.length) {
    debugWarn("[mfe:bind] compile report", compiled.report);
    const rows = [
      ...(compiled.report.ambiguous || []).map((value) => ({
        type: "ambiguous",
        value,
      })),
      ...(compiled.report.unresolved || []).map((value) => ({
        type: "unresolved",
        value,
      })),
    ];
    debugTable(rows);
  }

  const { current } = getLanguagesConfig();
  const currentPageId =
    activeTarget?.getAttribute("data-page") ||
    activeFieldId?.split(":")?.[0] ||
    "0";
  if (!requestedKeys.length) {
    debugWarn(
      "[mfe:fragment-sync] no canonical mount keys, preview patch skipped",
      {
        changedKeys: requestedKeysFromServer,
      },
    );
  } else {
    try {
      const patchResult = await requestRenderedFragments({
        pageId: currentPageId,
        lang: current,
        keys: requestedKeys,
        mountTargets,
        graphChecksum: compiled.report?.graphChecksum || "",
        graphNodeCount: Number(compiled.report?.graphNodeCount || 0),
        graphKeys: Array.isArray(compiled.report?.graphKeys)
          ? compiled.report.graphKeys
          : [],
      });
      if (isDevMode()) {
        const appliedKeys = Array.from(
          new Set(
            (Array.isArray(patchResult?.applied) ? patchResult.applied : [])
              .filter((entry) => Number(entry?.updated || 0) > 0)
              .map((entry) => String(entry?.key || ""))
              .filter(Boolean),
          ),
        );
        const skippedKeys = Array.from(
          new Set([
            ...nonMountedRequestedKeys,
            ...requestedKeys.filter((key) => !appliedKeys.includes(key)),
          ]),
        );
        debugWarn("[mfe:fragment-sync] coverage", {
          cycleId: patchResult?.cycleId,
          requestedKeys,
          appliedKeys,
          skippedKeys,
        });
      }
      const staleScopeKeys = Array.isArray(patchResult?.staleScopeKeys)
        ? patchResult.staleScopeKeys
        : [];
      if (Array.isArray(patchResult?.missingKeys) && patchResult.missingKeys.length) {
        const fallbackMissingKeys = patchResult.missingKeys.filter(
          (key) =>
            !staleScopeKeys.some((scopeKey) =>
              isScopeOrDescendantKey(key, scopeKey),
            ),
        );
        const editableFallbackUpdated = applyChangedHtmlEditableOnly({
          changedKeys: fallbackMissingKeys,
          htmlMap,
          resolveHostImageSrc,
        });
        debugWarn("[mfe:fragment-sync] missing-key editable fallback", {
          missingKeys: fallbackMissingKeys,
          editableFallbackUpdated,
        });
      }
      if (
        Array.isArray(patchResult?.skippedSectionKeys) &&
        patchResult.skippedSectionKeys.length
      ) {
        const fallbackSectionKeys = patchResult.skippedSectionKeys.filter(
          (key) => !staleScopeKeys.includes(key),
        );
        const sectionEditableUpdated = applyEditableFallbackInSectionHosts({
          sectionKeys: fallbackSectionKeys,
          mountTargets,
          htmlMap,
          resolveHostImageSrc,
        });
        debugWarn("[mfe:fragment-sync] skipped-section editable fallback", {
          skippedSectionKeys: fallbackSectionKeys,
          sectionEditableUpdated,
        });
      }
      debugWarn("[mfe:fragment-sync] datastar applied", patchResult);
    } catch (error) {
      debugWarn("[mfe:fragment-sync] datastar fetch failed, preview skipped", {
        message: error?.message || String(error),
        changedKeys: requestedKeys,
      });
    }
  }
  syncFieldsIndexToEditableAttrs({
    root: document,
    fields,
    sections,
    getMetaAttr,
    decodeMarkdownBase64: decodeMaybeB64,
  });
  annotateBoundImages();
  initEditors();

  if (updateActiveEditor && activeTarget) {
    const currentScopedMarkdown = trimTrailingLineBreaks(
      typeof finalMarkdown === "string" ? finalMarkdown : "",
    );
    const currentLang = normalizeLangValue(getLanguagesConfig().current);
    const canonicalMarkdown = nextDocumentB64
      ? normalizeCanonicalMarkdownForIngress(decodeMaybeB64(nextDocumentB64), {
          enforceDocumentBodyLeadingBreakPolicy: true,
        })
      : "";
    const canonicalBody = canonicalMarkdown
      ? splitLeadingFrontmatter(canonicalMarkdown).body
      : "";
    const activeScope = getMetaAttr(activeTarget, "scope") || "field";
    const activeName = getMetaAttr(activeTarget, "name") || "";
    const activeSection = getMetaAttr(activeTarget, "section") || "";
    const activeSubsection = getMetaAttr(activeTarget, "subsection") || "";
    let scopedMarkdown = currentScopedMarkdown;
    if (activeScope === "document") {
      scopedMarkdown = canonicalBody
        ? trimTrailingLineBreaks(canonicalBody)
        : currentScopedMarkdown;
    } else if (canonicalBody) {
      try {
        scopedMarkdown = resolveMarkdownForScopeFromCanonical({
          markdown: canonicalBody,
          scope: activeScope,
          section: activeSection,
          subsection: activeSubsection,
          name: activeName,
        });
      } catch (error) {
        debugWarn("[mfe:save-sync] scoped canonical resolve fallback", {
          scope: activeScope,
          section: activeSection,
          subsection: activeSubsection,
          name: activeName,
          error: error?.message || String(error),
        });
        scopedMarkdown = currentScopedMarkdown;
      }
    }

    activeTarget.dataset.markdown = scopedMarkdown;
    if (activeTarget.classList?.contains("fe-editable")) {
      activeTarget.setAttribute(
        "data-markdown-b64",
        encodeMarkdownBase64(scopedMarkdown),
      );
    }
    setActiveMarkdownState({
      rawMarkdown: scopedMarkdown,
      displayMarkdown: scopedMarkdown,
    });
    if (primaryEditor) {
      const editorBody = enforceBodyOnlyEditorInput(scopedMarkdown, {
        source: "handlePrimarySaveResponse:updateActiveEditor",
        lang: currentLang,
        scope: activeScope,
      });
      const sanitizedEditorBody = sanitizeEditorMarkdownForScope(
        editorBody,
        activeScope,
      );
      const selection = primaryEditor.state.selection;
      runWithoutDirtyTracking(() => {
        try {
          const canonicalDoc = parseMarkdownToDoc(
            sanitizedEditorBody,
            primaryEditor.schema,
          );
          primaryEditor.commands.setContent(canonicalDoc.toJSON(), false);
        } catch (error) {
          debugWarn("[mfe:editor-sync] parse-failed:updateActiveEditor", {
            scope: activeScope,
            lang: currentLang,
            error: error?.message || String(error),
          });
        }
      });
      primaryEditor.commands.setTextSelection(selection);
    }
  }
}
