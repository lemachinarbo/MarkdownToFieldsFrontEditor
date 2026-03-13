/** @jest-environment jsdom */

import { renderToolbarButtons } from "../src/editor-toolbar-renderer.js";

describe("editor toolbar renderer", () => {
  test("groups primary controls separately from status and save controls", () => {
    const toolbar = document.createElement("div");
    const buttons = [
      {
        key: "bold",
        label: "B",
        title: "Bold",
        action: jest.fn(),
        isActive: () => false,
      },
      {
        key: "save",
        label: "Save",
        title: "Save",
        className: "editor-toolbar-save",
        action: jest.fn(),
        isActive: () => false,
      },
    ];

    const { statusEl, saveButtonEl } = renderToolbarButtons({
      toolbar,
      buttons,
      configButtons: "bold,|,save",
      getEditor: () => null,
    });

    const mainGroup = toolbar.querySelector(".editor-toolbar-main");
    const metaGroup = toolbar.querySelector(".editor-toolbar-meta");

    expect(mainGroup).not.toBeNull();
    expect(metaGroup).not.toBeNull();
    expect(mainGroup.contains(toolbar.querySelector(".editor-toolbar-separator"))).toBe(true);
    expect(mainGroup.contains(toolbar.querySelector(".editor-toolbar-btn"))).toBe(true);
    expect(metaGroup.contains(statusEl)).toBe(true);
    expect(metaGroup.contains(saveButtonEl)).toBe(true);
  });
});
