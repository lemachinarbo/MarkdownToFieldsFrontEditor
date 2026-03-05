import { getSubsectionEntry } from "./content-index.js";

export function createOverlayEngine({ debugLabels = false } = {}) {
  const HOVER_ACTIVE_CLASS = "mfe-state-hover-active";
  let hoverOverlay = null;
  let hoverLabel = null;

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
    document.body.classList.remove(HOVER_ACTIVE_CLASS);
  }

  function setLabel(text) {
    if (!hoverLabel) return;
    hoverLabel.textContent = text || "";
    hoverLabel.dataset.debug = debugLabels ? "true" : "false";
  }

  function showBox(rect) {
    if (!hoverOverlay || !rect) return;
    if (document.body.classList.contains("mfe-debug-labels")) {
      hide();
      return;
    }
    if (document.body.classList.contains("mfe-debug-sections")) {
      hide();
      return;
    }
    if (document.body.classList.contains("mfe-state-fullscreen-open")) {
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
    document.body.classList.add(HOVER_ACTIVE_CLASS);
    hoverOverlay.style.left = `${left}px`;
    hoverOverlay.style.top = `${top}px`;
    hoverOverlay.style.width = `${Math.max(right - left, 0)}px`;
    hoverOverlay.style.height = `${Math.max(bottom - top, 0)}px`;
  }

  function showEdge(rect) {
    if (!hoverOverlay || !rect) return;
    if (document.body.classList.contains("mfe-debug-labels")) {
      hide();
      return;
    }
    if (document.body.classList.contains("mfe-debug-sections")) {
      hide();
      return;
    }
    if (document.body.classList.contains("mfe-state-fullscreen-open")) {
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
    document.body.classList.add(HOVER_ACTIVE_CLASS);
    hoverOverlay.style.left = `${left}px`;
    hoverOverlay.style.top = `${top}px`;
    hoverOverlay.style.width = `${Math.max(right - left, 0)}px`;
    hoverOverlay.style.height = "2px";
  }

  function getMetaAttr(el, name) {
    if (!el) return "";
    return el.getAttribute(`data-mfe-${name}`) || "";
  }

  function findFieldSubsectionTargetFromPoint(x, y) {
    const stack =
      typeof document.elementsFromPoint === "function"
        ? document.elementsFromPoint(x, y)
        : [];
    const hitEl = stack.find((el) =>
      el?.closest?.('.fe-editable[data-mfe-scope="subsection"]'),
    );
    const subsectionEl = hitEl?.closest
      ? hitEl.closest('.fe-editable[data-mfe-scope="subsection"]')
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

  return {
    init: ensureOverlay,
    hide,
    setLabel,
    showBox,
    showEdge,
    findFieldSubsectionTargetFromPoint,
  };
}
