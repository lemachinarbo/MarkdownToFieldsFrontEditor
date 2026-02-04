export function renderToolbarButtons({ toolbar, buttons, configButtons, getEditor }) {
  const resolveEditor = () => (typeof getEditor === "function" ? getEditor() : null);

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
      toolbar.appendChild(sep);
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
    btn.type = "button";
    btn.className = `editor-toolbar-btn${btnDef.className ? ` ${btnDef.className}` : ""}`;

    const updateStyle = () => {
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

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      btnDef.action();
      setTimeout(updateStyle, 0);
    });

    btn.addEventListener("mouseenter", () => {
      if (!btnDef.isActive()) {
        btn.style.background = "#f3f4f6";
        btn.style.color = "#374151";
      }
    });

    btn.addEventListener("mouseleave", () => {
      updateStyle();
    });

    const editor = resolveEditor();
    if (editor) {
      editor.on("update", updateStyle);
      editor.on("selectionUpdate", updateStyle);
    }

    updateStyle();
    toolbar.appendChild(btn);
  });

  const spacer = document.createElement("div");
  spacer.className = "editor-toolbar-spacer";
  toolbar.appendChild(spacer);

  const status = document.createElement("div");
  status.className = "editor-toolbar-status";
  status.textContent = "";
  toolbar.appendChild(status);

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
    btn.type = "button";
    btn.className = `editor-toolbar-btn${saveBtn.className ? ` ${saveBtn.className}` : ""}`;

    const updateStyle = () => {
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

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      saveBtn.action();
      setTimeout(updateStyle, 0);
    });

    btn.addEventListener("mouseenter", () => {
      if (!saveBtn.isActive()) {
        btn.style.background = "#f3f4f6";
        btn.style.color = "#374151";
      }
    });

    btn.addEventListener("mouseleave", () => {
      updateStyle();
    });

    const editor = resolveEditor();
    if (editor) {
      editor.on("update", updateStyle);
      editor.on("selectionUpdate", updateStyle);
    }

    updateStyle();
    toolbar.appendChild(btn);
    saveButtonEl = btn;
  }

  return { statusEl: status, saveButtonEl };
}
