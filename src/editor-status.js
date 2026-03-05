import {
  showWindowToast,
  hideWindowToast,
  destroyWindowToast,
} from "./window-manager.js";

function createManager() {
  let statusEl = null;
  let dirtyFields = new Set();
  let lastExplicit = null;
  let hideTimer = null;

  function clearStatusTimer() {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function hideToast() {
    hideWindowToast();
  }

  function showToast(message, kind = "error", { persistent = false } = {}) {
    const text = String(message || "").trim();
    if (!text) return;
    showWindowToast(text, kind, { persistent });
  }

  function setClasses(type) {
    if (!statusEl) return;
    statusEl.classList.remove(
      "is-saved",
      "is-unchanged",
      "is-draft",
      "is-error",
      "is-processing",
    );
    if (type) {
      statusEl.classList.add(type);
    }
  }

  function showMessage(
    message,
    className,
    { autoHide = true, timeout = 2000 } = {},
  ) {
    if (!statusEl) return;
    clearStatusTimer();
    statusEl.textContent = message;
    setClasses(className);
    statusEl.classList.add("is-visible");

    if (autoHide) {
      hideTimer = window.setTimeout(() => {
        updateFromState();
      }, timeout);
    }
  }

  function showDraft() {
    showMessage("Draft", "is-draft", { autoHide: false });
  }

  function updateFromState() {
    if (!statusEl) return;
    if (dirtyFields.size > 0) {
      showDraft();
      return;
    }
    if (lastExplicit) {
      showMessage(lastExplicit.message, lastExplicit.className, {
        autoHide: true,
        timeout: lastExplicit.timeout || 2000,
      });
      return;
    }
    statusEl.classList.remove("is-visible");
  }

  function registerStatusEl(el) {
    statusEl = el;
    updateFromState();
  }

  function markDirty(fieldId) {
    if (fieldId) {
      dirtyFields.add(fieldId);
    }
    updateFromState();
  }

  function clearDirty(fieldId) {
    if (fieldId) {
      dirtyFields.delete(fieldId);
    }
    updateFromState();
  }

  function clearAllDirty() {
    dirtyFields.clear();
    updateFromState();
  }

  function setSaved() {
    hideToast();
    dirtyFields.clear();
    lastExplicit = { message: "Saved", className: "is-saved" };
    updateFromState();
  }

  function setNoChanges() {
    hideToast();
    dirtyFields.clear();
    lastExplicit = { message: "No changes", className: "is-unchanged" };
    updateFromState();
  }

  function setProcessing(message = "Saving...") {
    hideToast();
    lastExplicit = {
      message: String(message || "Saving..."),
      className: "is-processing",
      timeout: 2000,
    };
    showMessage(lastExplicit.message, lastExplicit.className, {
      autoHide: false,
    });
  }

  function setError(message = "Save failed", options = {}) {
    lastExplicit = {
      message: "Error",
      className: "is-error",
      timeout: 2500,
    };
    showToast(message, "alert", {
      persistent: Boolean(options?.persistent),
    });
    updateFromState();
  }

  function reset() {
    clearStatusTimer();
    hideToast();
    dirtyFields.clear();
    lastExplicit = null;
    if (statusEl) {
      statusEl.classList.remove(
        "is-saved",
        "is-unchanged",
        "is-draft",
        "is-error",
        "is-processing",
        "is-visible",
      );
      statusEl.textContent = "";
    }
    destroyWindowToast();
    statusEl = null;
  }

  return {
    registerStatusEl,
    markDirty,
    clearDirty,
    clearAllDirty,
    setSaved,
    setNoChanges,
    setProcessing,
    setError,
    reset,
  };
}

const globalManager = createManager();

export function createStatusManager() {
  return createManager();
}

export const registerStatusEl = globalManager.registerStatusEl;
export const markDirty = globalManager.markDirty;
export const clearDirty = globalManager.clearDirty;
export const setSaved = globalManager.setSaved;
export const setNoChanges = globalManager.setNoChanges;
export const setError = globalManager.setError;
