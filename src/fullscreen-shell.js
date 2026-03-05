export function setFullscreenShellOpen(isOpen) {
  if (typeof document === "undefined") return;
  if (!document.body?.classList) return;
  if (isOpen) {
    document.body.classList.add("mfe-state-fullscreen-open");
    return;
  }
  document.body.classList.remove("mfe-state-fullscreen-open");
}

export function setDocumentModeShellOpen(isOpen) {
  if (typeof document === "undefined") return;
  if (!document.body?.classList) return;
  if (isOpen) {
    document.body.classList.add("mfe-state-document-mode");
    return;
  }
  document.body.classList.remove("mfe-state-document-mode");
}
