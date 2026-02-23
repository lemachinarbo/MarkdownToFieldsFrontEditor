export function setInlineShellOpen(isOpen) {
  if (typeof document === "undefined") return;
  if (!document.body?.classList) return;
  if (isOpen) {
    document.body.classList.add("mfe-view-inline");
    return;
  }
  document.body.classList.remove("mfe-view-inline");
}

export function setInlineDebugShell({
  showSections = false,
  showLabels = false,
} = {}) {
  if (typeof document === "undefined") return;
  if (!document.body?.classList) return;
  if (showSections) {
    document.body.classList.add("mfe-debug-sections");
  }
  if (showSections || showLabels) {
    document.body.classList.add("mfe-debug-labels");
  }
}

export function setInlineLabelStyle(labelStyle = "outside") {
  if (typeof document === "undefined") return;
  if (!document.body?.setAttribute) return;
  document.body.setAttribute("data-mfe-label-style", labelStyle || "outside");
}

export function isInlineShellOpen() {
  if (typeof document === "undefined") return false;
  return Boolean(document.body?.classList?.contains("mfe-view-inline"));
}
