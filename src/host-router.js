export function openFullscreenForTarget(target) {
  if (!target) return false;
  const api = window.MarkdownFrontEditor;
  if (!api || typeof api.openForElement !== "function") {
    return false;
  }

  if (!isInlineOpen()) {
    api.openForElement(target);
    return true;
  }

  requestCloseInline({
    saveOnClose: false,
    promptOnClose: true,
    keepToolbar: false,
    persistDraft: false,
  }).then((closed) => {
    if (!closed) return;
    api.openForElement(target);
  });

  return true;
}

export function openInlineForTarget(target) {
  if (!target) return false;

  const inlineApi = window.MarkdownFrontEditorInline;
  if (!inlineApi || typeof inlineApi.openForElement !== "function") {
    return false;
  }

  if (isFullscreenOpen()) {
    const closed = requestCloseFullscreen();
    if (!closed) return false;
  }

  inlineApi.openForElement(target);
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
