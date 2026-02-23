import {
  openFullscreenForTarget,
  openInlineForTarget,
  isFullscreenOpen,
  requestCloseFullscreen,
  isInlineOpen,
  requestCloseInline,
} from "../src/host-router.js";

describe("Host router contract", () => {
  beforeEach(() => {
    global.window = {};
  });

  afterEach(() => {
    delete global.window;
  });

  test("fullscreen open is API-driven", () => {
    expect(isFullscreenOpen()).toBe(false);

    const isOpen = jest.fn(() => true);
    global.window.MarkdownFrontEditor = { isOpen };

    expect(isFullscreenOpen()).toBe(true);
    expect(isOpen).toHaveBeenCalledTimes(1);
  });

  test("openFullscreenForTarget forwards through public API", () => {
    const target = { id: "x" };
    const openForElement = jest.fn();
    global.window.MarkdownFrontEditor = { openForElement };

    expect(openFullscreenForTarget(target)).toBe(true);
    expect(openForElement).toHaveBeenCalledWith(target);
  });

  test("openFullscreenForTarget closes inline first when inline is open", async () => {
    const target = { id: "x" };
    let inlineOpen = true;
    const inlineClose = jest.fn(() => {
      inlineOpen = false;
      return true;
    });
    const openForElement = jest.fn();

    global.window.MarkdownFrontEditor = {
      openForElement,
      isOpen: jest.fn(() => false),
    };
    global.window.MarkdownFrontEditorInline = {
      isOpen: jest.fn(() => inlineOpen),
      close: inlineClose,
    };

    expect(openFullscreenForTarget(target)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(inlineClose).toHaveBeenCalledWith({
      saveOnClose: false,
      promptOnClose: true,
      keepToolbar: false,
      persistDraft: false,
    });
    expect(openForElement).toHaveBeenCalledWith(target);
  });

  test("requestCloseFullscreen calls close and rechecks isOpen", () => {
    let open = true;
    const close = jest.fn(() => {
      open = false;
    });
    const isOpen = jest.fn(() => open);
    global.window.MarkdownFrontEditor = { close, isOpen };

    expect(requestCloseFullscreen()).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(isOpen).toHaveBeenCalled();
  });

  test("inline open/close uses inline API only", async () => {
    const isOpen = jest.fn(() => true);
    const close = jest.fn(() => Promise.resolve(true));
    global.window.MarkdownFrontEditorInline = { isOpen, close };

    expect(isInlineOpen()).toBe(true);
    expect(await requestCloseInline({ promptOnClose: true })).toBe(false);
    expect(close).toHaveBeenCalledWith({ promptOnClose: true });
  });

  test("openInlineForTarget closes fullscreen first", () => {
    let fullscreenOpen = true;
    const close = jest.fn(() => {
      fullscreenOpen = false;
    });
    const openForElement = jest.fn();

    global.window.MarkdownFrontEditor = {
      close,
      isOpen: jest.fn(() => fullscreenOpen),
    };
    global.window.MarkdownFrontEditorInline = {
      isOpen: jest.fn(() => false),
      openForElement,
      close: jest.fn(() => true),
    };

    const target = { id: "inline-x" };
    expect(openInlineForTarget(target)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(openForElement).toHaveBeenCalledWith(target);
  });
});
