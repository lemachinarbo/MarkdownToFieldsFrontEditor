export function createMenubarShell({ className = "", top = "" } = {}) {
  const menubar = document.createElement("div");
  menubar.className = ["mfe-window-menubar", className]
    .filter(Boolean)
    .join(" ");

  if (top) {
    menubar.style.setProperty("--mfe-menubar-top", String(top));
  }

  const menubarInner = document.createElement("div");
  menubarInner.className = "mfe-window-inner";
  menubar.appendChild(menubarInner);

  return { menubar, menubarInner };
}

export function attachToolbarToMenubarInner(menubarInner, toolbar) {
  if (!menubarInner || !toolbar) return;
  menubarInner.appendChild(toolbar);
}

export function resolveOverlayMenubarInner(overlay) {
  if (!overlay?.querySelector) return null;
  return overlay.querySelector("[data-mfe-menubar-inner]");
}
