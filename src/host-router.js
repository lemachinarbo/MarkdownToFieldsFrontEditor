export function openFullscreenForTarget(target) {
  if (!target) return false;
  const api = window.MarkdownFrontEditor;
  if (!api || typeof api.openForElement !== "function") {
    return false;
  }
  api.openForElement(target);
  return true;
}

export function isFullscreenOpen() {
  const api = window.MarkdownFrontEditor;
  if (!api || typeof api.isOpen !== "function") {
    return false;
  }
  return api.isOpen() === true;
}

export function requestCloseFullscreen() {
  const api = window.MarkdownFrontEditor;
  if (!api || typeof api.close !== "function") {
    return !isFullscreenOpen();
  }
  api.close();
  return !isFullscreenOpen();
}

export function isInlineOpen() {
  const api = window.MarkdownFrontEditorInline;
  if (!api || typeof api.isOpen !== "function") {
    return false;
  }
  return api.isOpen() === true;
}

export function requestCloseInline(options = {}) {
  const api = window.MarkdownFrontEditorInline;
  if (!api || typeof api.close !== "function") {
    return Promise.resolve(!isInlineOpen());
  }
  return Promise.resolve(api.close(options)).then(() => !isInlineOpen());
}
