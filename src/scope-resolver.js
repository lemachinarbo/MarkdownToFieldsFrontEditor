import { getSectionEntry, getSubsectionEntry } from "./content-index.js";

export function resolveDblclickAction({
  event,
  hit,
  overlayEngine,
  findTargetFromPoint,
  findSectionFromText,
  decodeMarkdownBase64,
  createVirtualTarget,
  pageId,
}) {
  if (!hit) {
    const fallback =
      overlayEngine.findMarkerTargetFromPoint(event.clientX, event.clientY) ||
      overlayEngine.findFieldSubsectionTargetFromPoint(
        event.clientX,
        event.clientY,
      ) ||
      findTargetFromPoint(event.clientX, event.clientY) ||
      findSectionFromText(event.target?.textContent || "");

    let fallbackB64 = fallback?.b64 || fallback?.markdownB64 || "";
    if (!fallbackB64 && fallback?.scope === "section") {
      fallbackB64 = getSectionEntry(fallback.name)?.markdownB64 || "";
    }
    if (!fallbackB64 && fallback?.scope === "subsection") {
      fallbackB64 =
        getSubsectionEntry(fallback.section || "", fallback.name)?.markdownB64 ||
        "";
    }

    if (!fallbackB64) {
      return { action: "none", reason: "no-hit-no-fallback" };
    }

    const virtual = createVirtualTarget({
      pageId,
      scope: fallback.scope,
      name: fallback.name,
      section: fallback.section || "",
      markdown: decodeMarkdownBase64(fallbackB64),
    });

    return { action: "fullscreen", target: virtual, reason: "fallback" };
  }

  const parentEditable = hit.parentElement?.closest(".fe-editable");
  const target = event.shiftKey && parentEditable ? parentEditable : hit;

  if (!event.ctrlKey && !event.metaKey) {
    const targetScope = target.getAttribute("data-md-scope") || "field";
    const targetType = target.getAttribute("data-field-type") || "tag";

    let fullscreenTarget = target;
    if (targetScope === "field" && targetType !== "container") {
      fullscreenTarget = target;
    } else {
      fullscreenTarget =
        target.closest(
          '[data-md-scope="field"][data-field-type="container"]',
        ) ||
        target.closest('[data-md-scope="subsection"]') ||
        target.closest('[data-md-scope="section"]') ||
        target;
    }

    return {
      action: "fullscreen",
      target: fullscreenTarget,
      reason: "default",
    };
  }

  const scope = target.getAttribute("data-md-scope") || "field";
  const fieldType = target.getAttribute("data-field-type") || "tag";
  if (scope === "section" || scope === "subsection" || fieldType === "container") {
    return { action: "fullscreen", target, reason: "inline-ignored" };
  }

  return { action: "inline", target, reason: "inline" };
}
