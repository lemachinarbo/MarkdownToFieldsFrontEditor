import {
  openFullscreenForTarget,
  openInlineForTarget,
  isFullscreenOpen,
  requestCloseFullscreen,
  isInlineOpen,
  requestCloseInline,
} from "../src/host-router.js";

describe("Host router contract", () => {
  async function flushMicrotasks(count = 6) {
    for (let i = 0; i < count; i += 1) {
      await Promise.resolve();
    }
  }

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

  test("openFullscreenForTarget forwards through canonical public API", async () => {
    const target = { id: "x" };
    const getCanonicalState = jest.fn(() => ({ markdown: "doc", applied: [] }));
    const openForElementFromCanonical = jest.fn();
    global.window.MarkdownFrontEditor = {
      getCanonicalState,
      openForElementFromCanonical,
      isOpen: jest.fn(() => false),
    };

    expect(openFullscreenForTarget(target)).toBe(true);
    await flushMicrotasks();

    expect(getCanonicalState).toHaveBeenCalledTimes(1);
    expect(openForElementFromCanonical).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ markdown: "doc" }),
    );
  });

  test("openFullscreenForTarget rejects markdown-only state", async () => {
    const target = { id: "x" };
    const getCanonicalState = jest.fn(() => ({ markdown: "doc" }));
    const openForElementFromCanonical = jest.fn();
    global.window.MarkdownFrontEditor = {
      getCanonicalState,
      openForElementFromCanonical,
      isOpen: jest.fn(() => false),
    };

    expect(openFullscreenForTarget(target)).toBe(true);
    await flushMicrotasks();

    expect(getCanonicalState).toHaveBeenCalledTimes(1);
    expect(openForElementFromCanonical).not.toHaveBeenCalled();
  });

  test("openFullscreenForTarget closes inline first when inline is open", async () => {
    const target = { id: "x" };
    let inlineOpen = true;
    const inlineClose = jest.fn(() => {
      inlineOpen = false;
      return true;
    });
    const openForElementFromCanonical = jest.fn();
    const getCanonicalState = jest.fn(() => ({ markdown: "doc", applied: [] }));

    global.window.MarkdownFrontEditor = {
      openForElementFromCanonical,
      getCanonicalState,
      isOpen: jest.fn(() => false),
    };
    global.window.MarkdownFrontEditorInline = {
      isOpen: jest.fn(() => inlineOpen),
      close: inlineClose,
    };

    expect(openFullscreenForTarget(target)).toBe(true);
    await flushMicrotasks();

    expect(inlineClose).toHaveBeenCalledWith({
      saveOnClose: false,
      promptOnClose: true,
      keepToolbar: false,
      persistDraft: false,
      flushToCanonical: true,
    });
  });

  test("requestCloseFullscreen flushes canonical before close", async () => {
    let open = true;
    const close = jest.fn(() => {
      open = false;
    });
    const flushToCanonical = jest.fn(() => Promise.resolve(true));
    const getCanonicalState = jest.fn(() => ({ markdown: "doc", applied: [] }));
    const isOpen = jest.fn(() => open);
    global.window.MarkdownFrontEditor = {
      close,
      isOpen,
      flushToCanonical,
      getCanonicalState,
    };

    expect(await requestCloseFullscreen()).toBe(true);
    expect(flushToCanonical).toHaveBeenCalledTimes(1);
    expect(getCanonicalState).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(isOpen).toHaveBeenCalled();
  });

  test("inline open/close uses inline API only", async () => {
    const isOpen = jest.fn(() => true);
    const close = jest.fn(() => Promise.resolve(true));
    global.window.MarkdownFrontEditorInline = { isOpen, close };

    expect(isInlineOpen()).toBe(true);
    expect(await requestCloseInline({ promptOnClose: true })).toBe(false);
    expect(close).toHaveBeenCalledWith({
      promptOnClose: true,
      flushToCanonical: true,
    });
  });

  test("openInlineForTarget closes fullscreen first", async () => {
    let fullscreenOpen = true;
    const close = jest.fn(() => {
      fullscreenOpen = false;
    });
    const flushToCanonical = jest.fn(() => Promise.resolve(true));
    const getCanonicalState = jest.fn(() => ({ markdown: "doc", applied: [] }));
    const openForElementFromCanonical = jest.fn();

    global.window.MarkdownFrontEditor = {
      close,
      flushToCanonical,
      getCanonicalState,
      isOpen: jest.fn(() => fullscreenOpen),
    };
    global.window.MarkdownFrontEditorInline = {
      isOpen: jest.fn(() => false),
      openForElementFromCanonical,
      close: jest.fn(() => true),
    };

    const target = { id: "inline-x" };
    expect(openInlineForTarget(target)).toBe(true);
    await flushMicrotasks();

    expect(flushToCanonical).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(openForElementFromCanonical).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ markdown: "doc" }),
    );
  });

  test("parallel open requests keep single active editor instance", async () => {
    let fullscreenOpen = false;
    let inlineOpen = false;
    let maxActiveEditors = 0;

    const updateActiveMax = () => {
      const activeCount = (fullscreenOpen ? 1 : 0) + (inlineOpen ? 1 : 0);
      if (activeCount > maxActiveEditors) {
        maxActiveEditors = activeCount;
      }
    };

    global.window.MarkdownFrontEditor = {
      getCanonicalState: jest.fn(() => ({ markdown: "doc", applied: [] })),
      openForElementFromCanonical: jest.fn(() => {
        fullscreenOpen = true;
        inlineOpen = false;
        updateActiveMax();
      }),
      flushToCanonical: jest.fn(() => Promise.resolve(true)),
      close: jest.fn(() => {
        fullscreenOpen = false;
        updateActiveMax();
      }),
      isOpen: jest.fn(() => fullscreenOpen),
    };

    global.window.MarkdownFrontEditorInline = {
      openForElementFromCanonical: jest.fn(() => {
        inlineOpen = true;
        fullscreenOpen = false;
        updateActiveMax();
      }),
      close: jest.fn(() => {
        inlineOpen = false;
        updateActiveMax();
        return Promise.resolve(true);
      }),
      isOpen: jest.fn(() => inlineOpen),
    };

    const publicFullscreenOpen = (target) => openFullscreenForTarget(target);
    const publicInlineOpen = (target) => openInlineForTarget(target);

    expect(publicFullscreenOpen({ id: "a" })).toBe(true);
    expect(publicInlineOpen({ id: "b" })).toBe(true);

    await flushMicrotasks();

    expect(maxActiveEditors).toBeLessThanOrEqual(1);
  });

  test("concurrent openInline/openFullscreen stays serialized by router lock", async () => {
    const events = [];
    let fullscreenOpen = true;
    let inlineOpen = false;
    let releaseFlush;

    global.window.MarkdownFrontEditor = {
      getCanonicalState: jest.fn(() => ({ markdown: "doc", applied: [] })),
      openForElementFromCanonical: jest.fn((target) => {
        events.push(`fullscreen-open:${target.id}`);
        fullscreenOpen = true;
        inlineOpen = false;
      }),
      flushToCanonical: jest.fn(
        () =>
          new Promise((resolve) => {
            releaseFlush = () => {
              events.push("fullscreen-flush-resolved");
              resolve(true);
            };
          }),
      ),
      close: jest.fn(() => {
        events.push("fullscreen-close");
        fullscreenOpen = false;
      }),
      isOpen: jest.fn(() => fullscreenOpen),
    };

    global.window.MarkdownFrontEditorInline = {
      openForElementFromCanonical: jest.fn((target) => {
        events.push(`inline-open:${target.id}`);
        inlineOpen = true;
        fullscreenOpen = false;
      }),
      close: jest.fn(() => {
        events.push("inline-close");
        inlineOpen = false;
        return Promise.resolve(true);
      }),
      isOpen: jest.fn(() => inlineOpen),
    };

    expect(openInlineForTarget({ id: "inline-a" })).toBe(true);
    expect(openFullscreenForTarget({ id: "full-b" })).toBe(true);

    await flushMicrotasks();
    expect(events).toEqual([]);

    releaseFlush();
    await flushMicrotasks();

    expect(events).toEqual([
      "fullscreen-flush-resolved",
      "fullscreen-close",
      "inline-open:inline-a",
      "inline-close",
      "fullscreen-open:full-b",
    ]);
  });
});
