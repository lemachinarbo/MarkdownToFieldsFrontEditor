/** @jest-environment jsdom */

import { createToolbarButtons } from "../src/editor-toolbar.js";

describe("editor toolbar buttons", () => {
  test("exposes a single markdown toggle instead of separate rich/raw buttons", () => {
    const onToggleMarkdownView = jest.fn();

    const buttons = createToolbarButtons({
      getEditor: () => null,
      getCurrentLanguage: () => "en",
      markUserIntentToken: () => {},
      onSave: jest.fn(),
      onToggleMarkdownView,
      isMarkdownView: () => true,
      onToggleHistory: jest.fn(),
      isHistoryActive: () => false,
      onToggleSplit: jest.fn(),
      isSplitActive: () => false,
      onOpenDocumentView: jest.fn(),
      canOpenDocumentView: () => true,
      isDocumentView: () => false,
      onToggleOutlineView: jest.fn(),
      isOutlineView: () => false,
    });

    expect(buttons.find((button) => button.key === "rich")).toBeUndefined();
    expect(buttons.find((button) => button.key === "raw")).toBeUndefined();

    const markdownButton = buttons.find((button) => button.key === "markdown");
    expect(markdownButton).toBeDefined();
    expect(markdownButton.label).toContain("icon-tabler-markdown");
    expect(markdownButton.isActive()).toBe(true);

    markdownButton.action();

    expect(onToggleMarkdownView).toHaveBeenCalledTimes(1);
  });
});
