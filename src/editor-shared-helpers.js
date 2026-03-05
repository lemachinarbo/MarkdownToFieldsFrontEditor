import {
  shouldWarnForExtraContent,
  countNonEmptyBlocks,
  serializeMarkdownDoc,
} from "./editor-core.js";
import { getHostConfig, isHostFlagEnabled } from "./host-env.js";

export function getMetaAttr(el, name) {
  if (!el) return "";
  return el.getAttribute(`data-mfe-${name}`) || "";
}

function buildFieldHostIdentity({ section, subsection, name }) {
  const normalizedSection = String(section || "").trim();
  const normalizedSubsection = String(subsection || "").trim();
  const normalizedName = String(name || "").trim();
  const path = [normalizedSection, normalizedSubsection, normalizedName]
    .filter(Boolean)
    .join("/");
  const key = normalizedSubsection
    ? `subsection:${normalizedSection}:${normalizedSubsection}:${normalizedName}`
    : normalizedSection
      ? `field:${normalizedSection}:${normalizedName}`
      : `field:${normalizedName}`;
  return {
    dataMfe: `field:${path}`,
    key,
  };
}

function shouldWarnOnIdentityRewrite() {
  return isHostFlagEnabled("debug");
}

export function normalizeFieldHostIdentity(root = document) {
  if (!root?.querySelectorAll) return 0;
  let changedHosts = 0;
  root.querySelectorAll(".fe-editable").forEach((el) => {
    const scope = getMetaAttr(el, "scope") || "field";
    if (scope !== "field") return;

    const name = getMetaAttr(el, "name") || "";
    if (!name) return;
    const section = getMetaAttr(el, "section") || "";
    const subsection = getMetaAttr(el, "subsection") || "";

    const previous = (el.getAttribute("data-mfe") || "").trim();
    const existingOrigin = (el.getAttribute("data-mfe-origin") || "").trim();
    const identity = buildFieldHostIdentity({ section, subsection, name });
    const origin = existingOrigin || (previous ? "manual" : "auto");

    if (
      origin === "manual" &&
      previous &&
      previous !== identity.dataMfe &&
      shouldWarnOnIdentityRewrite()
    ) {
      console.warn("[mfe:host-identity] manual data-mfe rewritten", {
        previous,
        normalized: identity.dataMfe,
        key: identity.key,
        section,
        subsection,
        name,
        page: el.getAttribute("data-page") || "",
      });
    }

    let changed = false;
    if (el.getAttribute("data-mfe") !== identity.dataMfe) {
      el.setAttribute("data-mfe", identity.dataMfe);
      changed = true;
    }
    if (el.getAttribute("data-mfe-key") !== identity.key) {
      el.setAttribute("data-mfe-key", identity.key);
      changed = true;
    }
    if (el.getAttribute("data-mfe-origin") !== origin) {
      el.setAttribute("data-mfe-origin", origin);
      changed = true;
    }

    if (changed) {
      changedHosts += 1;
    }
  });
  return changedHosts;
}

export function getImageBaseUrl() {
  const fromConfig = getHostConfig().imageBaseUrl;
  if (typeof fromConfig !== "string" || fromConfig.trim() === "") {
    throw new Error(
      "MarkdownFrontEditorConfig.imageBaseUrl is required for image operations.",
    );
  }
  const base = fromConfig;
  return base.endsWith("/") ? base : `${base}/`;
}

export function setOriginalBlockCount(
  editor,
  fieldType,
  fieldName,
  originalBlockCounts,
) {
  const count = shouldWarnForExtraContent(fieldType, fieldName)
    ? 1
    : countNonEmptyBlocks(editor.state.doc);
  originalBlockCounts.set(editor, count);
}

export function getOriginalBlockCount(editor, originalBlockCounts) {
  return originalBlockCounts.get(editor) || 0;
}

export function applyFieldAttributes(editor, fieldType, fieldName) {
  const dom = editor.view.dom;
  dom.setAttribute("data-field-type", fieldType);
  dom.setAttribute("data-field-name", fieldName || "");
  if (shouldWarnForExtraContent(fieldType, fieldName)) {
    dom.setAttribute("data-extra-warning", "true");
    dom.setAttribute("data-extra-warning-active", "false");
  } else {
    dom.removeAttribute("data-extra-warning");
    dom.removeAttribute("data-extra-warning-active");
  }
}

export function stripTrailingEmptyParagraph(editor) {
  if (!editor) return;
  const { state, view } = editor;
  const { doc } = state;
  if (doc.childCount <= 1) return;

  const last = doc.child(doc.childCount - 1);
  if (last.type.name !== "paragraph") return;
  if (last.textContent.trim() !== "") return;

  const from = doc.content.size - last.nodeSize;
  const to = doc.content.size;
  const tr = state.tr.delete(from, to);
  view.dispatch(tr);
}

export function getMarkdownFromEditor(editor) {
  if (!editor) return "";
  return serializeMarkdownDoc(editor.state.doc);
}

const MFE_MARKER_LINE_RE =
  /^[\t ]*<!--\s*[a-zA-Z0-9_:.\/-]+\s*-->[\t ]*(?:\r?\n|$)/gm;

export function stripMfeMarkersForFieldScope(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  return text.replace(MFE_MARKER_LINE_RE, "");
}

export function stripMfeMarkers(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  return text.replace(MFE_MARKER_LINE_RE, "");
}
