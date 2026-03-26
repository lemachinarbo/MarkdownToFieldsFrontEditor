import { defer } from "./async-queue.js";

export function renderToolbarButtons({
  toolbar,
  buttons,
  configButtons,
  getEditor,
  isButtonDisabled,
}) {
  const resolveEditor = () =>
    typeof getEditor === "function" ? getEditor() : null;
  const emitUserIntent = (source) => {
    if (typeof document === "undefined") return;
    document.dispatchEvent(
      new CustomEvent("mfe:user-intent", {
        detail: {
          source: String(source || "toolbar"),
        },
      }),
    );
  };
  const buttonRefreshers = [];
  const mainGroup = document.createElement("div");
  mainGroup.className = "editor-toolbar-main";
  toolbar.appendChild(mainGroup);

  const createEditorAwareRefresher = (updateStyle) => {
    let boundEditor = null;
    const onEditorUpdate = () => {
      updateStyle();
    };

    return () => {
      const nextEditor = resolveEditor();
      if (nextEditor !== boundEditor) {
        if (boundEditor && typeof boundEditor.off === "function") {
          boundEditor.off("update", onEditorUpdate);
          boundEditor.off("selectionUpdate", onEditorUpdate);
        }
        boundEditor = nextEditor;
        if (boundEditor && typeof boundEditor.on === "function") {
          boundEditor.on("update", onEditorUpdate);
          boundEditor.on("selectionUpdate", onEditorUpdate);
        }
      }
      updateStyle();
    };
  };

  const buttonMap = new Map(buttons.map((btn) => [btn.key, btn]));

  const configOrder = configButtons
    .split(",")
    .map((btn) => btn.trim())
    .filter((btn) => btn.length > 0);

  const orderedItems = configOrder
    .map((key) => {
      if (key === "|") return { type: "separator" };
      if (key === "save") return null;
      const btn = buttonMap.get(key);
      return btn ? { type: "button", btn } : null;
    })
    .filter(Boolean);

  orderedItems.forEach((item) => {
    if (item.type === "separator") {
      const sep = document.createElement("span");
      sep.className = "editor-toolbar-separator";
      mainGroup.appendChild(sep);
      return;
    }

    const btnDef = item.btn;
    const btn = document.createElement("button");
    if (btnDef.label.trim().startsWith("<svg")) {
      btn.innerHTML = btnDef.label;
    } else {
      btn.textContent = btnDef.label;
    }
    btn.title = btnDef.title;
    const ariaLabel = String(btnDef.alt || "").trim();
    if (ariaLabel) {
      btn.setAttribute("aria-label", ariaLabel);
    }
    btn.type = "button";
    btn.className = `editor-toolbar-btn${btnDef.className ? ` ${btnDef.className}` : ""}`;

    const updateStyle = () => {
      const disabled =
        typeof isButtonDisabled === "function"
          ? Boolean(isButtonDisabled(btnDef.key, btnDef))
          : false;
      btn.disabled = disabled;
      btn.setAttribute("aria-disabled", disabled ? "true" : "false");
      if (disabled) {
        btn.style.background = "transparent";
        btn.style.color = "#cbd5e1";
        btn.style.boxShadow = "none";
        btn.style.cursor = "not-allowed";
        btn.style.opacity = "0.72";
        return;
      }
      btn.style.cursor = "";
      btn.style.opacity = "";
      if (btnDef.isActive()) {
        btn.style.background = "#eef2ff";
        btn.style.color = "#3730a3";
        btn.style.boxShadow = "inset 0 0 0 1px rgba(99, 102, 241, 0.18)";
      } else {
        btn.style.background = "transparent";
        btn.style.color = "#6b7280";
        btn.style.boxShadow = "none";
      }
    };

    btn.onmousedown = (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      emitUserIntent(`toolbar:${btnDef.key}:mousedown`);
      btnDef.action();
      defer(refreshButton);
    };

    btn.onmouseenter = () => {
      if (btn.disabled) return;
      if (!btnDef.isActive()) {
        btn.style.background = "#f3f4f6";
        btn.style.color = "#374151";
      }
    };

    btn.onmouseleave = () => {
      refreshButton();
    };

    const refreshButton = createEditorAwareRefresher(updateStyle);
    buttonRefreshers.push(refreshButton);
    refreshButton();
    mainGroup.appendChild(btn);
  });

  const metaGroup = document.createElement("div");
  metaGroup.className = "editor-toolbar-meta";
  toolbar.appendChild(metaGroup);

  const status = document.createElement("div");
  status.className = "editor-toolbar-status";
  status.textContent = "";
  metaGroup.appendChild(status);

  const saveBtn = buttons.find((btn) => btn.key === "save");
  let saveButtonEl = null;
  if (saveBtn) {
    const btn = document.createElement("button");
    if (saveBtn.label.trim().startsWith("<svg")) {
      btn.innerHTML = saveBtn.label;
    } else {
      btn.textContent = saveBtn.label;
    }
    btn.title = saveBtn.title;
    const saveAriaLabel = String(saveBtn.alt || "").trim();
    if (saveAriaLabel) {
      btn.setAttribute("aria-label", saveAriaLabel);
    }
    btn.type = "button";
    btn.className = `editor-toolbar-btn${saveBtn.className ? ` ${saveBtn.className}` : ""}`;

    const updateStyle = () => {
      const disabled =
        typeof isButtonDisabled === "function"
          ? Boolean(isButtonDisabled(saveBtn.key, saveBtn))
          : false;
      btn.disabled = disabled;
      btn.setAttribute("aria-disabled", disabled ? "true" : "false");
      if (disabled) {
        btn.style.background = "transparent";
        btn.style.color = "#cbd5e1";
        btn.style.boxShadow = "none";
        btn.style.cursor = "not-allowed";
        btn.style.opacity = "0.72";
        return;
      }
      btn.style.cursor = "";
      btn.style.opacity = "";
      if (saveBtn.isActive()) {
        btn.style.background = "#eef2ff";
        btn.style.color = "#3730a3";
        btn.style.boxShadow = "inset 0 0 0 1px rgba(99, 102, 241, 0.18)";
      } else {
        btn.style.background = "transparent";
        btn.style.color = "#6b7280";
        btn.style.boxShadow = "none";
      }
    };

    btn.onmousedown = (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      emitUserIntent(`toolbar:save:mousedown`);
      saveBtn.action();
      defer(refreshButton);
    };

    btn.onmouseenter = () => {
      if (btn.disabled) return;
      if (!saveBtn.isActive()) {
        btn.style.background = "#f3f4f6";
        btn.style.color = "#374151";
      }
    };

    btn.onmouseleave = () => {
      refreshButton();
    };

    const refreshButton = createEditorAwareRefresher(updateStyle);
    buttonRefreshers.push(refreshButton);
    refreshButton();
    metaGroup.appendChild(btn);
    saveButtonEl = btn;
  }

  const refreshButtons = () => {
    buttonRefreshers.forEach((refresh) => refresh());
  };

  return { statusEl: status, saveButtonEl, refreshButtons };
}
