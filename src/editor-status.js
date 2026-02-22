function createManager() {
  let statusEl = null;
  let dirtyFields = new Set();
  let lastExplicit = null;
  let hideTimer = null;
  let toastEl = null;
  let toastTimer = null;

  function clearStatusTimer() {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function clearToastTimer() {
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function hideToast() {
    clearToastTimer();
    if (toastEl) {
      toastEl.classList.remove("mfe-toast-visible");
    }
  }

  function showToast(message, kind = "error", { persistent = false } = {}) {
    const text = String(message || "").trim();
    if (!text) return;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "mfe-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.classList.remove("mfe-toast-error", "mfe-toast-visible");
    if (kind === "error") {
      toastEl.classList.add("mfe-toast-error");
    }
    toastEl.textContent = text;
    toastEl.classList.add("mfe-toast-visible");
    clearToastTimer();
    if (!persistent) {
      toastTimer = window.setTimeout(() => {
        if (toastEl) {
          toastEl.classList.remove("mfe-toast-visible");
        }
        toastTimer = null;
      }, 3200);
    }
  }

  function setClasses(type) {
    if (!statusEl) return;
    statusEl.classList.remove(
      "is-saved",
      "is-unchanged",
      "is-draft",
      "is-error",
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

  function setSaved() {
    hideToast();
    lastExplicit = { message: "Saved", className: "is-saved" };
    updateFromState();
  }

  function setNoChanges() {
    hideToast();
    lastExplicit = { message: "No changes", className: "is-unchanged" };
    updateFromState();
  }

  function setError(message = "Save failed", options = {}) {
    lastExplicit = {
      message: "Error",
      className: "is-error",
      timeout: 2500,
    };
    showToast(message, "error", {
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
        "is-visible",
      );
      statusEl.textContent = "";
    }
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
    statusEl = null;
  }

  return {
    registerStatusEl,
    markDirty,
    clearDirty,
    setSaved,
    setNoChanges,
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
