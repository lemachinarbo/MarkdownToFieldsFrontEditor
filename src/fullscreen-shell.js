export function setFullscreenShellOpen(isOpen) {
  if (typeof document === "undefined") return;
  if (!document.body?.classList) return;
  if (isOpen) {
    document.body.classList.add("mfe-view-fullscreen");
    return;
  }
  document.body.classList.remove("mfe-view-fullscreen");
}

export function setDocumentModeShellOpen(isOpen) {
  if (typeof document === "undefined") return;
  if (!document.body?.classList) return;
  if (isOpen) {
    document.body.classList.add("mfe-document-mode");
    return;
  }
  document.body.classList.remove("mfe-document-mode");
}
