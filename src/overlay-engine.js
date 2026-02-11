import { buildContentIndex, getSubsectionEntry } from "./content-index.js";

export function createOverlayEngine({ debugLabels = false } = {}) {
  let hoverOverlay = null;
  let hoverLabel = null;
  let markerTargets = [];
  let markerTargetsDirty = true;
  let markerDebugThrottle = null;

  function ensureOverlay() {
    if (hoverOverlay) return hoverOverlay;
    const overlay = document.createElement("div");
    overlay.className = "mfe-hover-overlay";
    overlay.style.display = "none";
    const label = document.createElement("span");
    label.className = "mfe-hover-label";
    overlay.appendChild(label);
    hoverLabel = label;
    document.body.appendChild(overlay);
    hoverOverlay = overlay;
    return overlay;
  }

  function hide() {
    if (!hoverOverlay) return;
    hoverOverlay.style.display = "none";
  }

  function setLabel(text) {
    if (!hoverLabel) return;
    hoverLabel.textContent = text || "";
    hoverLabel.dataset.debug = debugLabels ? "true" : "false";
  }

  function showBox(rect) {
    if (!hoverOverlay || !rect) return;
    if (document.body.classList.contains("mfe-debug-sections")) {
      hide();
      return;
    }
    if (document.body.classList.contains("mfe-view-fullscreen")) {
      hide();
      return;
    }
    const left = rect.left;
    const top = rect.top;
    const right = rect.right;
    const bottom = rect.bottom;
    if (right <= left || bottom <= top) {
      hide();
      return;
    }
    hoverOverlay.dataset.mode = "box";
    hoverOverlay.style.display = "block";
    hoverOverlay.style.left = `${left}px`;
    hoverOverlay.style.top = `${top}px`;
    hoverOverlay.style.width = `${Math.max(right - left, 0)}px`;
    hoverOverlay.style.height = `${Math.max(bottom - top, 0)}px`;
  }

  function showEdge(rect) {
    if (!hoverOverlay || !rect) return;
    if (document.body.classList.contains("mfe-debug-sections")) {
      hide();
      return;
    }
    if (document.body.classList.contains("mfe-view-fullscreen")) {
      hide();
      return;
    }
    const left = rect.left;
    const top = rect.top;
    const right = rect.right;
    if (right <= left) {
      hide();
      return;
    }
    hoverOverlay.dataset.mode = "edge";
    hoverOverlay.style.display = "block";
    hoverOverlay.style.left = `${left}px`;
    hoverOverlay.style.top = `${top}px`;
    hoverOverlay.style.width = `${Math.max(right - left, 0)}px`;
    hoverOverlay.style.height = "2px";
  }

  function buildMarkerTargets() {
    const index = buildContentIndex();
    const targets = index.targets.filter(
      (target) =>
        (target.scope === "section" || target.scope === "subsection") &&
        target.rect,
    );
    markerTargets = targets.map((target) => ({
      scope: target.scope,
      name: target.name,
      section: target.section,
      rect: target.rect,
      markdownB64: target.markdownB64 || "",
    }));
    markerTargetsDirty = false;
  }

  function getMarkerTargets() {
    if (markerTargetsDirty) {
      buildMarkerTargets();
    }
    return markerTargets;
  }

  function isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function findMarkerTargetFromPoint(x, y) {
    const targets = getMarkerTargets();
    const hits = targets.filter((t) => isPointInRect(x, y, t.rect));
    if (!hits.length) return null;
    hits.sort((a, b) => {
      const areaA = (a.rect.right - a.rect.left) * (a.rect.bottom - a.rect.top);
      const areaB = (b.rect.right - b.rect.left) * (b.rect.bottom - b.rect.top);
      return areaA - areaB;
    });
    return hits[0];
  }

  function getMetaAttr(el, name) {
    if (!el) return "";
    return (
      el.getAttribute(`data-mfe-${name}`) ||
      el.getAttribute(`data-md-${name}`) ||
      ""
    );
  }

  function findFieldSubsectionTargetFromPoint(x, y) {
    const stack =
      typeof document.elementsFromPoint === "function"
        ? document.elementsFromPoint(x, y)
        : [];
    const hitEl = stack.find((el) =>
      el?.closest?.(
        '.fe-editable[data-mfe-scope="subsection"], .fe-editable[data-md-scope="subsection"]',
      ),
    );
    const subsectionEl = hitEl?.closest
      ? hitEl.closest(
          '.fe-editable[data-mfe-scope="subsection"], .fe-editable[data-md-scope="subsection"]',
        )
      : null;
    if (subsectionEl) {
      const section = getMetaAttr(subsectionEl, "section") || "";
      const name = getMetaAttr(subsectionEl, "name") || "";
      const rect = subsectionEl.getBoundingClientRect();
      const entry = getSubsectionEntry(section, name);
      return {
        scope: "subsection",
        section,
        name,
        rect,
        markdownB64: entry?.markdownB64 || "",
      };
    }
    return null;
  }

  function invalidate(reason) {
    markerTargetsDirty = true;
    if (!markerDebugThrottle) {
      markerDebugThrottle = window.setTimeout(() => {
        markerDebugThrottle = null;
        getMarkerTargets();
      }, 120);
    }
  }

  return {
    init: ensureOverlay,
    hide,
    setLabel,
    showBox,
    showEdge,
    findMarkerTargetFromPoint,
    findFieldSubsectionTargetFromPoint,
    invalidate,
  };
}
