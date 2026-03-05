/** @jest-environment jsdom */

import {
  TOAST_KINDS,
  clearGlobalToast,
  closeTopWindow,
  destroyWindowToast,
  openWindow,
  showWindowToast,
} from "../src/window-manager.js";

describe("window toast contract", () => {
  afterEach(() => {
    destroyWindowToast();
    while (document.querySelector('[data-mfe-window="true"]')) {
      closeTopWindow();
    }
    document.body.className = "";
  });

  test("applies semantic classes for info/success/alert kinds", () => {
    showWindowToast("Saving...", TOAST_KINDS.info, { persistent: true });
    let toast = document.querySelector("[data-mfe-window-toast]");
    expect(toast.classList.contains("mfe-toast-info")).toBe(true);

    showWindowToast("Saved", TOAST_KINDS.success, { persistent: true });
    toast = document.querySelector("[data-mfe-window-toast]");
    expect(toast.classList.contains("mfe-toast-success")).toBe(true);

    showWindowToast("Save failed", TOAST_KINDS.alert, { persistent: true });
    toast = document.querySelector("[data-mfe-window-toast]");
    expect(toast.classList.contains("mfe-toast-alert")).toBe(true);
  });

  test("global saving toast survives window close", () => {
    openWindow({
      id: "test-toast-win",
      content: document.createElement("div"),
    });

    showWindowToast("Saving...", TOAST_KINDS.info, {
      persistent: true,
      global: true,
    });

    const toast = document.querySelector("[data-mfe-window-toast]");
    expect(toast.classList.contains("mfe-toast-visible")).toBe(true);

    closeTopWindow();

    expect(toast.parentElement).toBe(document.body);
    expect(toast.classList.contains("mfe-toast-visible")).toBe(true);

    clearGlobalToast();
    expect(toast.classList.contains("mfe-toast-visible")).toBe(false);
  });
});
