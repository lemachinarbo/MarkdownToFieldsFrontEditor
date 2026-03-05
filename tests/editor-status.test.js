/** @jest-environment jsdom */

import { createStatusManager } from "../src/editor-status.js";

describe("editor status", () => {
  let statusEl;
  let manager;

  beforeEach(() => {
    statusEl = document.createElement("div");
    statusEl.className = "editor-toolbar-status";
    document.body.appendChild(statusEl);
    manager = createStatusManager();
    manager.registerStatusEl(statusEl);
  });

  afterEach(() => {
    manager.reset();
    statusEl.remove();
  });

  test("setProcessing shows processing state until completion", () => {
    manager.setProcessing();
    expect(statusEl.textContent).toBe("Saving...");
    expect(statusEl.classList.contains("is-processing")).toBe(true);
    expect(statusEl.classList.contains("is-visible")).toBe(true);

    manager.setSaved();
    expect(statusEl.textContent).toBe("Saved");
    expect(statusEl.classList.contains("is-processing")).toBe(false);
    expect(statusEl.classList.contains("is-saved")).toBe(true);
  });

  test("setProcessing accepts custom message", () => {
    manager.setProcessing("Uploading image...");
    expect(statusEl.textContent).toBe("Uploading image...");
    expect(statusEl.classList.contains("is-processing")).toBe(true);
  });
});
