import {
  buildContentIndex,
  findSectionNameForSubsection,
  getFieldsIndex,
  getSectionEntry,
  getSubsectionEntry,
} from "./content-index.js";
import { getMetaAttr } from "./editor-shared-helpers.js";
import {
  buildScopeKeyFromMeta,
  normalizeScopeKind,
  parseOriginScopeMeta,
} from "./scope-slice.js";
import { resolveMarkdownForScopeFromCanonical } from "./canonical-state.js";

/**
 * Read the active fullscreen hierarchy from the current target state.
 * Does not mutate the scope lens or canonical markdown.
 */
export function getActiveHierarchy({
  activeFieldScope = "field",
  activeFieldName = "",
  activeFieldType = "",
  activeFieldSection = "",
  activeFieldSubsection = "",
  activeTarget = null,
} = {}) {
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
    const subWrap = activeTarget.closest('[data-mfe-scope="subsection"]');
    subsection = getMetaAttr(subWrap, "name") || "";
  }
  const section =
    explicitSection ||
    inferredSectionFromSub ||
    (scope === "section" ? name : "") ||
    (subsection ? findSectionNameForSubsection(subsection) : "");

  return { scope, name, section, subsection, type, isContainer };
}

/**
 * Resolve the breadcrumb target type for a scope/type pair.
 * Does not inspect editor runtime state.
 */
export function resolveBreadcrumbTargetFromScope(scope, type) {
  const normalizedScope = normalizeScopeKind(scope || "field");
  if (normalizedScope === "document") return "document";
  if (normalizedScope === "section") return "section";
  if (normalizedScope === "subsection") return "subsection";
  return String(type || "") === "container" ? "container" : "field";
}

/**
 * Build the content id used by fullscreen breadcrumbs and lens nodes.
 * Does not read DOM state or canonical markdown.
 */
export function getBreadcrumbContentId(target, section, subsection, name) {
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

/**
 * Resolve a content id from scope metadata.
 * Does not look up or build lens state.
 */
export function resolveContentIdForScopeMeta({
  scope = "field",
  type = "tag",
  section = "",
  subsection = "",
  name = "",
} = {}) {
  const target = resolveBreadcrumbTargetFromScope(scope, type);
  if (target === "document") return "document:root";
  if (target === "section") {
    const sectionName = section || name;
    return getBreadcrumbContentId("section", sectionName, "", sectionName);
  }
  if (target === "subsection") {
    const sectionName = section || "";
    const subsectionName = subsection || name;
    return getBreadcrumbContentId(
      "subsection",
      sectionName,
      subsectionName,
      subsectionName,
    );
  }
  return getBreadcrumbContentId(target, section, subsection, name);
}

/**
 * Ensure a node exists inside the session scope lens maps.
 * Does not derive parent relationships beyond the provided parent id.
 */
export function ensureLensNode(lens, node, parentContentId) {
  if (!lens || !node?.contentId) return;
  if (!lens.nodesByContentId.has(node.contentId)) {
    lens.nodesByContentId.set(node.contentId, node);
  }
  if (parentContentId && !lens.parentByContentId.has(node.contentId)) {
    lens.parentByContentId.set(node.contentId, parentContentId);
  }
}

/**
 * Build the session scope lens from configured sections, fields, and targets.
 * Does not inspect active editor instances or draft state.
 */
export function buildSessionScopeLens({
  sectionsIndex = [],
  fieldsIndex = getFieldsIndex(),
  contentIndexTargets = [],
} = {}) {
  const lens = {
    nodesByContentId: new Map(),
    parentByContentId: new Map(),
  };

  ensureLensNode(
    lens,
    {
      contentId: "document:root",
      target: "document",
      scope: "document",
      section: "",
      subsection: "",
      name: "document",
      type: "container",
      isContainer: true,
    },
    "",
  );

  sectionsIndex.forEach((sectionEntry) => {
    const sectionName = String(sectionEntry?.name || "").trim();
    if (!sectionName) return;
    const sectionId = resolveContentIdForScopeMeta({
      scope: "section",
      section: sectionName,
      name: sectionName,
      type: "container",
    });
    ensureLensNode(
      lens,
      {
        contentId: sectionId,
        target: "section",
        scope: "section",
        section: sectionName,
        subsection: "",
        name: sectionName,
        type: "container",
        isContainer: true,
      },
      "document:root",
    );

    const subsectionEntries = Array.isArray(sectionEntry?.subsections)
      ? sectionEntry.subsections
      : [];
    subsectionEntries.forEach((subsectionEntry) => {
      const subsectionName = String(subsectionEntry?.name || "").trim();
      if (!subsectionName) return;
      const subsectionId = resolveContentIdForScopeMeta({
        scope: "subsection",
        section: sectionName,
        subsection: subsectionName,
        name: subsectionName,
        type: "container",
      });
      ensureLensNode(
        lens,
        {
          contentId: subsectionId,
          target: "subsection",
          scope: "subsection",
          section: sectionName,
          subsection: subsectionName,
          name: subsectionName,
          type: "container",
          isContainer: true,
        },
        sectionId,
      );
    });
  });

  fieldsIndex.forEach((fieldEntry) => {
    const name = String(fieldEntry?.name || "").trim();
    if (!name) return;
    const section = String(fieldEntry?.section || "").trim();
    const subsection = String(fieldEntry?.subsection || "").trim();
    const fieldType = String(fieldEntry?.fieldType || "tag").trim() || "tag";
    const target = fieldType === "container" ? "container" : "field";
    const contentId = resolveContentIdForScopeMeta({
      scope: "field",
      type: fieldType,
      section,
      subsection,
      name,
    });
    if (!contentId) return;
    const parentContentId = subsection
      ? resolveContentIdForScopeMeta({
          scope: "subsection",
          section,
          subsection,
          name: subsection,
        })
      : section
        ? resolveContentIdForScopeMeta({
            scope: "section",
            section,
            name: section,
          })
        : "document:root";
    ensureLensNode(
      lens,
      {
        contentId,
        target,
        scope: "field",
        section,
        subsection,
        name,
        type: fieldType,
        isContainer: target === "container",
      },
      parentContentId,
    );
  });

  contentIndexTargets.forEach((targetEntry) => {
    const scope = normalizeScopeKind(targetEntry?.scope || "field");
    const name = String(targetEntry?.name || "").trim();
    const section = String(targetEntry?.section || "").trim();
    const subsection = String(targetEntry?.subsection || "").trim();
    const type = String(targetEntry?.fieldType || "tag").trim() || "tag";
    const contentId = resolveContentIdForScopeMeta({
      scope,
      type,
      section,
      subsection,
      name,
    });
    if (!contentId || contentId === "document:root") return;
    const parentContentId =
      scope === "section"
        ? "document:root"
        : scope === "subsection"
          ? resolveContentIdForScopeMeta({
              scope: "section",
              section,
              name: section,
            })
          : subsection
            ? resolveContentIdForScopeMeta({
                scope: "subsection",
                section,
                subsection,
                name: subsection,
              })
            : section
              ? resolveContentIdForScopeMeta({
                  scope: "section",
                  section,
                  name: section,
                })
              : "document:root";
    ensureLensNode(
      lens,
      {
        contentId,
        target: resolveBreadcrumbTargetFromScope(scope, type),
        scope,
        section,
        subsection,
        name,
        type,
        isContainer: type === "container",
      },
      parentContentId,
    );
  });

  return lens;
}

/**
 * Read a lens node from the current session scope lens.
 * Does not infer missing nodes.
 */
export function getLensNode(lens, contentId) {
  if (!lens || !contentId) return null;
  return lens.nodesByContentId.get(contentId) || null;
}

/**
 * Resolve the anchor content id from an origin key.
 * Does not mutate breadcrumb or lens state.
 */
export function resolveAnchorContentIdFromOriginKey(originKey) {
  const originMeta = parseOriginScopeMeta(originKey);
  if (!originMeta) return "document:root";
  return (
    resolveContentIdForScopeMeta({
      scope: originMeta.scopeKind,
      section: originMeta.section || "",
      subsection: originMeta.subsection || "",
      name: originMeta.name || "",
      type: "tag",
    }) || "document:root"
  );
}

/**
 * Derive hierarchy metadata from an inbound fullscreen payload.
 * Does not read editor instances or runtime projection state.
 */
export function deriveHierarchyFromPayload(payload) {
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
 * Resolve the anchor content id for a payload within the session lens.
 * Does not rebuild or mutate the lens.
 */
export function resolveSessionScopeAnchorContentId(payload) {
  const originKey = String(
    payload?.originFieldKey || payload?.originKey || payload?.fieldId || "",
  );
  const originResolved = resolveAnchorContentIdFromOriginKey(originKey);
  if (originResolved && originResolved !== "document:root") {
    return originResolved;
  }
  const hierarchy = deriveHierarchyFromPayload(payload || {});
  return (
    resolveContentIdForScopeMeta({
      scope: hierarchy.scope || "field",
      type: hierarchy.type || "tag",
      section: hierarchy.section || "",
      subsection: hierarchy.subsection || "",
      name: hierarchy.name || "",
    }) || "document:root"
  );
}

/**
 * Resolve the active content id for a payload within the session lens.
 * Does not rebuild or mutate the lens.
 */
export function resolveSessionScopeActiveContentId(payload) {
  const hierarchy = deriveHierarchyFromPayload(payload || {});
  return (
    resolveContentIdForScopeMeta({
      scope: hierarchy.scope || "field",
      type: hierarchy.type || "tag",
      section: hierarchy.section || "",
      subsection: hierarchy.subsection || "",
      name: hierarchy.name || "",
    }) || "document:root"
  );
}

/**
 * Recompute the fullscreen lens state for a payload/identity pair.
 * Does not mutate module globals outside the returned state object.
 */
export function syncSessionScopeLensState({
  sessionScopeLens = null,
  sessionScopeIdentityKey = "",
  sessionScopeAnchorContentId = "document:root",
  sessionScopeActiveContentId = "document:root",
  payload,
  identityKey,
  sectionsIndex = [],
  fieldsIndex = getFieldsIndex(),
  contentIndexTargets = buildContentIndex()?.targets || [],
} = {}) {
  const nextIdentityKey = String(identityKey || "");
  let nextLens = sessionScopeLens;
  let nextAnchorContentId = sessionScopeAnchorContentId;
  let nextActiveContentId = sessionScopeActiveContentId;

  const shouldRebuild =
    !nextLens || sessionScopeIdentityKey !== nextIdentityKey;
  if (shouldRebuild) {
    nextLens = buildSessionScopeLens({
      sectionsIndex,
      fieldsIndex,
      contentIndexTargets,
    });
    nextAnchorContentId = resolveSessionScopeAnchorContentId(payload);
  }

  nextActiveContentId = resolveSessionScopeActiveContentId(payload);
  if (!getLensNode(nextLens, nextAnchorContentId)) {
    nextAnchorContentId = "document:root";
  }
  if (!getLensNode(nextLens, nextActiveContentId)) {
    nextActiveContentId = nextAnchorContentId || "document:root";
  }

  return {
    sessionScopeLens: nextLens,
    sessionScopeIdentityKey: nextIdentityKey,
    sessionScopeAnchorContentId: nextAnchorContentId,
    sessionScopeActiveContentId: nextActiveContentId,
  };
}

/**
 * Resolve hierarchy from the current session scope lens state.
 * Does not fall back to DOM-derived active target state.
 */
export function resolveHierarchyFromSessionScopeLens({
  sessionScopeLens = null,
  sessionScopeActiveContentId = "",
  sessionScopeAnchorContentId = "",
} = {}) {
  const activeNode = getLensNode(sessionScopeLens, sessionScopeActiveContentId);
  const anchorNode = getLensNode(sessionScopeLens, sessionScopeAnchorContentId);
  const fallbackNode = getLensNode(sessionScopeLens, "document:root");
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
export function resolveLensNodeForBreadcrumb({
  sessionScopeLens = null,
  type = "",
  contentId = "",
  section = "",
  subsection = "",
  name = "",
} = {}) {
  if (!sessionScopeLens) return null;
  const normalizedType = String(type || "")
    .trim()
    .toLowerCase();
  const candidates = [];
  if (contentId) candidates.push(String(contentId));

  if (normalizedType === "document") {
    candidates.push("document:root");
  }
  if (normalizedType === "section") {
    const sectionName = String(section || name || "").trim();
    candidates.push(
      resolveContentIdForScopeMeta({
        scope: "section",
        section: sectionName,
        name: sectionName,
        type: "container",
      }),
    );
  }
  if (normalizedType === "subsection") {
    const sectionName = String(section || "").trim();
    const subsectionName = String(subsection || name || "").trim();
    candidates.push(
      resolveContentIdForScopeMeta({
        scope: "subsection",
        section: sectionName,
        subsection: subsectionName,
        name: subsectionName,
        type: "container",
      }),
    );
  }
  if (normalizedType === "field" || normalizedType === "container") {
    const sectionName = String(section || "").trim();
    const subsectionName = String(subsection || "").trim();
    const fieldName = String(name || "").trim();
    candidates.push(
      resolveContentIdForScopeMeta({
        scope: "field",
        type: normalizedType === "container" ? "container" : "tag",
        section: sectionName,
        subsection: subsectionName,
        name: fieldName,
      }),
    );
    candidates.push(
      resolveContentIdForScopeMeta({
        scope: "field",
        type: "tag",
        section: sectionName,
        subsection: subsectionName,
        name: fieldName,
      }),
    );
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const node = getLensNode(sessionScopeLens, candidate);
    if (node) return node;
  }
  return null;
}

/**
 * Resolve the marker-bearing canonical markdown used by lens navigation.
 * Does not change canonical state or persist runtime projection data.
 */
export function resolveMarkerBearingCanonicalMarkdownForLens({
  getCanonicalMarkdownState,
  getLanguagesConfig,
  getStateForLanguage,
  activeDocumentState = null,
  getDocumentConfigMarkdownRaw,
  hasCanonicalMarkers,
} = {}) {
  const canonicalStateMarkdown = String(
    getCanonicalMarkdownState().markdown || "",
  );
  if (hasCanonicalMarkers(canonicalStateMarkdown)) {
    return canonicalStateMarkdown;
  }
  const currentLang = String(getLanguagesConfig().current || "");
  const stateForCurrentLang = getStateForLanguage(currentLang);
  const stateDraftForCurrentLang = String(
    stateForCurrentLang?.getDraft?.() || "",
  );
  if (hasCanonicalMarkers(stateDraftForCurrentLang)) {
    return stateDraftForCurrentLang;
  }
  const activeStateDraft = String(activeDocumentState?.getDraft?.() || "");
  if (hasCanonicalMarkers(activeStateDraft)) {
    return activeStateDraft;
  }
  const configMarkdown = getDocumentConfigMarkdownRaw();
  if (hasCanonicalMarkers(configMarkdown)) {
    return configMarkdown;
  }
  return canonicalStateMarkdown;
}

/**
 * Resolve canonical markdown for a specific lens node.
 * Does not build or mutate the node graph.
 */
export function resolveCanonicalMarkdownForLensNode(node, deps = {}) {
  const canonicalMarkdown = resolveMarkerBearingCanonicalMarkdownForLens(deps);
  if (!node || node.scope === "document") {
    return canonicalMarkdown;
  }
  return resolveMarkdownForScopeFromCanonical({
    markdown: canonicalMarkdown,
    scope: node.scope || "field",
    section: node.section || "",
    subsection: node.subsection || "",
    name: node.name || "",
  });
}

/**
 * Resolve indexed markdown for a lens node from the current content indexes.
 * Does not synthesize canonical fallback content.
 */
export function resolveIndexedMarkdownForLensNode(node, decodeMaybeB64) {
  if (!node) return "";
  if (node.scope === "section") {
    const sectionEntry = node.section ? getSectionEntry(node.section) : null;
    return decodeMaybeB64(sectionEntry?.markdownB64 || "");
  }
  if (node.scope === "subsection") {
    const subsectionEntry =
      node.section && node.subsection
        ? getSubsectionEntry(node.section, node.subsection)
        : null;
    return decodeMaybeB64(subsectionEntry?.markdownB64 || "");
  }
  if (node.scope === "field") {
    const fields = getFieldsIndex();
    const exact = fields.find((field) => {
      if ((field?.name || "") !== (node.name || "")) return false;
      if ((field?.section || "") !== (node.section || "")) return false;
      if ((field?.subsection || "") !== (node.subsection || "")) {
        return false;
      }
      return true;
    });
    const fallback =
      exact ||
      fields.find((field) => {
        if ((field?.name || "") !== (node.name || "")) return false;
        if ((field?.section || "") !== (node.section || "")) return false;
        return true;
      });
    return decodeMaybeB64(fallback?.markdownB64 || "");
  }
  return "";
}

/**
 * Resolve marker-bearing markdown for a lens node with canonical fallback.
 * Does not log or recover errors beyond the provided warning callback.
 */
export function resolveMarkerBearingMarkdownForLensNode(node, deps = {}) {
  const indexedMarkdown = resolveIndexedMarkdownForLensNode(
    node,
    deps.decodeMaybeB64,
  );
  if (deps.hasCanonicalMarkers(indexedMarkdown)) {
    return indexedMarkdown;
  }
  try {
    const canonicalSlice = resolveCanonicalMarkdownForLensNode(node, deps);
    if (deps.hasCanonicalMarkers(canonicalSlice)) {
      return canonicalSlice;
    }
  } catch (error) {
    deps.debugWarn?.("[mfe:lens] canonical-slice-resolve failed", {
      scope: String(node?.scope || ""),
      section: String(node?.section || ""),
      subsection: String(node?.subsection || ""),
      name: String(node?.name || ""),
      error: String(error?.message || error || ""),
    });
  }
  return resolveMarkerBearingCanonicalMarkdownForLens(deps);
}

/**
 * Stamp the active origin key on a virtual breadcrumb target.
 * Does not derive or mutate the origin key.
 */
export function applyActiveOriginKeyToVirtualTarget(
  virtual,
  { activeOriginFieldKey = "", activeOriginKey = "" } = {},
) {
  if (!virtual) return;
  const originKey = String(activeOriginFieldKey || activeOriginKey || "");
  if (!originKey) return;
  virtual.setAttribute("data-mfe-origin-key", originKey);
}

/**
 * Build a virtual target element for breadcrumb navigation.
 * Does not open the editor or mutate session state.
 */
export function buildVirtualTargetFromLensNode(node, deps = {}) {
  if (!node || !deps.activeTarget) return null;
  const pageId = deps.activeTarget.getAttribute("data-page") || "0";
  const virtual = document.createElement("div");
  virtual.className = "fe-editable md-edit mfe-virtual";
  virtual.setAttribute("data-page", pageId);
  virtual.setAttribute("data-mfe-scope", node.scope || "field");
  virtual.setAttribute("data-mfe-name", node.name || "document");
  virtual.setAttribute("data-field-type", node.type || "tag");
  virtual.setAttribute(
    "data-mfe-markdown-kind",
    node.scope === "document" ? "canonical" : "scoped",
  );
  if (node.section) {
    virtual.setAttribute("data-mfe-section", node.section);
  }
  if (node.subsection) {
    virtual.setAttribute("data-mfe-subsection", node.subsection);
  }
  const scopeKey = buildScopeKeyFromMeta({
    scopeKind: node.scope || "field",
    section: node.section || "",
    subsection: node.subsection || "",
    name: node.name || "document",
  });
  if (scopeKey) {
    virtual.setAttribute("data-mfe-key", scopeKey);
  }
  applyActiveOriginKeyToVirtualTarget(virtual, {
    activeOriginFieldKey: deps.activeOriginFieldKey,
    activeOriginKey: deps.activeOriginKey,
  });
  virtual.setAttribute(
    "data-markdown-b64",
    deps.encodeMarkdownBase64(resolveMarkerBearingMarkdownForLensNode(node, deps)),
  );
  return virtual;
}

/**
 * Recompute breadcrumb anchor state from a payload and lens state.
 * Does not open editors or mutate globals outside the returned object.
 */
export function updateBreadcrumbAnchorFromPayload({
  payload,
  breadcrumbAnchorIdentityKey = "",
  sessionScopeLens = null,
  sessionScopeIdentityKey = "",
  sessionScopeAnchorContentId = "document:root",
  sessionScopeActiveContentId = "document:root",
  sectionsIndex = [],
  fieldsIndex = getFieldsIndex(),
  contentIndexTargets = buildContentIndex()?.targets || [],
} = {}) {
  const pageId = String(payload?.pageId || "0");
  const originKey = String(
    payload?.originFieldKey || payload?.originKey || payload?.fieldId || "",
  );
  const nextIdentityKey = `${pageId}|${originKey}`;
  const lensState = syncSessionScopeLensState({
    sessionScopeLens,
    sessionScopeIdentityKey,
    sessionScopeAnchorContentId,
    sessionScopeActiveContentId,
    payload,
    identityKey: nextIdentityKey,
    sectionsIndex,
    fieldsIndex,
    contentIndexTargets,
  });
  if (breadcrumbAnchorIdentityKey === nextIdentityKey) {
    return {
      ...lensState,
      breadcrumbAnchor: null,
      breadcrumbAnchorIdentityKey,
    };
  }
  return {
    ...lensState,
    breadcrumbAnchor: deriveHierarchyFromPayload(payload),
    breadcrumbAnchorIdentityKey: nextIdentityKey,
  };
}

/**
 * Resolve the current breadcrumb target from lens state and fullscreen mode.
 * Does not build breadcrumb item labels.
 */
export function getBreadcrumbsCurrentTarget({
  sessionScopeLens = null,
  sessionScopeActiveContentId = "",
  isDocumentScopeActive = () => false,
  activeFieldScope = "field",
  activeFieldType = "tag",
} = {}) {
  const activeLensNode = getLensNode(sessionScopeLens, sessionScopeActiveContentId);
  if (activeLensNode) {
    if (activeLensNode.target === "document") return "document";
    if (activeLensNode.target === "section") return "section";
    if (activeLensNode.target === "subsection") return "subsection";
    if (activeLensNode.target === "container") return "container";
    return "field";
  }
  if (isDocumentScopeActive()) return "document";
  if (activeFieldScope === "section") return "section";
  if (activeFieldScope === "subsection") return "subsection";
  if (activeFieldType === "container") return "container";
  return "field";
}

/**
 * Build breadcrumb parts from active hierarchy and lens state.
 * Does not convert parts into clickable navigation targets.
 */
export function buildBreadcrumbParts({
  activeHierarchy,
  lensHierarchy = null,
  breadcrumbAnchor = null,
} = {}) {
  const active = activeHierarchy || {
    scope: "field",
    name: "",
    section: "",
    subsection: "",
    type: "tag",
    isContainer: false,
  };
  const source = lensHierarchy || breadcrumbAnchor || active;
  const { scope, name, section, subsection, type, isContainer } = source;

  const parts = [
    {
      label: "Document",
      target: "document",
      section,
      subsection,
      name,
      contentId: "document:root",
    },
  ];
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

/**
 * Build breadcrumb items with current/link state.
 * Does not resolve click behavior.
 */
export function buildBreadcrumbItems({ parts, currentTarget }) {
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
