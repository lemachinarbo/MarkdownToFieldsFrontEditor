import fs from "node:fs";
import path from "node:path";

import { resolveSessionIdentityEnvelope } from "../src/session-identity.js";
import { getDocumentState } from "../src/document-state.js";

const ROOT = path.resolve(process.cwd());
const FULLSCREEN_PATH = path.join(ROOT, "src/editor-fullscreen.js");

function extractFunctionSource(source, functionName) {
  const pattern = new RegExp(`function\\s+${functionName}\\s*\\(`);
  const match = pattern.exec(source);
  if (!match) {
    throw new Error(`Function not found: ${functionName}`);
  }

  const start = match.index;
  const openBrace = source.indexOf("{", start);
  if (openBrace < 0) {
    throw new Error(`Missing body: ${functionName}`);
  }

  let depth = 0;
  let index = openBrace;
  while (index < source.length) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
    index += 1;
  }

  throw new Error(`Unbalanced braces: ${functionName}`);
}

function normalizeScope(scopeValue) {
  const scope = String(scopeValue || "field")
    .trim()
    .toLowerCase();
  if (
    scope !== "field" &&
    scope !== "section" &&
    scope !== "subsection" &&
    scope !== "document"
  ) {
    return "field";
  }
  return scope;
}

function buildBreadcrumbValveState(payload, context) {
  const envelope = resolveSessionIdentityEnvelope(payload, context);
  const scope = normalizeScope(payload?.fieldScope);
  let section = String(payload?.fieldSection || "");
  let subsection = String(payload?.fieldSubsection || "");
  const name = String(payload?.fieldName || "");

  if (scope === "section") {
    section = name;
    subsection = "";
  }
  if (scope === "subsection") {
    subsection = name;
  }

  return {
    sessionStateId: envelope.sessionStateId,
    originFieldKey: envelope.originFieldKey,
    scope,
    section,
    subsection,
    name,
  };
}

describe("future breadcrumb valve", () => {
  test("breadcrumb state derives from session identity and scope", () => {
    const payload = {
      pageId: "1",
      fieldScope: "field",
      fieldSection: "hero",
      fieldSubsection: "",
      fieldName: "title",
      fieldId: "1:field:hero:title",
      originKey: "field:hero:title",
    };

    const context = {
      activeSessionStateId: "session:breadcrumb-stable",
      activePageId: "1",
      activeOriginFieldKey: "field:hero:title",
      preserveActiveOrigin: true,
    };

    const stateA = buildBreadcrumbValveState(payload, context);
    const stateB = buildBreadcrumbValveState(
      {
        ...payload,
        rawOriginKey: "1:section::hero",
        originKey: "1:section::hero",
      },
      context,
    );

    expect(stateA).toEqual(stateB);
    expect(stateA.sessionStateId).toBe("session:breadcrumb-stable");
    expect(stateA.originFieldKey).toBe("field:hero:title");
  });

  test("breadcrumb identity does not mutate without identity change", () => {
    const payload = {
      pageId: "5",
      fieldScope: "section",
      fieldSection: "",
      fieldSubsection: "",
      fieldName: "hero",
      fieldId: "5:section::hero",
      originKey: "field:hero:title",
    };

    const stableContext = {
      activeSessionStateId: "session:stable",
      activePageId: "5",
      activeOriginFieldKey: "field:hero:title",
      preserveActiveOrigin: true,
    };

    const breadcrumbOpen = buildBreadcrumbValveState(payload, {
      ...stableContext,
      navigationHint: "breadcrumb-open",
    });
    const breadcrumbReturn = buildBreadcrumbValveState(payload, {
      ...stableContext,
      navigationHint: "breadcrumb-return",
    });

    expect(breadcrumbOpen).toEqual(breadcrumbReturn);

    const store = new Map();
    const stateFromOpen = getDocumentState(
      store,
      {
        ...payload,
        sessionId: breadcrumbOpen.sessionStateId,
        originKey: breadcrumbOpen.originFieldKey,
        originFieldKey: breadcrumbOpen.originFieldKey,
      },
      "en",
      {
        reason: "future:breadcrumb:open",
        trigger: "scope-navigation",
      },
    );

    const stateFromReturn = getDocumentState(
      store,
      {
        ...payload,
        sessionId: breadcrumbReturn.sessionStateId,
        originKey: breadcrumbReturn.originFieldKey,
        originFieldKey: breadcrumbReturn.originFieldKey,
      },
      "en",
      {
        reason: "future:breadcrumb:return",
        trigger: "scope-navigation",
      },
    );

    expect(stateFromReturn).toBe(stateFromOpen);
    expect(stateFromReturn.id).toBe("session:stable|en");
  });

  test("navigation hints cannot alter breadcrumb anchor for same identity", () => {
    const source = fs.readFileSync(FULLSCREEN_PATH, "utf8");
    const updateAnchorSource = extractFunctionSource(
      source,
      "updateBreadcrumbAnchorFromPayload",
    );
    const deriveSource = extractFunctionSource(
      source,
      "deriveHierarchyFromPayload",
    );

    expect(source).not.toContain("navigatingViaBreadcrumb");
    expect(source).not.toContain("preserveBreadcrumbAnchor");
    expect(updateAnchorSource).toContain("const nextIdentityKey =");
    expect(updateAnchorSource).toContain(
      "if (breadcrumbAnchor && breadcrumbAnchorIdentityKey === nextIdentityKey)",
    );
    expect(updateAnchorSource).toContain(
      "breadcrumbAnchor = deriveHierarchyFromPayload(payload);",
    );
    expect(updateAnchorSource).toContain(
      "breadcrumbAnchorIdentityKey = nextIdentityKey;",
    );
    expect(deriveSource).not.toContain("navigatingViaBreadcrumb");
    expect(deriveSource).not.toContain("preserveBreadcrumbAnchor");
    expect(deriveSource).not.toContain("navigationHint");
    expect(deriveSource).toContain(
      'section = findSectionNameForSubsection(subsection) || "";',
    );
  });

  test("session scope lens drives breadcrumb source and click routing", () => {
    const source = fs.readFileSync(FULLSCREEN_PATH, "utf8");
    const updateAnchorSource = extractFunctionSource(
      source,
      "updateBreadcrumbAnchorFromPayload",
    );
    const buildPartsSource = extractFunctionSource(
      source,
      "buildBreadcrumbParts",
    );
    const clickSource = extractFunctionSource(source, "handleBreadcrumbClick");
    const openForElementSource = extractFunctionSource(
      source,
      "openFullscreenEditorForElement",
    );
    const openFromPayloadSource = extractFunctionSource(
      source,
      "openFullscreenEditorFromPayload",
    );
    const replaceSource = extractFunctionSource(source, "replaceActiveEditor");

    expect(source).toContain("function buildSessionScopeLens()");
    expect(source).toContain("function resolveLensNodeForBreadcrumb(");
    expect(source).toContain("function buildVirtualTargetFromLensNode(");
    expect(source).toContain("function applyActiveOriginKeyToVirtualTarget(");
    expect(source).toContain("function createBreadcrumbVirtualTarget(");
    expect(source).toContain(
      "function resolveMarkerBearingMarkdownForLensNode(",
    );
    expect(source).toContain("function resolveSessionScopeActiveContentId(");
    expect(source).toContain("function resolveSessionScopeAnchorContentId(");
    expect(source).toContain("data-mfe-markdown-kind");

    expect(updateAnchorSource).toContain(
      "syncSessionScopeLens(payload, nextIdentityKey);",
    );
    expect(buildPartsSource).toContain(
      "resolveHierarchyFromSessionScopeLens()",
    );
    const resolveHierarchySource = extractFunctionSource(
      source,
      "resolveHierarchyFromSessionScopeLens",
    );
    expect(resolveHierarchySource).toContain(
      "const activeNode = getLensNode(sessionScopeActiveContentId);",
    );
    expect(resolveHierarchySource).toContain(
      "const node = anchorNode || activeNode || fallbackNode;",
    );

    expect(source).toContain(
      "function resolveBreadcrumbNavigationTarget(params)",
    );
    expect(clickSource).toContain(
      "const resolvedTarget = resolveBreadcrumbNavigationTarget({",
    );
    expect(clickSource).toContain("if (resolvedTarget) {");
    expect(clickSource).toContain(
      "openFullscreenEditorForElement(resolvedTarget);",
    );
    const resolverSource = extractFunctionSource(
      source,
      "resolveBreadcrumbNavigationTarget",
    );
    expect(resolverSource).toContain(
      "const lensNode = resolveLensNodeForBreadcrumb({",
    );
    expect(resolverSource).toContain("const virtualScope =");
    expect(resolverSource).toContain("createBreadcrumbVirtualTarget({");
    const resolveActiveSource = extractFunctionSource(
      source,
      "resolveSessionScopeActiveContentId",
    );
    expect(resolveActiveSource).toContain(
      "const hierarchy = deriveHierarchyFromPayload(payload || {});",
    );
    const resolveAnchorSource = extractFunctionSource(
      source,
      "resolveSessionScopeAnchorContentId",
    );
    expect(resolveAnchorSource).toContain(
      "const hierarchy = deriveHierarchyFromPayload(payload || {});",
    );
    const breadcrumbVirtualSource = extractFunctionSource(
      source,
      "createBreadcrumbVirtualTarget",
    );
    expect(breadcrumbVirtualSource).toContain(
      "applyActiveOriginKeyToVirtualTarget(virtual);",
    );
    expect(source).toContain("const markdownB64 = encodeMarkdownBase64(");
    expect(source).toContain("resolveMarkerBearingMarkdownForLensNode(node)");

    expect(openForElementSource).not.toContain(
      "updateBreadcrumbAnchorFromPayload(payloadMetaWithOrigin);",
    );
    expect(source).toContain(
      "function applyActivePayloadState(payload, options)",
    );
    const applyActivePayloadStateSource = extractFunctionSource(
      source,
      "applyActivePayloadState",
    );
    expect(applyActivePayloadStateSource).toContain(
      "updateBreadcrumbAnchorFromPayload({",
    );
    expect(applyActivePayloadStateSource).toContain(
      "originFieldKey: activeOriginFieldKey || activeFieldId",
    );
    expect(openFromPayloadSource).toContain("applyActivePayloadState(");
    expect(openFromPayloadSource).toContain("payload,");
    expect(replaceSource).toContain("applyActivePayloadState(");
    expect(replaceSource).toContain("payload,");
    expect(source).toContain(
      "function resolveScopedMarkdownFromPayloadSource(",
    );
    const payloadSourceResolver = extractFunctionSource(
      source,
      "resolveScopedMarkdownFromPayloadSource",
    );
    const hydrateCanonicalPayloadSource = extractFunctionSource(
      source,
      "hydrateCanonicalPayload",
    );
    expect(payloadSourceResolver).toContain(
      'source: "buildCanonicalPayload:payloadRaw"',
    );
    expect(hydrateCanonicalPayloadSource).toContain(
      "resolveScopedMarkdownFromPayloadSource(",
    );
    expect(hydrateCanonicalPayloadSource).toContain(
      "resolveCanonicalMarkdownForPayload(",
    );
    expect(openForElementSource).toContain(
      "hydrateCanonicalPayload(payloadMetaWithOrigin)",
    );
  });
});
