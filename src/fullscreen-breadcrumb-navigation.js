import {
  buildContentIndex,
  getSectionEntry,
  getSubsectionEntry,
  getFieldsIndex,
} from "./content-index.js";
import { buildScopeKeyFromMeta } from "./scope-slice.js";
import {
  getActiveHierarchy as getActiveHierarchyHelper,
  buildSessionScopeLens as buildSessionScopeLensHelper,
  getLensNode as getLensNodeHelper,
  syncSessionScopeLensState,
  resolveHierarchyFromSessionScopeLens as resolveHierarchyFromSessionScopeLensHelper,
  resolveLensNodeForBreadcrumb as resolveLensNodeForBreadcrumbHelper,
  resolveCanonicalMarkdownForLensNode as resolveCanonicalMarkdownForLensNodeHelper,
  resolveMarkerBearingCanonicalMarkdownForLens as resolveMarkerBearingCanonicalMarkdownForLensHelper,
  resolveIndexedMarkdownForLensNode as resolveIndexedMarkdownForLensNodeHelper,
  resolveMarkerBearingMarkdownForLensNode as resolveMarkerBearingMarkdownForLensNodeHelper,
  buildVirtualTargetFromLensNode as buildVirtualTargetFromLensNodeHelper,
  applyActiveOriginKeyToVirtualTarget as applyActiveOriginKeyToVirtualTargetHelper,
  updateBreadcrumbAnchorFromPayload as updateBreadcrumbAnchorFromPayloadHelper,
  buildBreadcrumbParts as buildBreadcrumbPartsHelper,
  buildBreadcrumbItems as buildBreadcrumbItemsHelper,
  getBreadcrumbsCurrentTarget as getBreadcrumbsCurrentTargetHelper,
  getBreadcrumbContentId,
} from "./fullscreen-scope-lens.js";

/**
 * Reads the active fullscreen hierarchy from target metadata.
 * Does not mutate the scope lens or canonical markdown.
 */
export function getActiveHierarchy({
  activeFieldScope,
  activeFieldName,
  activeFieldType,
  activeFieldSection,
  activeFieldSubsection,
  activeTarget,
}) {
  return getActiveHierarchyHelper({
    activeFieldScope,
    activeFieldName,
    activeFieldType,
    activeFieldSection,
    activeFieldSubsection,
    activeTarget,
  });
}

/**
 * Builds a session scope lens from the current content indexes.
 * Does not read live editor state or canonical markdown.
 */
export function buildSessionScopeLens({
  sectionsIndex,
  fieldsIndex,
  contentIndexTargets,
}) {
  return buildSessionScopeLensHelper({
    sectionsIndex,
    fieldsIndex,
    contentIndexTargets,
  });
}

/**
 * Reads a node from the current session scope lens.
 * Does not synthesize missing nodes.
 */
export function getLensNode({ sessionScopeLens, contentId }) {
  return getLensNodeHelper(sessionScopeLens, contentId);
}

/**
 * Syncs session lens globals from the active payload identity.
 * Does not open editors or mutate canonical markdown.
 */
export function syncSessionScopeLens({
  sessionScopeLens,
  sessionScopeIdentityKey,
  sessionScopeAnchorContentId,
  sessionScopeActiveContentId,
  payload,
  identityKey,
  sectionsIndex,
  fieldsIndex,
  contentIndexTargets,
}) {
  return syncSessionScopeLensState({
    sessionScopeLens,
    sessionScopeIdentityKey,
    sessionScopeAnchorContentId,
    sessionScopeActiveContentId,
    payload,
    identityKey,
    sectionsIndex,
    fieldsIndex,
    contentIndexTargets,
  });
}

/**
 * Resolves breadcrumb hierarchy from the current session scope lens.
 * Does not fall back to DOM-derived target hierarchy.
 */
export function resolveHierarchyFromSessionScopeLens({
  sessionScopeLens,
  sessionScopeActiveContentId,
  sessionScopeAnchorContentId,
}) {
  return resolveHierarchyFromSessionScopeLensHelper({
    sessionScopeLens,
    sessionScopeActiveContentId,
    sessionScopeAnchorContentId,
  });
}

/**
 * Resolves a breadcrumb identity to a known lens node.
 * Does not rebuild the lens graph or open editors.
 */
export function resolveLensNodeForBreadcrumb({
  sessionScopeLens,
  ...params
}) {
  return resolveLensNodeForBreadcrumbHelper({
    sessionScopeLens,
    ...params,
  });
}

/**
 * Resolves marker-bearing canonical markdown for the active lens context.
 * Does not mutate canonical state or runtime projections.
 */
export function resolveMarkerBearingCanonicalMarkdownForLens(params) {
  return resolveMarkerBearingCanonicalMarkdownForLensHelper(params);
}

/**
 * Resolves canonical markdown for a specific lens node.
 * Does not change session or breadcrumb state.
 */
export function resolveCanonicalMarkdownForLensNode(node, params) {
  return resolveCanonicalMarkdownForLensNodeHelper(node, params);
}

/**
 * Resolves indexed markdown for a lens node.
 * Does not synthesize canonical fallback content.
 */
export function resolveIndexedMarkdownForLensNode(node, decodeMaybeB64) {
  return resolveIndexedMarkdownForLensNodeHelper(node, decodeMaybeB64);
}

/**
 * Resolves marker-bearing markdown for a lens node with canonical fallback.
 * Does not change session or breadcrumb state.
 */
export function resolveMarkerBearingMarkdownForLensNode(node, params) {
  return resolveMarkerBearingMarkdownForLensNodeHelper(node, params);
}

/**
 * Stamps the active origin identity on a virtual breadcrumb target.
 * Does not derive or mutate origin ownership.
 */
export function applyActiveOriginKeyToVirtualTarget(
  virtual,
  { activeOriginFieldKey, activeOriginKey },
) {
  return applyActiveOriginKeyToVirtualTargetHelper(virtual, {
    activeOriginFieldKey,
    activeOriginKey,
  });
}

/**
 * Builds a virtual target element for breadcrumb navigation.
 * Does not open the editor or mutate session state.
 */
export function buildVirtualTargetFromLensNode(node, params) {
  return buildVirtualTargetFromLensNodeHelper(node, params);
}

/**
 * Recomputes breadcrumb anchor state from payload and current lens state.
 * Does not open editors or mutate canonical markdown.
 */
export function updateBreadcrumbAnchorFromPayload(params) {
  return updateBreadcrumbAnchorFromPayloadHelper(params);
}

/**
 * Builds breadcrumb label parts from hierarchy and anchor state.
 * Does not resolve click behavior.
 */
export function buildBreadcrumbParts({ activeHierarchy, lensHierarchy, breadcrumbAnchor }) {
  return buildBreadcrumbPartsHelper({
    activeHierarchy,
    lensHierarchy,
    breadcrumbAnchor,
  });
}

/**
 * Builds breadcrumb items with current/link state metadata.
 * Does not resolve navigation targets.
 */
export function buildBreadcrumbItems({ parts, currentTarget }) {
  return buildBreadcrumbItemsHelper({
    parts,
    currentTarget,
  });
}

/**
 * Resolves the current breadcrumb target from lens state and fullscreen mode.
 * Does not build labels or mutate state.
 */
export function getBreadcrumbsCurrentTarget(params) {
  return getBreadcrumbsCurrentTargetHelper(params);
}

/**
 * Creates a virtual breadcrumb navigation target element.
 * Does not open editors or resolve navigation destinations.
 */
export function createBreadcrumbVirtualTarget({
  scope,
  name,
  pageId,
  fieldType,
  section,
  subsection,
  markdownB64,
  activeOriginFieldKey,
  activeOriginKey,
}) {
  const virtual = document.createElement("div");
  virtual.className = "fe-editable md-edit mfe-virtual";
  virtual.setAttribute("data-page", pageId || "0");
  virtual.setAttribute("data-mfe-scope", scope);
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
  applyActiveOriginKeyToVirtualTargetHelper(virtual, {
    activeOriginFieldKey,
    activeOriginKey,
  });
  return virtual;
}

/**
 * Resolves a breadcrumb click target to an existing or virtual editable host.
 * Does not open editors or mutate session state.
 */
export function resolveBreadcrumbNavigationTarget({
  type,
  id,
  sectionName,
  subsectionName,
  fieldName,
  index,
  activeTarget,
  resolveLensNodeForBreadcrumb,
  buildVirtualTargetFromLensNode,
  activeOriginFieldKey,
  activeOriginKey,
}) {
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
      activeOriginFieldKey,
      activeOriginKey,
    });
  }

  if (type === "section") {
    const entry = sectionName ? getSectionEntry(sectionName) : null;
    if (entry) {
      return createBreadcrumbVirtualTarget({
        scope: "section",
        name: sectionName,
        pageId: activeTarget.getAttribute("data-page") || "0",
        fieldType: "container",
        markdownB64: entry.markdownB64 || "",
        activeOriginFieldKey,
        activeOriginKey,
      });
    }
  }

  if (type === "subsection") {
    const entry =
      sectionName && subsectionName
        ? getSubsectionEntry(sectionName, subsectionName)
        : null;
    if (entry) {
      return createBreadcrumbVirtualTarget({
        scope: "subsection",
        name: subsectionName,
        pageId: activeTarget.getAttribute("data-page") || "0",
        fieldType: "container",
        section: sectionName,
        markdownB64: entry.markdownB64 || "",
        activeOriginFieldKey,
        activeOriginKey,
      });
    }
  }

  if (type === "field" || type === "container") {
    const fields = getFieldsIndex();
    const exact = fields.find((field) => {
      if ((field?.name || "") !== fieldName) return false;
      if (sectionName && (field?.section || "") !== sectionName) return false;
      if (subsectionName && (field?.subsection || "") !== subsectionName) {
        return false;
      }
      return true;
    });
    const fallback =
      exact ||
      fields.find(
        (field) =>
          (field?.name || "") === fieldName &&
          (field?.section || "") === sectionName,
      );

    if (fallback) {
      return createBreadcrumbVirtualTarget({
        scope: "field",
        name: fallback.name || fieldName,
        pageId: activeTarget.getAttribute("data-page") || "0",
        fieldType: fallback.fieldType || "tag",
        section: fallback.section || sectionName,
        subsection: fallback.subsection || subsectionName,
        markdownB64: fallback.markdownB64 || "",
        activeOriginFieldKey,
        activeOriginKey,
      });
    }
  }

  return null;
}

/**
 * Handles breadcrumb click navigation and resolves the next fullscreen target.
 * Does not own open/replace lifecycle authority beyond delegating to the existing opener.
 */
export async function handleBreadcrumbClick({
  event,
  activeTarget,
  activeFieldScope,
  activeFieldName,
  activeFieldSection,
  activeFieldSubsection,
  activeFieldType,
  editorViewMode,
  getActiveScopedHtmlKey,
  debugWarn,
  openDocumentFromBreadcrumbPath,
  resolveHierarchyFromSessionScopeLens,
  breadcrumbAnchor,
  getActiveHierarchy,
  resolveBreadcrumbNavigationTarget,
  openFullscreenEditorForElement,
}) {
  const target = event.target?.closest(".mfe-breadcrumb-link");

  if (!target) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();

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
