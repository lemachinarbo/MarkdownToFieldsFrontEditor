/**
 * Tiptap-based Markdown Editor for MarkdownToFields
 *
 * Uses Tiptap v.3 with prosemirror-markdown for markdown serialization.
 * This editor provides WYSIWYG editing while preserving markdown integrity.
 */

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { NodeSelection } from "prosemirror-state";
import { createToolbarButtons } from "./editor-toolbar.js";
import { renderToolbarButtons } from "./editor-toolbar-renderer.js";
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
  decodeMarkdownBase64,
  decodeHtmlEntitiesInFences,
  trimTrailingLineBreaks,
  getLanguagesConfig,
  fetchTranslations,
  saveTranslation,
  getSaveUrl,
  getFragmentsUrl,
  fetchCsrfToken,
  assertMarkdownInvariant,
  validateSerializerLosslessness,
} from "./editor-core.js";
import {
  InlineHtmlLabelExtension,
  UnderlineMark,
  SuperscriptMark,
  SubscriptMark,
  createMfeImageExtension,
} from "./editor-tiptap-extensions.js";
import {
  getMetaAttr,
  getImageBaseUrl,
  setOriginalBlockCount,
  getOriginalBlockCount,
  applyFieldAttributes,
  stripTrailingEmptyParagraph,
  getMarkdownFromEditor,
  stripMfeMarkersForFieldScope,
} from "./editor-shared-helpers.js";
import { Marker } from "./marker-extension.js";
import {
  buildContentIndex,
  getSectionEntry,
  getSubsectionEntry,
  getFieldsIndex,
  findSectionNameForSubsection,
} from "./content-index.js";
import { createImagePicker } from "./image-picker.js";
import {
  normalizeComparableMarkdown,
  parseFieldId,
  clearDraftsCoveredByChangedKeys,
} from "./draft-utils.js";
import {
  buildSemanticLookup,
  scopedHtmlKeyFromMeta,
  collectMountTargetsByKey,
  compileMountTargetsByKey,
  syncEditableMarkdownAttributesFromFieldsIndex as syncFieldsIndexToEditableAttrs,
} from "./sync-by-key.js";
import { openWindow, closeWindow, updateWindowById } from "./window-manager.js";

let activeEditor = null;
let primaryEditor = null;
let secondaryEditor = null;
let secondaryLang = "";
let translationsCache = null;
const translationsCacheByFieldId = new Map();
const originalBlockCounts = new WeakMap();
let editorShell = null;
let editorContainer = null;
let overlayEl = null;
let splitPane = null;
let saveStatusEl = null;
let refreshToolbarState = null;
let primaryDirty = false;
const dirtyTranslations = new Map();
let activeTarget = null;
let activeFieldName = null;
let activeFieldType = null; // "tag" or "container"
let activeFieldScope = "field";
let activeFieldSection = "";
let activeFieldSubsection = "";
let activeFieldId = null;
let activeRawMarkdown = null;
let activeDisplayMarkdown = null;
let suppressNextCloseConfirm = false;
const primaryDraftsByFieldId = new Map();
const originalMarkdownByFieldId = new Map();
const draftMarkdownByScopedKey = new Map();
let suppressDirtyTracking = 0;
let breadcrumbAnchor = null;
let navigatingViaBreadcrumb = false;
let lastCompileReport = null;
let patchCycleCounter = 0;
let mountWatchObserver = null;
let mountWatchDebounceTimer = null;

function debugWarn(...args) {
  if (!isDevMode()) return;
  console.warn(...args);
}

function debugInfo(...args) {
  if (!isDevMode()) return;
  console.info(...args);
}

function debugTable(rows) {
  if (!isDevMode()) return;
  if (!console.table) return;
  if (!Array.isArray(rows) || !rows.length) return;
  console.table(rows);
}

function runWithoutDirtyTracking(fn) {
  suppressDirtyTracking += 1;
  try {
    return fn();
  } finally {
    suppressDirtyTracking = Math.max(0, suppressDirtyTracking - 1);
  }
}

function hasActivePrimaryDraft() {
  if (activeFieldId && primaryDraftsByFieldId.has(activeFieldId)) return true;
  const scopedKey = getActiveScopedHtmlKey();
  if (scopedKey && draftMarkdownByScopedKey.has(scopedKey)) return true;
  return false;
}

function syncDirtyStatusForActiveField() {
  if (!activeFieldId) return;
  if (hasPendingUnsavedChanges()) {
    statusManager.markDirty(activeFieldId);
    return;
  }
  statusManager.clearDirty(activeFieldId);
}

async function handlePrimarySaveResponse(data, finalMarkdown, options = {}) {
  const { updateActiveEditor = true } = options;
  const activeScopedKey = getActiveScopedHtmlKey();
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
      ? rawRequestedKeysFromServer.filter((key) =>
          canonicalResponseKeys.has(key),
        )
      : rawRequestedKeysFromServer;
  debugWarn("[mfe:save-sync] fragment response", {
    activeScopedKey,
    changedKeys,
    requestedKeys: requestedKeysFromServer,
    hasFragments: Boolean(data.fragments),
    fragmentsKeys: data.fragments ? Object.keys(data.fragments).length : 0,
    htmlMapKeys: data.htmlMap ? Object.keys(data.htmlMap).length : 0,
  });
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
  primaryDirty = false;
  syncDirtyStatusForActiveField();

  if (data.sectionsIndex) {
    window.MarkdownFrontEditorConfig = window.MarkdownFrontEditorConfig || {};
    window.MarkdownFrontEditorConfig.sectionsIndex = data.sectionsIndex;
  }
  if (data.fieldsIndex) {
    window.MarkdownFrontEditorConfig = window.MarkdownFrontEditorConfig || {};
    window.MarkdownFrontEditorConfig.fieldsIndex = data.fieldsIndex;
  }
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
    (k) => !requestedKeys.includes(k),
  );
  lastCompileReport = compiled.report || null;
  debugWarn("[mfe:fragment-sync] mount targets", {
    changedKeys: requestedKeysFromServer,
    targetKeys: requestedKeys,
    nonMountedRequestedKeys,
    report: lastCompileReport,
  });
  if (lastCompileReport?.graphChecksum) {
    window.__MFE_GRAPH = lastCompileReport.graphChecksum;
  }
  if (
    lastCompileReport?.ambiguous?.length ||
    lastCompileReport?.unresolved?.length
  ) {
    debugWarn("[mfe:bind] compile report", lastCompileReport);
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
      const patchResult = await requestRenderedFragmentsDatastar({
        pageId: currentPageId,
        lang: current,
        keys: requestedKeys,
        mountTargets,
        graphChecksum: lastCompileReport?.graphChecksum || "",
        graphNodeCount: Number(lastCompileReport?.graphNodeCount || 0),
        graphKeys: Array.isArray(lastCompileReport?.graphKeys)
          ? lastCompileReport.graphKeys
          : [],
      });
      if (isDevMode()) {
        const appliedKeys = Array.from(
          new Set(
            (Array.isArray(patchResult?.applied) ? patchResult.applied : [])
              .filter((a) => Number(a?.updated || 0) > 0)
              .map((a) => String(a?.key || ""))
              .filter(Boolean),
          ),
        );
        const skippedKeys = Array.from(
          new Set([
            ...nonMountedRequestedKeys,
            ...requestedKeys.filter((k) => !appliedKeys.includes(k)),
          ]),
        );
        debugWarn("[mfe:fragment-sync] coverage", {
          cycleId: patchResult?.cycleId,
          requestedKeys,
          appliedKeys,
          skippedKeys,
        });
      }
      if (
        Array.isArray(patchResult?.missingKeys) &&
        patchResult.missingKeys.length
      ) {
        const staleScopeKeys = Array.isArray(patchResult?.staleScopeKeys)
          ? patchResult.staleScopeKeys
          : [];
        const fallbackMissingKeys = patchResult.missingKeys.filter(
          (key) =>
            !staleScopeKeys.some((scopeKey) =>
              isScopeOrDescendantKey(key, scopeKey),
            ),
        );
        const editableFallbackUpdated = applyChangedHtmlEditableOnly({
          changedKeys: fallbackMissingKeys,
          htmlMap,
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
        const staleScopeKeys = Array.isArray(patchResult?.staleScopeKeys)
          ? patchResult.staleScopeKeys
          : [];
        const fallbackSectionKeys = patchResult.skippedSectionKeys.filter(
          (key) => !staleScopeKeys.includes(key),
        );
        const sectionEditableUpdated = applyEditableFallbackInSectionHosts({
          sectionKeys: fallbackSectionKeys,
          mountTargets,
          htmlMap,
        });
        debugWarn("[mfe:fragment-sync] skipped-section editable fallback", {
          skippedSectionKeys: fallbackSectionKeys,
          sectionEditableUpdated,
        });
      }
      debugWarn("[mfe:fragment-sync] datastar applied", patchResult);
    } catch (e) {
      debugWarn("[mfe:fragment-sync] datastar fetch failed, preview skipped", {
        message: e?.message || String(e),
        changedKeys: requestedKeys,
      });
    }
  }
  syncFieldsIndexToEditableAttrs({
    root: document,
    fields,
    sections,
    getMetaAttr,
    decodeMarkdownBase64,
  });
  annotateBoundImages();
  initEditors();

  if (updateActiveEditor && activeTarget) {
    const canonicalMarkdown = trimTrailingLineBreaks(
      typeof finalMarkdown === "string" ? finalMarkdown : "",
    );
    const canonicalHtml = normalizeHtmlImageSources(
      renderMarkdownToHtml(canonicalMarkdown),
    );
    activeTarget.dataset.markdown = canonicalMarkdown;
    if (activeTarget.classList?.contains("fe-editable")) {
      activeTarget.setAttribute(
        "data-markdown-b64",
        encodeMarkdownBase64(canonicalMarkdown),
      );
    }
    activeRawMarkdown = canonicalMarkdown;
    activeDisplayMarkdown = canonicalMarkdown;
    if (primaryEditor) {
      const selection = primaryEditor.state.selection;
      runWithoutDirtyTracking(() => {
        primaryEditor.commands.setContent(canonicalHtml, false);
      });
      primaryEditor.commands.setTextSelection(selection);
    }
  }
}

async function savePendingDrafts() {
  const entries = Array.from(primaryDraftsByFieldId.entries());
  if (!entries.length) return;
  const csrf = await fetchCsrfToken();
  const { current } = getLanguagesConfig();

  for (const [fieldId, markdown] of entries) {
    // INVARIANT: Validate markdown byte-for-byte if not explicitly edited
    const original = originalMarkdownByFieldId.get(fieldId);
    if (original !== undefined && original === markdown) {
      assertMarkdownInvariant(original, markdown);
    }

    const parsed = parseFieldId(fieldId);
    if (!parsed) continue;
    const resolvedScope = parsed.scope || "field";
    const outboundMarkdown =
      resolvedScope === "field"
        ? stripMfeMarkersForFieldScope(markdown || "")
        : markdown || "";
    const normalizedOutboundMarkdown = trimTrailingLineBreaks(outboundMarkdown);
    const formData = new FormData();
    formData.append("markdown", normalizedOutboundMarkdown);
    formData.append("mdName", parsed.name);
    formData.append("mdScope", resolvedScope);
    if (parsed.section) formData.append("mdSection", parsed.section);
    if (parsed.subsection) formData.append("mdSubsection", parsed.subsection);
    formData.append("pageId", parsed.pageId || "0");
    formData.append("fieldId", parsed.fieldId);
    if (current) formData.append("lang", current);
    if (csrf) formData.append(csrf.name, csrf.value);

    const res = await fetch(getSaveUrl(), {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.status) {
      throw new Error(data.message || "Save failed");
    }
    await handlePrimarySaveResponse(data, markdown, {
      updateActiveEditor: false,
    });
  }
}

function applyChangedHtmlEditableOnly({ changedKeys, htmlMap }) {
  const keys = Array.isArray(changedKeys) ? changedKeys.filter(Boolean) : [];
  if (!keys.length) return 0;
  const keySet = new Set(keys);
  let updated = 0;
  document.querySelectorAll(".fe-editable").forEach((el) => {
    if (el.closest('[data-mfe-window="true"]')) return;
    const key = scopedHtmlKeyFromMeta(
      getMetaAttr(el, "scope") || "field",
      getMetaAttr(el, "section") || "",
      getMetaAttr(el, "subsection") || "",
      getMetaAttr(el, "name") || "",
    );
    if (!keySet.has(key)) return;
    const html = htmlMap?.[key];
    if (typeof html !== "string") return;
    el.innerHTML = normalizeHtmlImageSources(html);
    updated += 1;
  });
  return updated;
}

function applyEditableFallbackInSectionHosts({
  sectionKeys,
  mountTargets,
  htmlMap,
}) {
  const keys = Array.isArray(sectionKeys) ? sectionKeys.filter(Boolean) : [];
  if (!keys.length) return 0;
  let updated = 0;
  keys.forEach((sectionKey) => {
    const targets = Array.isArray(mountTargets?.[sectionKey])
      ? mountTargets[sectionKey]
      : [];
    targets.forEach((target) => {
      const selector = target?.selector || "";
      if (!selector) return;
      const hosts = Array.from(document.querySelectorAll(selector));
      hosts.forEach((host) => {
        if (!host || !host.isConnected) return;
        const editables = [];
        if (host.classList?.contains("fe-editable")) editables.push(host);
        host
          .querySelectorAll?.(".fe-editable")
          ?.forEach((el) => editables.push(el));
        editables.forEach((el) => {
          const key = scopedHtmlKeyFromMeta(
            getMetaAttr(el, "scope") || "field",
            getMetaAttr(el, "section") || "",
            getMetaAttr(el, "subsection") || "",
            getMetaAttr(el, "name") || "",
          );
          const html = htmlMap?.[key];
          if (typeof html !== "string") return;
          el.innerHTML = normalizeHtmlImageSources(html);
          updated += 1;
        });
      });
    });
  });
  return updated;
}

function applyDatastarPatchElement({ selector, mode, elements, cycleId }) {
  if (!selector) return 0;
  const nodes = Array.from(document.querySelectorAll(selector));
  return applyDatastarPatchToNodes({ nodes, mode, elements, cycleId });
}

function applyDatastarPatchToNodes({ nodes, mode, elements, cycleId }) {
  if (!nodes.length) return 0;
  const patchMode = mode || "inner";
  let updated = 0;
  nodes.forEach((node) => {
    if (!node || !node.isConnected) return;
    if (patchMode === "outer" || patchMode === "replace") {
      node.outerHTML = elements || "";
      updated += 1;
      return;
    }
    node.innerHTML = elements || "";
    if (cycleId !== undefined && cycleId !== null) {
      node.setAttribute("data-mfe-last-patch", String(cycleId));
    }
    updated += 1;
  });
  return updated;
}

function parseFragmentHtmlDocument(html) {
  try {
    const parser = new DOMParser();
    return parser.parseFromString(String(html || ""), "text/html");
  } catch (_e) {
    return null;
  }
}

function collectNonEditableImages(root) {
  if (!root || !root.querySelectorAll) return [];
  return Array.from(root.querySelectorAll("img")).filter(
    (img) => !img.closest(".fe-editable"),
  );
}

function collectNonEditableMediaRoots(root) {
  if (!root || !root.querySelectorAll) return [];
  return Array.from(root.querySelectorAll("picture, img")).filter((node) => {
    if (node.closest(".fe-editable")) return false;
    if (node.tagName?.toLowerCase() === "img" && node.closest("picture")) {
      return false;
    }
    return true;
  });
}

function normalizeSrcsetForHost(host, srcset) {
  const value = String(srcset || "").trim();
  if (!value) return "";
  return value
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return "";
      const parts = trimmed.split(/\s+/);
      const url = parts.shift() || "";
      const descriptor = parts.join(" ");
      const resolvedUrl = resolveHostImageSrc(host, url);
      return descriptor ? `${resolvedUrl} ${descriptor}` : resolvedUrl;
    })
    .filter(Boolean)
    .join(", ");
}

function normalizeMediaNodeUrlsForHost(host, node) {
  if (!node || !node.querySelectorAll) return;
  const elements = [];
  if (node.matches?.("img, source")) elements.push(node);
  node.querySelectorAll?.("img, source")?.forEach((el) => elements.push(el));
  elements.forEach((el) => {
    const src = el.getAttribute("src") || "";
    if (src) {
      el.setAttribute("src", resolveHostImageSrc(host, src));
    }
    const srcset = el.getAttribute("srcset") || "";
    if (srcset) {
      el.setAttribute("srcset", normalizeSrcsetForHost(host, srcset));
    }
  });
}

function syncNonEditableImagesFromPatch(host, patchHtml) {
  if (!host || !host.querySelectorAll) return 0;
  const parsed = parseFragmentHtmlDocument(patchHtml);
  if (!parsed) return 0;

  const liveMediaRoots = collectNonEditableMediaRoots(host);
  const patchMediaRoots = collectNonEditableMediaRoots(parsed.body || parsed);
  if (liveMediaRoots.length && patchMediaRoots.length) {
    if (liveMediaRoots.length !== patchMediaRoots.length) return 0;
    let mediaUpdated = 0;
    liveMediaRoots.forEach((liveNode, idx) => {
      const patchNode = patchMediaRoots[idx];
      if (!patchNode || !liveNode?.isConnected) return;
      const patchClone = patchNode.cloneNode(true);
      normalizeMediaNodeUrlsForHost(host, patchClone);
      const nextHtml = patchClone.outerHTML || "";
      const currentHtml = liveNode.outerHTML || "";
      if (!nextHtml || nextHtml === currentHtml) return;
      liveNode.outerHTML = nextHtml;
      mediaUpdated += 1;
    });
    if (mediaUpdated > 0) return mediaUpdated;
  }

  const liveImages = collectNonEditableImages(host);
  const patchImages = collectNonEditableImages(parsed.body || parsed);
  if (!liveImages.length || !patchImages.length) return 0;
  if (liveImages.length !== patchImages.length) return 0;

  let updated = 0;
  liveImages.forEach((liveImg, idx) => {
    const patchImg = patchImages[idx];
    if (!patchImg) return;

    const srcRaw = patchImg.getAttribute("src") || "";
    if (srcRaw) {
      const nextSrc = resolveHostImageSrc(host, srcRaw);
      if ((liveImg.getAttribute("src") || "") !== nextSrc) {
        liveImg.setAttribute("src", nextSrc);
        updated += 1;
      }
    }

    const nextAlt = patchImg.getAttribute("alt") || "";
    if ((liveImg.getAttribute("alt") || "") !== nextAlt) {
      liveImg.setAttribute("alt", nextAlt);
    }

    const nextTitle = patchImg.getAttribute("title");
    if (nextTitle === null || nextTitle === "") {
      if (liveImg.hasAttribute("title")) liveImg.removeAttribute("title");
    } else if ((liveImg.getAttribute("title") || "") !== nextTitle) {
      liveImg.setAttribute("title", nextTitle);
    }
  });

  return updated;
}

function parseDatastarEventBlock(block) {
  const lines = String(block || "")
    .split(/\r?\n/)
    .filter(Boolean);
  let event = "message";
  const payload = {};
  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      return;
    }
    if (!line.startsWith("data:")) return;
    let raw = line.slice(5);
    if (raw.startsWith(" ")) raw = raw.slice(1);
    const sep = raw.indexOf(" ");
    if (sep <= 0) return;
    const key = raw.slice(0, sep);
    const value = raw.slice(sep + 1);
    if (key === "elements") {
      payload.elements = payload.elements
        ? `${payload.elements}\n${value}`
        : value;
      return;
    }
    payload[key] = value;
  });
  return { event, payload };
}

function keyDepth(key) {
  if (!key) return 99;
  if (key.startsWith("section:")) return 1;
  if (key.startsWith("field:")) return 2;
  if (key.startsWith("subsection:")) return key.split(":").length >= 4 ? 3 : 2;
  return 50;
}

function isDescendantKey(child, parent) {
  if (!child || !parent || child === parent) return false;
  if (parent.startsWith("section:")) {
    const sec = parent.slice("section:".length);
    return (
      child.startsWith(`field:${sec}:`) ||
      child.startsWith(`subsection:${sec}:`)
    );
  }
  if (parent.startsWith("subsection:")) {
    const parts = parent.split(":");
    if (parts.length === 3) return child.startsWith(`${parent}:`);
  }
  return false;
}

function hasDescendantScopedDrafts(sectionKey) {
  if (!sectionKey || !sectionKey.startsWith("section:")) return false;
  for (const scopedKey of draftMarkdownByScopedKey.keys()) {
    if (isDescendantKey(scopedKey, sectionKey)) {
      return true;
    }
  }
  return false;
}

function isScopeOrDescendantKey(key, scopeKey) {
  if (!key || !scopeKey) return false;
  return key === scopeKey || isDescendantKey(key, scopeKey);
}

function getParentScopeKeys(keys) {
  const list = Array.isArray(keys) ? keys : [];
  return Array.from(
    new Set(
      list
        .map((key) => String(key || "").trim())
        .filter(Boolean)
        .filter((key) => {
          const parts = key.split(":");
          const isSectionParent =
            key.startsWith("section:") && parts.length === 2;
          const isSubsectionParent =
            key.startsWith("subsection:") && parts.length === 3;
          return isSectionParent || isSubsectionParent;
        }),
    ),
  );
}

function computeStaleScopeKeys({ requestedKeys, missingKeys }) {
  const parentScopes = getParentScopeKeys(requestedKeys);
  if (!parentScopes.length) return [];

  const requested = Array.isArray(requestedKeys)
    ? requestedKeys.map((k) => String(k || "").trim()).filter(Boolean)
    : [];
  const missing = Array.isArray(missingKeys)
    ? missingKeys.map((k) => String(k || "").trim()).filter(Boolean)
    : [];

  const stale = [];
  parentScopes.forEach((scopeKey) => {
    const missingInScope = missing.some((k) =>
      isScopeOrDescendantKey(k, scopeKey),
    );
    if (!missingInScope) return;
    const requestedInScope = requested.some((k) =>
      isScopeOrDescendantKey(k, scopeKey),
    );
    if (!requestedInScope) return;
    stale.push(scopeKey);
  });

  return stale;
}

async function requestRenderedFragmentsDatastar({
  pageId,
  lang,
  keys,
  mountTargets,
  graphChecksum,
  graphNodeCount,
  graphKeys,
}) {
  const cycleId = ++patchCycleCounter;
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
          missing.forEach((k) => {
            if (typeof k === "string" && k.trim() !== "") {
              missingKeys.push(k.trim());
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
  const staleScopeKeys = computeStaleScopeKeys({
    requestedKeys: Array.isArray(keys) ? keys : [],
    missingKeys,
  });
  if (staleScopeKeys.length) {
    window.dispatchEvent(
      new CustomEvent("mfe:fragment-stale-scope", {
        detail: {
          cycleId,
          staleScopeKeys,
          missingKeys,
        },
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
    const candidateNodes = Array.from(
      document.querySelectorAll(patch.selector || ""),
    );
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
        (n) =>
          n &&
          (n.classList?.contains("fe-editable") ||
            n.querySelector?.(".fe-editable")),
      ) &&
      !patchHtml.includes("fe-editable");
    const isParentWithoutEditablePayload =
      (isSectionParentKey || isSubsectionParentKey) &&
      hasQueuedDescendantKey &&
      !patchHtml.includes("fe-editable");
    if (isParentWithoutEditablePayload) {
      const safeNodes = candidateNodes.filter(
        (n) =>
          n &&
          !n.classList?.contains("fe-editable") &&
          !n.querySelector?.(".fe-editable"),
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
          count + syncNonEditableImagesFromPatch(node, patchHtml),
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
        const hasInlineOpen = window.mfeInlineEditorActive === true;
        const hasFullscreenUnsaved = hasPendingUnsavedChanges();
        const hasDescendantDrafts = hasDescendantScopedDrafts(patch.key);
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
    missingKeys,
    skippedSectionKeys,
    staleScopeKeys,
    applied,
  };
  debugWarn("[mfe:fragment-api] result", result);
  return result;
}

function buildFieldId(pageId, scope, section, subsection, name) {
  const sub = subsection || "";
  if (sub) {
    return `${pageId}:${scope}:${section}:${sub}:${name}`;
  }
  return `${pageId}:${scope}:${section}:${name}`;
}
let breadcrumbsEl = null;
let breadcrumbClickHandler = null;
const statusManager = createStatusManager();

let saveCallback = null;
let keydownHandler = null;

function hasPendingUnsavedChanges() {
  if (primaryDirty) return true;
  if (primaryDraftsByFieldId.size > 0) return true;
  if (draftMarkdownByScopedKey.size > 0) return true;
  for (const dirty of dirtyTranslations.values()) {
    if (dirty) return true;
  }
  return false;
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
    primaryDraftsByFieldId.clear();
    draftMarkdownByScopedKey.clear();
    primaryDirty = false;
    dirtyTranslations.clear();
  }
  return ok;
}

async function keepPendingChangesBeforeSwitch() {
  if (!activeFieldId || !primaryEditor) return true;
  const currentScopedKey = getActiveScopedHtmlKey();
  const oldMarkdown = activeRawMarkdown || "";
  const markdown = getMarkdownFromEditor(primaryEditor);
  const hasActiveDraft = hasActivePrimaryDraft();
  const equivalent =
    normalizeComparableMarkdown(markdown) ===
    normalizeComparableMarkdown(oldMarkdown);

  if (!primaryDirty && !hasActiveDraft) {
    if (activeFieldId) {
      primaryDraftsByFieldId.delete(activeFieldId);
    }
    if (currentScopedKey) {
      draftMarkdownByScopedKey.delete(currentScopedKey);
    }
    syncDirtyStatusForActiveField();
    return true;
  }

  if (primaryDirty && equivalent) {
    if (activeFieldId) {
      primaryDraftsByFieldId.delete(activeFieldId);
    }
    if (currentScopedKey) {
      draftMarkdownByScopedKey.delete(currentScopedKey);
    }
    primaryDirty = false;
    syncDirtyStatusForActiveField();
    return true;
  }

  primaryDraftsByFieldId.set(activeFieldId, markdown);
  if (currentScopedKey) {
    draftMarkdownByScopedKey.set(currentScopedKey, markdown);
  }
  propagateDraftToAncestors(oldMarkdown, markdown);
  return true;
}

function createEditorInstance(element, fieldType, fieldName) {
  const restrictToSingleBlock = shouldWarnForExtraContent(fieldType, fieldName);
  const starterKitOptions = {
    codeBlock: false,
    link: false,
    underline: false,
    ...(restrictToSingleBlock ? { document: false } : {}),
  };
  const lowlight = createLowlight(common);
  const SingleBlockEnterToastExtension = createSingleBlockEnterToastExtension(
    (message, options) => statusManager.setError(message, options),
  );
  const ImageExtension = createMfeImageExtension(getImageBaseUrl);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure(starterKitOptions),
      ...(restrictToSingleBlock ? [SingleBlockDocumentExtension] : []),
      UnderlineMark,
      SuperscriptMark,
      SubscriptMark,
      Marker,
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
      }),
      ImageExtension,
      InlineHtmlLabelExtension,
      ...(restrictToSingleBlock ? [SingleBlockEnterToastExtension] : []),
      HeadingSingleLineExtension,
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

  editor.on("update", () => {
    if (suppressDirtyTracking > 0) return;
    highlightExtraContent(editor);
    if (shouldWarnForExtraContent(fieldType, fieldName)) {
      stripTrailingEmptyParagraph(editor);
    }
    if (editor === primaryEditor) {
      primaryDirty = true;
      if (activeFieldId) {
        primaryDraftsByFieldId.set(
          activeFieldId,
          getMarkdownFromEditor(editor),
        );
      }
      if (activeFieldId) {
        statusManager.markDirty(activeFieldId);
      }
    }
    if (editor === secondaryEditor && secondaryLang) {
      dirtyTranslations.set(secondaryLang, true);
      translationsCache = translationsCache || {};
      translationsCache[secondaryLang] = getMarkdownFromEditor(editor);
      if (activeFieldId) {
        translationsCacheByFieldId.set(activeFieldId, translationsCache);
      }
    }
  });

  editor.view.dom.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    if (!primaryEditor || !secondaryEditor) return;
    e.preventDefault();
    if (e.shiftKey) {
      primaryEditor.view.focus();
    } else {
      secondaryEditor.view.focus();
    }
  });

  return editor;
}

function saveAllEditors() {
  if (primaryEditor && hasBlockingExtraContent(primaryEditor)) {
    statusManager.setError(EXTRA_SCOPE_SAVE_ERROR);
    return;
  }
  if (secondaryEditor && hasBlockingExtraContent(secondaryEditor)) {
    statusManager.setError(EXTRA_SCOPE_SAVE_ERROR);
    return;
  }

  const tasks = [];
  if (primaryEditor && (primaryDirty || hasActivePrimaryDraft())) {
    tasks.push(
      new Promise((resolve, reject) => {
        const markdown = getMarkdownFromEditor(primaryEditor);
        if (saveCallback) {
          try {
            saveCallback(markdown, resolve, reject);
          } catch (err) {
            reject(err);
          }
        } else {
          resolve();
        }
      }),
    );
  } else if (primaryEditor && primaryDraftsByFieldId.size > 0) {
    tasks.push(savePendingDrafts());
  }

  if (secondaryEditor) {
    for (const [lang, dirty] of dirtyTranslations.entries()) {
      if (!dirty) continue;
      const pageId = activeTarget?.getAttribute("data-page") || "";
      const mdName = activeFieldName || "";
      const markdown = translationsCache?.[lang] ?? "";
      tasks.push(
        saveTranslation(
          pageId,
          mdName,
          lang,
          markdown,
          activeFieldScope,
          activeFieldSection,
        ),
      );
      dirtyTranslations.set(lang, false);
    }
  }

  if (tasks.length === 0) {
    statusManager.setNoChanges();
    syncDirtyStatusForActiveField();
    return;
  }

  Promise.all(tasks)
    .then(() => {
      primaryDirty = false;
      syncDirtyStatusForActiveField();
      statusManager.setSaved();
    })
    .catch(() => {
      statusManager.setError();
    });
}

function toggleSplit() {
  if (secondaryEditor) {
    closeSplit();
  } else {
    openSplit();
  }
}

function toggleMarkers() {
  document.body.classList.toggle("mfe-hide-markers");
}

function openSplit() {
  if (!editorShell || secondaryEditor) return;
  const { langs, current } = getLanguagesConfig();
  const normalizeLangValue = (value) =>
    String(value || "")
      .trim()
      .toLowerCase();
  const currentNormalized = normalizeLangValue(current);
  const seen = new Set();
  const otherLangs = langs.filter((lang) => {
    const name = normalizeLangValue(lang?.name);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    if (!currentNormalized) return true;
    return name !== currentNormalized;
  });

  if (otherLangs.length === 0) return;

  splitPane = document.createElement("div");
  splitPane.className = "mfe-editor-pane mfe-editor-pane--secondary";

  const header = document.createElement("div");
  header.className = "mfe-editor-pane-header";
  header.innerHTML = `
    <label class="mfe-editor-pane-label">Language</label>
    <select class="mfe-editor-pane-select"></select>
  `;

  const select = header.querySelector(".mfe-editor-pane-select");
  otherLangs.forEach((lang) => {
    const opt = document.createElement("option");
    opt.value = lang.name;
    const label =
      typeof lang.title === "string" && lang.title.trim() !== ""
        ? lang.title
        : String(lang.title || lang.name);
    opt.textContent = label;
    select.appendChild(opt);
  });
  if (otherLangs[0]) {
    select.value = otherLangs[0].name;
  }

  const body = document.createElement("div");
  body.className = "mfe-editor-pane-body";

  splitPane.appendChild(header);
  splitPane.appendChild(body);
  editorShell.appendChild(splitPane);

  secondaryEditor = createEditorInstance(
    body,
    activeFieldType,
    activeFieldName,
  );
  activeEditor = secondaryEditor;
  if (typeof refreshToolbarState === "function") {
    refreshToolbarState();
  }

  select.addEventListener("change", () => {
    setSecondaryLanguage(select.value);
  });

  if (translationsCache === null) {
    const pageId = activeTarget?.getAttribute("data-page") || "";
    const mdName = activeFieldName || "";
    fetchTranslations(
      mdName,
      pageId,
      activeFieldScope,
      activeFieldSection,
    ).then((data) => {
      translationsCache = data || {};
      if (activeFieldId) {
        translationsCacheByFieldId.set(activeFieldId, translationsCache);
      }
      setSecondaryLanguage(select.value);
    });
  } else {
    setSecondaryLanguage(select.value);
  }
}

function closeSplit() {
  if (secondaryEditor) {
    secondaryEditor.destroy();
    secondaryEditor = null;
  }
  if (splitPane) {
    splitPane.remove();
    splitPane = null;
  }
  secondaryLang = "";
  activeEditor = primaryEditor;
  if (typeof refreshToolbarState === "function") {
    refreshToolbarState();
  }
}

function setSecondaryLanguage(lang) {
  if (!secondaryEditor) return;
  secondaryLang = lang;
  const markdown = translationsCache?.[lang] ?? "";
  const html = renderMarkdownToHtml(markdown || "");
  runWithoutDirtyTracking(() => {
    secondaryEditor.commands.setContent(html, false);
  });
  if (shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    stripTrailingEmptyParagraph(secondaryEditor);
  }
  setOriginalBlockCount(
    secondaryEditor,
    activeFieldType,
    activeFieldName,
    originalBlockCounts,
  );
  highlightExtraContent(secondaryEditor);
  dirtyTranslations.set(lang, false);
}

// Custom extension to handle Escape key - DEPRECATED: WindowManager now handles global Escape
// const EscapeKeyExtension = Extension.create({
//   name: "escapeKeyExtension",
//
//   addKeyboardShortcuts() {
//     return {
//       Escape: () => {
//         closeEditor();
//         return true;
//       },
//     };
//   },
// });

/**
 * Initialize the editor for a specific field
 */
function initEditor(markdownContent, onSave, fieldType = "tag") {
  activeFieldType = fieldType;
  saveCallback = onSave;

  // Create container (starts at top, centered)
  const container = document.createElement("div");
  container.setAttribute("data-editor-container", "true");
  container.setAttribute("data-field-type", fieldType);
  container.className = "mfe-container";
  container.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
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
  const html = renderMarkdownToHtml(markdownContent || "");
  runWithoutDirtyTracking(() => {
    primaryEditor.commands.setContent(html, false);
  });
  if (shouldWarnForExtraContent(fieldType, activeFieldName)) {
    stripTrailingEmptyParagraph(primaryEditor);
  }
  setOriginalBlockCount(
    primaryEditor,
    fieldType,
    activeFieldName,
    originalBlockCounts,
  );
  highlightExtraContent(primaryEditor);
  primaryDirty = false;
  dirtyTranslations.clear();

  // Create toolbar (will be moved to menu bar after window opens)
  const toolbar = createToolbar(); // Returns the toolbar element, not appended yet

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
    onMount: (overlay, windowInstance) => {
      // Attach toolbar to the menu bar after window is created
      const menuBarInner = overlay.querySelector("[data-mfe-menubar-inner]");
      if (menuBarInner && toolbar) {
        menuBarInner.appendChild(toolbar);
      }
    },
  });
  overlayEl = win.dom;
  document.body.classList.add("mfe-view-fullscreen");

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Focus editor
  setTimeout(() => primaryEditor.view.focus(), 0);
}

function cleanupEditorOnly() {
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

  // Remove keyboard event listener
  if (keydownHandler) {
    document.removeEventListener("keydown", keydownHandler, true);
    keydownHandler = null;
  }

  document.body.classList.remove("mfe-view-fullscreen");
  statusManager.reset();

  saveCallback = null;
  activeTarget = null;
  activeFieldName = null;
  activeFieldType = null;
  activeFieldScope = "field";
  activeFieldSection = "";
  activeFieldSubsection = "";
  activeFieldId = null;
  activeRawMarkdown = null;
  activeDisplayMarkdown = null;
  translationsCache = null;
  secondaryLang = "";
  editorShell = null;
  editorContainer = null;
  overlayEl = null;
  splitPane = null;
  breadcrumbsEl = null;
  navigatingViaBreadcrumb = false;
}

/**
 * Open image picker and insert selected image
 */
function openImagePicker(initialData = null, imagePos = null) {
  const editor = activeEditor || primaryEditor;
  if (!editor) return;

  createImagePicker({
    initialData,
    onSelect: (imageData) => {
      // imageData is { filename, url, alt, _resolveWarning? }
      const editor = activeEditor || primaryEditor;
      if (!editor) return;

      // Show soft warning if image resolution failed (deferred to render time)
      if (imageData._resolveWarning) {
        statusManager.setError(imageData._resolveWarning);
      }

      let shouldReplaceSelectedImage = false;
      if (typeof imagePos === "number") {
        const imageNode = editor.state.doc.nodeAt(imagePos);
        if (imageNode && imageNode.type.name === "image") {
          const tr = editor.state.tr.setSelection(
            NodeSelection.create(editor.state.doc, imagePos),
          );
          editor.view.dispatch(tr);
          shouldReplaceSelectedImage = true;
        }
      }
      if (!shouldReplaceSelectedImage) {
        const { selection } = editor.state;
        shouldReplaceSelectedImage =
          selection.node && selection.node.type.name === "image";
      }

      if (shouldReplaceSelectedImage) {
        editor
          .chain()
          .focus()
          .updateAttributes("image", {
            src: imageData.url,
            alt: imageData.alt || "",
            originalFilename: imageData.filename,
          })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .setImage({
            src: imageData.url,
            alt: imageData.alt || "",
            originalFilename: imageData.filename,
          })
          .run();
      }

      // Mark as dirty
      if (editor === primaryEditor) {
        primaryDirty = true;
        const scopedKey = getActiveScopedHtmlKey();
        if (scopedKey) {
          draftMarkdownByScopedKey.set(
            scopedKey,
            getMarkdownFromEditor(editor),
          );
        }
        if (activeFieldId) {
          statusManager.markDirty(activeFieldId);
        }
      }
      if (editor === secondaryEditor && secondaryLang) {
        dirtyTranslations.set(secondaryLang, true);
      }
    },
    onClose: () => {
      // Refocus editor after picker closes
      setTimeout(() => editor.view.focus(), 0);
    },
  });
}

// Expose globally for toolbar button and extension
window.mfeOpenImagePicker = openImagePicker;

/**
 * Create the toolbar
 */
function createToolbar() {
  const toolbar = document.createElement("div");
  toolbar.id = "editor-toolbar"; // Add ID for easy selection
  toolbar.className = "mfe-toolbar";
  toolbar.setAttribute("data-editor-toolbar", "true");

  const buttons = createToolbarButtons({
    getEditor: () => activeEditor,
    onSave: saveAllEditors,
    onToggleSplit: toggleSplit,
    onToggleMarkers: toggleMarkers,
  });

  const configButtons =
    window.MarkdownFrontEditorConfig?.toolbarButtons ||
    "bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,|,code,codeblock,clear,|,split,markers";
  const { statusEl, refreshButtons } = renderToolbarButtons({
    toolbar,
    buttons,
    configButtons,
    getEditor: () => activeEditor,
  });
  refreshToolbarState = refreshButtons;
  saveStatusEl = statusEl;
  statusManager.registerStatusEl(statusEl);

  return toolbar;
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  if (keydownHandler) {
    document.removeEventListener("keydown", keydownHandler, true);
  }

  const handler = (e) => {
    if (!activeEditor) return;

    // Handle Ctrl/Cmd+S for save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      e.stopPropagation();
      saveAllEditors();
      return; // Important: return to avoid processing other cases
    }

    // Handle other Ctrl/Cmd shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "b":
          e.preventDefault();
          activeEditor.chain().focus().toggleBold().run();
          return;
        case "i":
          e.preventDefault();
          activeEditor.chain().focus().toggleItalic().run();
          return;
        case "k":
          e.preventDefault();
          // show link prompt
          const url = prompt("Enter URL:");
          if (url) {
            activeEditor.chain().focus().setLink({ href: url }).run();
          }
          return;
      }
    }
  };

  keydownHandler = handler;
  document.addEventListener("keydown", keydownHandler, true);
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
function clearExtraContentHighlights() {}

/**
 * Build a breadcrumb label for the window hierarchy
 */
function getActiveHierarchy() {
  const scope = activeFieldScope || "field";
  const name = activeFieldName || "";
  const type = activeFieldType || "";
  const isContainer = type === "container";
  const explicitSection =
    activeFieldSection || getMetaAttr(activeTarget, "section") || "";
  const explicitSubsection =
    activeFieldSubsection || getMetaAttr(activeTarget, "subsection") || "";
  const inferredSectionFromSub =
    scope === "subsection" ? findSectionNameForSubsection(name) : "";
  let subsection = explicitSubsection || (scope === "subsection" ? name : "");
  if (!subsection && scope === "field" && activeTarget?.closest) {
    const subWrap = activeTarget.closest(
      '[data-mfe-scope="subsection"], [data-md-scope="subsection"]',
    );
    subsection = getMetaAttr(subWrap, "name") || "";
  }
  const section =
    explicitSection ||
    inferredSectionFromSub ||
    (scope === "section" ? name : "") ||
    (subsection ? findSectionNameForSubsection(subsection) : "");

  return { scope, name, section, subsection, type, isContainer };
}

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
  }

  return { scope, name, section, subsection, type, isContainer };
}

function updateBreadcrumbAnchorFromPayload(payload) {
  if (navigatingViaBreadcrumb && breadcrumbAnchor) return;
  breadcrumbAnchor = deriveHierarchyFromPayload(payload);
}

function getBreadcrumbContentId(target, section, subsection, name) {
  if (target === "section") {
    return section ? `section:${section}` : "";
  }
  if (target === "subsection") {
    return section && subsection ? `subsection:${section}:${subsection}` : "";
  }
  if (target === "container" || target === "field") {
    if (section && subsection && name) {
      return `subsection:${section}:${subsection}:${name}`;
    }
    return name ? `field:${section ? `${section}:` : ""}${name}` : "";
  }
  return "";
}

function buildBreadcrumbParts() {
  const active = getActiveHierarchy();
  const source = breadcrumbAnchor || active;
  const { scope, name, section, subsection, type, isContainer } = source;

  const parts = [];
  if (section) {
    parts.push({
      label: `Section: ${section}`,
      target: "section",
      section,
      subsection,
      name,
      contentId: getBreadcrumbContentId("section", section, subsection, name),
    });
  }
  if (subsection) {
    parts.push({
      label: `Sub: ${subsection}`,
      target: "subsection",
      section,
      subsection,
      name,
      contentId: getBreadcrumbContentId(
        "subsection",
        section,
        subsection,
        name,
      ),
    });
  }
  if (scope === "field" && isContainer && name) {
    parts.push({
      label: `Container: ${name}`,
      target: "container",
      section,
      subsection,
      name,
      contentId: getBreadcrumbContentId("container", section, subsection, name),
    });
  }
  if (!isContainer && scope === "field" && name) {
    parts.push({
      label: `Field: ${name}`,
      target: "field",
      section,
      subsection,
      name,
      contentId: getBreadcrumbContentId("field", section, subsection, name),
    });
  }

  if (!parts.length) {
    if (scope === "section") return [{ label: "Section", target: "section" }];
    if (scope === "subsection") {
      return [{ label: "Subsection", target: "subsection" }];
    }
    if (type === "container") {
      return [{ label: "Container", target: "container" }];
    }
    return [{ label: "Field", target: "field" }];
  }

  return parts;
}

function buildBreadcrumbItems() {
  const parts = buildBreadcrumbParts();
  const currentTarget = getBreadcrumbsCurrentTarget();

  return parts.map((part) => {
    if (part.target === currentTarget) {
      return {
        label: part.label,
        target: part.target,
        contentId: part.contentId || "",
        section: part.section || "",
        subsection: part.subsection || "",
        name: part.name || "",
        state: "current",
      };
    }

    return {
      label: part.label,
      target: part.target,
      contentId: part.contentId || "",
      section: part.section || "",
      subsection: part.subsection || "",
      name: part.name || "",
      state: "link",
    };
  });
}

function getBreadcrumbsCurrentTarget() {
  if (activeFieldScope === "section") return "section";
  if (activeFieldScope === "subsection") return "subsection";
  if (activeFieldType === "container") return "container";
  return "field";
}

function renderBreadcrumbs() {
  if (!breadcrumbsEl) return;
  breadcrumbsEl.innerHTML = "";

  const parts = buildBreadcrumbParts();
  const currentTarget = getBreadcrumbsCurrentTarget();
  const { section: sectionName } = getActiveHierarchy();
  const sectionEntry = sectionName ? getSectionEntry(sectionName) : null;
  const sectionHasContent =
    Boolean(sectionEntry?.markdownB64) &&
    sectionEntry.markdownB64.trim() !== "";

  parts.forEach((part, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "mfe-breadcrumb-sep";
      sep.textContent = " > ";
      breadcrumbsEl.appendChild(sep);
    }

    const sectionDisabled = part.target === "section" && !sectionHasContent;
    if (part.target === currentTarget || sectionDisabled) {
      const current = document.createElement("span");
      current.className = sectionDisabled
        ? "mfe-breadcrumb-disabled"
        : "mfe-breadcrumb-current";
      current.textContent = part.label;
      breadcrumbsEl.appendChild(current);
      return;
    }

    const link = document.createElement("button");
    link.type = "button";
    link.className = "mfe-breadcrumb-link";
    link.textContent = part.label;
    link.setAttribute("data-breadcrumb-target", part.target);
    breadcrumbsEl.appendChild(link);
  });

  if (!breadcrumbsEl.dataset.listener) {
    breadcrumbsEl.addEventListener("click", handleBreadcrumbClick);
    breadcrumbsEl.dataset.listener = "1";
  }
}

/**
 * Save editor content
 */
function saveEditorContent(editor = activeEditor) {
  if (!editor) return;

  if (hasBlockingExtraContent(editor)) {
    statusManager.setError(EXTRA_SCOPE_SAVE_ERROR);
    return;
  }

  let markdown = getMarkdownFromEditor(editor);

  // Clear highlights when saving
  clearExtraContentHighlights();

  if (saveCallback && editor === primaryEditor) {
    saveCallback(markdown);
  }
}

function saveActiveEditor() {
  if (!activeEditor) return;
  if (hasBlockingExtraContent(activeEditor)) {
    statusManager.setError(EXTRA_SCOPE_SAVE_ERROR);
    return;
  }
  if (activeEditor === secondaryEditor && secondaryLang) {
    const pageId = activeTarget?.getAttribute("data-page") || "";
    const mdName = activeFieldName || "";
    const markdown = decodeHtmlEntitiesInFences(
      getMarkdownFromEditor(activeEditor),
    );
    if (translationsCache) {
      translationsCache[secondaryLang] = markdown;
    }
    saveTranslation(
      pageId,
      mdName,
      secondaryLang,
      markdown,
      activeFieldScope,
      activeFieldSection,
    );
    return;
  }
  saveEditorContent(activeEditor);
}

function closeEditor() {
  closeWindow("mfe-editor");
}

/**
 * Initialize editors for all editable elements
 */
function initEditors() {
  annotateBoundImages();
  document.querySelectorAll(".fe-editable").forEach((el) => {
    if (el.dataset.mfeDblclickBound === "1") return;
    el.addEventListener("dblclick", (e) => {
      // Prevent default browser selection
      e.preventDefault();
      e.stopPropagation();

      const parentEditable = el.parentElement?.closest(".fe-editable");
      const target = e.shiftKey && parentEditable ? parentEditable : el;

      openFullscreenEditorForElement(target);
    });
    el.dataset.mfeDblclickBound = "1";
  });
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

function decodeMaybeB64(value) {
  if (!value) return "";
  try {
    return decodeMarkdownBase64(value);
  } catch (_e) {
    return "";
  }
}

function getDraftMarkdownForScopedKey(scopeKey) {
  if (!scopeKey) return "";
  const draft = draftMarkdownByScopedKey.get(scopeKey);
  if (typeof draft === "string") return draft;

  if (scopeKey.startsWith("section:")) {
    const sectionName = scopeKey.slice(8);
    return decodeMaybeB64(getSectionEntry(sectionName)?.markdownB64 || "");
  }
  if (scopeKey.startsWith("subsection:")) {
    const parts = scopeKey.split(":");
    const section = parts[1] || "";
    const subsection = parts[2] || "";
    return decodeMaybeB64(
      getSubsectionEntry(section, subsection)?.markdownB64 || "",
    );
  }
  if (scopeKey.startsWith("field:")) {
    const parts = scopeKey.split(":");
    const section = parts.length >= 3 ? parts[1] : "";
    const name = parts.length >= 3 ? parts[2] : parts[1] || "";
    const fields = Array.isArray(window.MarkdownFrontEditorConfig?.fieldsIndex)
      ? window.MarkdownFrontEditorConfig.fieldsIndex
      : [];
    const match = fields.find(
      (f) => (f?.section || "") === section && (f?.name || "") === name,
    );
    return decodeMaybeB64(match?.markdownB64 || "");
  }
  return "";
}

function replaceUniqueBlockInText(documentText, search, replacement) {
  if (!documentText || !search) return null;
  const firstPos = documentText.indexOf(search);
  if (firstPos === -1) return null;
  const secondPos = documentText.indexOf(search, firstPos + search.length);
  if (secondPos !== -1) return null;
  return (
    documentText.slice(0, firstPos) +
    replacement +
    documentText.slice(firstPos + search.length)
  );
}

function propagateDraftToAncestors(oldMarkdown, newMarkdown) {
  if (!oldMarkdown || oldMarkdown === newMarkdown) return;
  const scope = activeFieldScope || "field";
  const section = activeFieldSection || "";
  const subsection = activeFieldSubsection || "";

  if (scope === "field" && section) {
    if (subsection) {
      const subKey = `subsection:${section}:${subsection}`;
      const subDoc = getDraftMarkdownForScopedKey(subKey);
      const updatedSub = replaceUniqueBlockInText(
        subDoc,
        oldMarkdown,
        newMarkdown,
      );
      if (updatedSub !== null) {
        draftMarkdownByScopedKey.set(subKey, updatedSub);
      }
    }
    const sectionKey = `section:${section}`;
    const sectionDoc = getDraftMarkdownForScopedKey(sectionKey);
    const updatedSection = replaceUniqueBlockInText(
      sectionDoc,
      oldMarkdown,
      newMarkdown,
    );
    if (updatedSection !== null) {
      draftMarkdownByScopedKey.set(sectionKey, updatedSection);
    }
    return;
  }

  if (scope === "subsection" && section) {
    const sectionKey = `section:${section}`;
    const sectionDoc = getDraftMarkdownForScopedKey(sectionKey);
    const updatedSection = replaceUniqueBlockInText(
      sectionDoc,
      oldMarkdown,
      newMarkdown,
    );
    if (updatedSection !== null) {
      draftMarkdownByScopedKey.set(sectionKey, updatedSection);
    }
  }
}

function annotateEditableImages(root = document) {
  root.querySelectorAll(".fe-editable").forEach((el) => {
    const scope = getMetaAttr(el, "scope") || "field";
    const section = getMetaAttr(el, "section") || "";
    const subsection = getMetaAttr(el, "subsection") || "";
    const name = getMetaAttr(el, "name") || "";
    const pageId = el.getAttribute("data-page") || "";

    el.querySelectorAll("img").forEach((img) => {
      img.setAttribute("data-mfe-image-bound", "1");
      img.setAttribute("data-mfe-image-scope", scope);
      img.setAttribute("data-mfe-image-section", section);
      img.setAttribute("data-mfe-image-subsection", subsection);
      img.setAttribute("data-mfe-image-name", name);
      img.setAttribute("data-mfe-image-page", pageId);
    });
  });
}

function annotateMfeHostImages(root = document) {
  root.querySelectorAll("[data-mfe]").forEach((host) => {
    const hostValue = host.getAttribute("data-mfe") || "";
    if (!hostValue) return;
    host.querySelectorAll("img").forEach((img) => {
      if (img.getAttribute("data-mfe-image-bound") === "1") return;
      img.setAttribute("data-mfe-image-bound", "1");
      img.setAttribute("data-mfe-image-host", hostValue);
    });
  });
}

function getImageBasename(src) {
  const value = (src || "").split("?")[0].split("#")[0];
  const parts = value.split("/");
  return parts[parts.length - 1] || "";
}

function getImageMatchKey(src) {
  const base = getImageBasename(src).toLowerCase();
  if (!base) return "";
  const extIdx = base.lastIndexOf(".");
  const stem = extIdx > 0 ? base.slice(0, extIdx) : base;
  return stem.replace(/\.\d+x\d+(?:-srcset)?$/i, "");
}

function extractMarkdownImageSrc(markdown) {
  const m = (markdown || "").match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  return m?.[1] || "";
}

function annotateInferredImages(root = document) {
  const fields = getFieldsIndex();
  if (!fields.length) return;

  const imageFields = fields
    .map((f) => {
      const markdown = f?.markdownB64
        ? decodeMarkdownBase64(f.markdownB64)
        : "";
      const src = extractMarkdownImageSrc(markdown);
      const key = getImageMatchKey(src);
      if (!src || !key) return null;
      return {
        scope: "field",
        section: f?.section || "",
        subsection: f?.subsection || "",
        name: f?.name || "",
        key,
      };
    })
    .filter(Boolean);

  if (!imageFields.length) return;

  root.querySelectorAll("img").forEach((img) => {
    if (img.getAttribute("data-mfe-image-bound") === "1") return;
    const key = getImageMatchKey(img.getAttribute("src") || "");
    if (!key) return;
    const matches = imageFields.filter((f) => f.key === key);
    if (matches.length !== 1) return;
    const match = matches[0];
    img.setAttribute("data-mfe-image-bound", "1");
    img.setAttribute("data-mfe-image-scope", match.scope);
    img.setAttribute("data-mfe-image-section", match.section);
    img.setAttribute("data-mfe-image-subsection", match.subsection);
    img.setAttribute("data-mfe-image-name", match.name);
    img.setAttribute("data-mfe-image-inferred", "1");
  });
}

function normalizeHtmlImageSources(html) {
  if (!html || typeof html !== "string") return html || "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (!src) return;
      const resolved = resolveHostImageSrc(document.body, src);
      img.setAttribute("src", resolved);
    });
    return doc.body.innerHTML || html;
  } catch (e) {
    return html;
  }
}

async function handleBreadcrumbClick(e) {
  // Find the breadcrumb link element
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

  const index = buildContentIndex();
  const hierarchy = getActiveHierarchy();
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
  const openFromBreadcrumb = (nextTarget) => {
    navigatingViaBreadcrumb = true;
    try {
      openFullscreenEditorForElement(nextTarget);
    } finally {
      navigatingViaBreadcrumb = false;
    }
  };

  const indexed = id ? index.byId.get(id) : null;
  if (indexed?.element) {
    const ok = await keepPendingChangesBeforeSwitch();
    if (!ok) return;
    openFromBreadcrumb(indexed.element);
    return;
  }

  if (indexed?.markdownB64) {
    const virtual = document.createElement("div");
    virtual.className = "fe-editable md-edit mfe-virtual";
    virtual.setAttribute(
      "data-page",
      activeTarget.getAttribute("data-page") || "0",
    );
    virtual.setAttribute("data-md-scope", indexed.scope || type);
    virtual.setAttribute("data-mfe-scope", indexed.scope || type);
    virtual.setAttribute("data-md-name", indexed.name || fieldName);
    virtual.setAttribute("data-mfe-name", indexed.name || fieldName);
    if (indexed.scope === "section") {
      virtual.setAttribute("data-field-type", "container");
    }
    if (indexed.section) {
      virtual.setAttribute("data-md-section", indexed.section);
      virtual.setAttribute("data-mfe-section", indexed.section);
    }
    if (indexed.subsection) {
      virtual.setAttribute("data-md-subsection", indexed.subsection);
      virtual.setAttribute("data-mfe-subsection", indexed.subsection);
    }
    virtual.setAttribute("data-markdown-b64", indexed.markdownB64);
    const ok = await keepPendingChangesBeforeSwitch();
    if (!ok) return;
    openFromBreadcrumb(virtual);
    return;
  }

  if (type === "section") {
    const entry = sectionName ? getSectionEntry(sectionName) : null;
    if (entry) {
      const virtual = document.createElement("div");
      virtual.className = "fe-editable md-edit mfe-virtual";
      virtual.setAttribute(
        "data-page",
        activeTarget.getAttribute("data-page") || "0",
      );
      virtual.setAttribute("data-md-scope", "section");
      virtual.setAttribute("data-mfe-scope", "section");
      virtual.setAttribute("data-md-name", sectionName);
      virtual.setAttribute("data-mfe-name", sectionName);
      virtual.setAttribute("data-field-type", "container");
      virtual.setAttribute("data-markdown-b64", entry.markdownB64 || "");
      const ok = await keepPendingChangesBeforeSwitch();
      if (!ok) return;
      openFromBreadcrumb(virtual);
      return;
    }
  }

  if (type === "subsection") {
    const entry =
      sectionName && subsectionName
        ? getSubsectionEntry(sectionName, subsectionName)
        : null;
    if (entry) {
      const virtual = document.createElement("div");
      virtual.className = "fe-editable md-edit mfe-virtual";
      virtual.setAttribute(
        "data-page",
        activeTarget.getAttribute("data-page") || "0",
      );
      virtual.setAttribute("data-md-scope", "subsection");
      virtual.setAttribute("data-mfe-scope", "subsection");
      virtual.setAttribute("data-md-name", subsectionName);
      virtual.setAttribute("data-mfe-name", subsectionName);
      virtual.setAttribute("data-field-type", "container");
      virtual.setAttribute("data-md-section", sectionName);
      virtual.setAttribute("data-mfe-section", sectionName);
      virtual.setAttribute("data-markdown-b64", entry.markdownB64 || "");
      const ok = await keepPendingChangesBeforeSwitch();
      if (!ok) return;
      openFromBreadcrumb(virtual);
      return;
    }
  }
}

function openFullscreenEditorFromPayload(payload) {
  if (!payload || !payload.element) return;
  const target = payload.element;
  if (activeEditor) {
    suppressNextCloseConfirm = true;
    closeEditor();
  }

  const {
    markdownContent,
    fieldName,
    fieldType,
    fieldScope,
    fieldSection,
    fieldSubsection,
    pageId,
  } = payload;

  const nextFieldId = buildFieldId(
    pageId,
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  const nextScopedKey = scopedHtmlKeyFromMeta(
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  const draftMarkdown = primaryDraftsByFieldId.get(nextFieldId) || null;
  const scopedDraftMarkdown = nextScopedKey
    ? draftMarkdownByScopedKey.get(nextScopedKey) || null
    : null;
  const effectiveMarkdown =
    scopedDraftMarkdown ?? draftMarkdown ?? markdownContent;
  activeRawMarkdown = effectiveMarkdown;
  activeDisplayMarkdown = effectiveMarkdown;

  activeTarget = target;
  activeFieldName = fieldName;
  activeFieldType = fieldType;
  activeFieldScope = fieldScope;
  activeFieldSection = fieldSection;
  activeFieldSubsection = fieldSubsection;
  activeFieldId = buildFieldId(
    pageId,
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  translationsCache = translationsCacheByFieldId.get(activeFieldId) || null;
  secondaryLang = "";

  const saveCallback = (markdown, resolve, reject) => {
    const finalMarkdown = trimTrailingLineBreaks(markdown);

    // INVARIANT: Validate markdown byte-for-byte if not explicitly edited
    const original = originalMarkdownByFieldId.get(activeFieldId);
    if (original !== undefined && original === finalMarkdown) {
      // No user edits - markdown must remain unchanged
      assertMarkdownInvariant(original, finalMarkdown);
    }

    const currentFieldName = activeFieldName || fieldName;
    const currentFieldScope = resolveScopeAtSaveBoundary(fieldScope || "field");
    const currentFieldSection = activeFieldSection || fieldSection || "";
    const currentFieldSubsection =
      activeFieldSubsection || fieldSubsection || "";
    const currentPageId =
      activeTarget?.getAttribute("data-page") || pageId || "0";
    const outboundMarkdown =
      currentFieldScope === "field"
        ? stripMfeMarkersForFieldScope(finalMarkdown)
        : finalMarkdown;
    const normalizedOutboundMarkdown = trimTrailingLineBreaks(outboundMarkdown);
    fetchCsrfToken().then((csrf) => {
      const { current } = getLanguagesConfig();
      const formData = new FormData();
      formData.append("markdown", normalizedOutboundMarkdown);
      formData.append("mdName", currentFieldName);
      formData.append("mdScope", currentFieldScope);
      if (currentFieldSection) {
        formData.append("mdSection", currentFieldSection);
      }
      if (currentFieldSubsection) {
        formData.append("mdSubsection", currentFieldSubsection);
      }
      formData.append("pageId", currentPageId);
      formData.append("fieldId", activeFieldId);
      if (current) {
        formData.append("lang", current);
      }

      if (csrf) {
        formData.append(csrf.name, csrf.value);
      }

      fetch(getSaveUrl(), {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (data.status) {
            Promise.resolve(
              handlePrimarySaveResponse(data, finalMarkdown, {
                updateActiveEditor: true,
              }),
            )
              .then(() => {
                if (resolve) resolve();
              })
              .catch((err) => {
                if (reject) reject(err);
              });
          } else {
            alert(`Save failed: ${data.message || "Unknown error"}`);
            if (reject) reject(new Error(data.message || "Save failed"));
          }
        })
        .catch((err) => {
          // save errors are handled by caller
          alert(`Save error: ${err.message}`);
          if (reject) reject(err);
        });
    });
  };

  if (document.body.classList.contains("mfe-view-inline")) {
    const overlay = document.querySelector(".mfe-hover-overlay");
    if (overlay) overlay.style.display = "none";
  }
  try {
    initEditor(activeDisplayMarkdown, saveCallback, fieldType);
  } catch (err) {
    console.error("[mfe] initEditor failed", err);
    return;
  }
  const loadedFromDraft = Boolean(scopedDraftMarkdown || draftMarkdown);
  primaryDirty = loadedFromDraft;
  syncDirtyStatusForActiveField();
  breadcrumbClickHandler = handleBreadcrumbClick;
}

function getPayloadFromElement(target) {
  if (!target) return null;
  const markdownB64 = target.getAttribute("data-markdown-b64");
  const markdownContent = markdownB64 ? decodeMarkdownBase64(markdownB64) : "";
  return {
    element: target,
    markdownContent,
    fieldName: getMetaAttr(target, "name") || "unknown",
    fieldType: target.getAttribute("data-field-type") || "tag",
    fieldScope: getMetaAttr(target, "scope") || "field",
    fieldSection: getMetaAttr(target, "section") || "",
    fieldSubsection: getMetaAttr(target, "subsection") || "",
    pageId: target.getAttribute("data-page") || "0",
  };
}

function replaceActiveEditor(payload) {
  if (!payload || !primaryEditor) return false;

  const {
    markdownContent,
    fieldName,
    fieldType,
    fieldScope,
    fieldSection,
    fieldSubsection,
    pageId,
  } = payload;

  const nextFieldId = buildFieldId(
    pageId,
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  const nextScopedKey = scopedHtmlKeyFromMeta(
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  const draftMarkdown = primaryDraftsByFieldId.get(nextFieldId) || null;
  const scopedDraftMarkdown = nextScopedKey
    ? draftMarkdownByScopedKey.get(nextScopedKey) || null
    : null;
  const effectiveMarkdown =
    scopedDraftMarkdown ?? draftMarkdown ?? markdownContent;
  activeEditor = primaryEditor;
  if (typeof refreshToolbarState === "function") {
    refreshToolbarState();
  }
  activeTarget = payload.element;
  activeFieldName = fieldName;
  activeFieldType = fieldType;
  activeFieldScope = fieldScope;
  activeFieldSection = fieldSection;
  activeFieldSubsection = fieldSubsection;
  activeFieldId = buildFieldId(
    pageId,
    fieldScope,
    fieldSection,
    fieldSubsection,
    fieldName,
  );
  activeRawMarkdown = effectiveMarkdown;
  activeDisplayMarkdown = effectiveMarkdown;
  translationsCache = translationsCacheByFieldId.get(activeFieldId) || null;
  secondaryLang = "";

  // Store original markdown for losslessness validation (only if no draft was loaded)
  if (!scopedDraftMarkdown && !draftMarkdown) {
    originalMarkdownByFieldId.set(activeFieldId, markdownContent);
  }

  const html = renderMarkdownToHtml(effectiveMarkdown || "");
  runWithoutDirtyTracking(() => {
    primaryEditor.commands.setContent(html, false);
  });
  if (shouldWarnForExtraContent(fieldType, fieldName)) {
    stripTrailingEmptyParagraph(primaryEditor);
  }
  setOriginalBlockCount(
    primaryEditor,
    fieldType,
    fieldName,
    originalBlockCounts,
  );
  highlightExtraContent(primaryEditor);
  const loadedFromDraft = Boolean(scopedDraftMarkdown || draftMarkdown);
  primaryDirty = loadedFromDraft;
  syncDirtyStatusForActiveField();

  if (secondaryEditor && secondaryLang) {
    setSecondaryLanguage(secondaryLang);
  }

  updateWindowById("mfe-editor", {
    breadcrumbItems: buildBreadcrumbItems(),
    breadcrumbClickHandler: handleBreadcrumbClick,
  });

  setTimeout(() => primaryEditor?.view?.focus(), 0);
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

  const fromConfig = window.MarkdownFrontEditorConfig?.imageBaseUrl;
  const base =
    typeof fromConfig === "string" && fromConfig.trim() !== ""
      ? fromConfig
      : "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${value.replace(/^\/+/, "")}`;
}

export function openFullscreenEditorForElement(target) {
  const payload = getPayloadFromElement(target);
  if (!payload) return;
  updateBreadcrumbAnchorFromPayload(payload);

  // Check if this target is already being edited inline
  // If so, user is just trying to refocus inline editor, not switch to fullscreen
  if (target.classList.contains("mfe-inline-active")) {
    return;
  }

  // Check if inline editor is open on a DIFFERENT element
  const inlineEditorElement = document.querySelector(".mfe-inline-editor");
  const inlineActive = window.mfeInlineEditorActive;
  if (inlineEditorElement && inlineActive) {
    // Close inline editor - its close handler will prompt about unsaved changes if needed
    const closeBtn = document
      .querySelector(".mfe-inline-toolbar")
      ?.querySelector(".mfe-inline-close");
    if (closeBtn) closeBtn.click();
    // Wait for close to complete, then verify it actually closed
    setTimeout(() => {
      const stillOpen =
        document.querySelector(".mfe-inline-editor") &&
        window.mfeInlineEditorActive;
      if (stillOpen) {
        return; // User canceled unsaved changes dialog, respect their choice
      }
      openFullscreenEditorForElement(target);
    }, 100);
    return;
  }

  const forceNewWindow =
    payload.fieldScope === "section" || payload.fieldScope === "subsection";
  if (forceNewWindow) {
    return openFullscreenEditorFromPayload(payload);
  }
  // If an editor is already open, swap content in place instead of opening a new window
  const hasOpenWindow =
    document.body.classList.contains("mfe-view-fullscreen") &&
    overlayEl &&
    overlayEl.isConnected &&
    primaryEditor;
  if (hasOpenWindow && replaceActiveEditor(payload)) {
    return;
  }
  return openFullscreenEditorFromPayload(payload);
}

function recompileMountGraph() {
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
  const cfg = window.MarkdownFrontEditorConfig || {};
  return Boolean(cfg.debug || cfg.debugShowSections || cfg.debugLabels);
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
   * Open editor
   * @param {string} markdownContent - Initial markdown
   * @param {function} onSave - Save callback
   * @param {string} fieldType - Field type: "tag" or "container" (default: "tag")
   */
  // Initialize new editor via initEditor (which uses WindowManager)
  edit(markdownContent, onSave, fieldType = "tag") {
    initEditor(markdownContent, onSave, fieldType);
  },

  close() {
    closeEditor();
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

export function initFullscreenEditor() {
  window.MarkdownFrontEditorRecompile = recompileMountGraph;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initEditors();
      recompileMountGraph();
    });
  } else {
    initEditors();
    recompileMountGraph();
  }
}
