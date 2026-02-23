import { scopedHtmlKeyFromMeta } from "./sync-by-key.js";

function normalizeScopeKind(kind) {
  const value = String(kind || "field").trim();
  if (value === "document") return "document";
  if (value === "section") return "section";
  if (value === "subsection") return "subsection";
  return "field";
}

export function createScope(input = {}) {
  const kind = normalizeScopeKind(input.kind);
  const pageId = String(input.pageId || "0");
  const section = String(input.section || "");
  const subsection = String(input.subsection || "");
  const name = String(input.name || "");
  const fieldType = String(input.fieldType || "tag");
  const key =
    kind === "document"
      ? "document"
      : scopedHtmlKeyFromMeta(kind, section, subsection, name);

  return Object.freeze({
    kind,
    pageId,
    section,
    subsection,
    name,
    fieldType,
    key,
  });
}

export function createView(input = {}) {
  const kind = String(input.kind || "rich");
  return Object.freeze({ kind });
}

export function createHost(input = {}) {
  const kind = String(input.kind || "inline");
  return Object.freeze({ kind });
}

function computeCapabilities(scope, view) {
  const singleLine = scope.kind === "field" && scope.fieldType !== "container";
  return Object.freeze({
    canSave: true,
    canToggleDocumentScope: scope.kind !== "document",
    singleLineGuard: singleLine,
    supportsBoundaryView: view.kind === "rich" || view.kind === "outline",
  });
}

export function resolveSession({ scope, view, host }) {
  const frozenScope = createScope(scope || {});
  const frozenView = createView(view || {});
  const frozenHost = createHost(host || {});

  const metadata = Object.freeze({
    scopeKey: frozenScope.key,
    pageId: frozenScope.pageId,
    scopeKind: frozenScope.kind,
    hostKind: frozenHost.kind,
    viewKind: frozenView.kind,
  });

  const commands = Object.freeze({
    savePayload(markdown) {
      const text = typeof markdown === "string" ? markdown : "";
      return {
        markdown: text,
        pageId: frozenScope.pageId,
        mdScope: frozenScope.kind,
        mdSection: frozenScope.section,
        mdSubsection: frozenScope.subsection,
        mdName: frozenScope.kind === "document" ? "document" : frozenScope.name,
      };
    },
  });

  return Object.freeze({
    slice: frozenScope,
    metadata,
    capabilities: computeCapabilities(frozenScope, frozenView),
    commands,
  });
}
