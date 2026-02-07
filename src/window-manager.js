/**
 * Window Manager for MarkdownFrontEditor
 *
 * Manages a stack of fullscreen overlays ("windows") with standardized structure:
 * 1. Menu Bar (can be enabled/disabled with overlay effect)
 * 2. Breadcrumbs (shows window hierarchy, responds to stack state)
 * 3. Close Button (independent on each window)
 * 4. Content Area (standardized across all window types)
 */

import { createWindowTemplate } from "./window-template.js";

let windowStack = [];

/**
 * Get current window breadcrumb path based on stack state
 */
function getBreadcrumbPath() {
  const paths = [];

  for (let i = 0; i < windowStack.length; i++) {
    const win = windowStack[i];
    if (win.breadcrumbLabel) {
      paths.push(win.breadcrumbLabel);
    }
  }

  return paths;
}

/**
 * Update breadcrumbs in all windows
 */
function updateBreadcrumbs() {
  const baseWin = windowStack.find(
    (win) => Array.isArray(win.breadcrumbItems) && win.breadcrumbItems.length,
  );
  const baseItems = baseWin?.breadcrumbItems || [];
  const baseClickHandler = baseWin?.breadcrumbClickHandler || null;

  windowStack.forEach((win, index) => {
    const breadcrumbEl = win.dom?.querySelector("[data-mfe-breadcrumb]");
    if (!breadcrumbEl) return;

    const breadcrumbInner =
      breadcrumbEl.querySelector("[data-mfe-breadcrumb-inner]") || breadcrumbEl;

    breadcrumbInner.innerHTML = "";
    const windowLabels = windowStack
      .slice(0, index + 1)
      .map((item) => item.breadcrumbLabel)
      .filter((label) => typeof label === "string" && label.trim() !== "");

    const items = [
      ...baseItems.map((item) => ({ ...item, source: "base" })),
      ...windowLabels.map((label, labelIndex) => ({
        label,
        source: "window",
        windowIndex: labelIndex,
      })),
    ];

    items.forEach((item, itemIndex) => {
      if (itemIndex > 0) {
        const separator = document.createElement("span");
        separator.className = "mfe-breadcrumb-separator";
        separator.textContent = " > ";
        breadcrumbInner.appendChild(separator);
      }

      const isLast = itemIndex === items.length - 1;
      const isLink = item.source === "base" && item.state === "link";
      const isWindowLink = item.source === "window" && !isLast;
      // Base items with "current" state should become links if not last
      const isBaseCurrentButNotLast =
        item.source === "base" && item.state === "current" && !isLast;

      const crumb = document.createElement(
        isLink || isWindowLink || isBaseCurrentButNotLast ? "button" : "span",
      );
      crumb.className = "mfe-breadcrumb-item";
      crumb.textContent = item.label;

      // Mark as current if: base item with "current" state AND isLast, OR window item AND isLast
      if (
        (item.state === "current" && isLast) ||
        (item.source === "window" && isLast)
      ) {
        crumb.classList.add("mfe-breadcrumb-current");
      }
      if (item.state === "disabled") {
        crumb.classList.add("mfe-breadcrumb-disabled");
      }
      if (isLink || isWindowLink || isBaseCurrentButNotLast) {
        crumb.classList.add("mfe-breadcrumb-clickable", "mfe-breadcrumb-link");
      }

      if ((isLink || isBaseCurrentButNotLast) && baseClickHandler) {
        crumb.setAttribute("data-breadcrumb-target", item.target || "");
        crumb.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          while (windowStack.length > index + 1) {
            closeTopWindow();
          }
          baseClickHandler(e);
        });
      } else if (isWindowLink) {
        crumb.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          while (windowStack.length > item.windowIndex + 1) {
            closeTopWindow();
          }
        });
      }

      breadcrumbInner.appendChild(crumb);
    });
  });
}

/**
 * Opens a new fullscreen window on top of everything with standardized structure
 */
export function openWindow({
  id = "",
  content,
  onClose,
  onMount,
  showMenuBar = true,
  menuBarDisabled = false,
  breadcrumbLabel = "",
  breadcrumbItems = null,
  breadcrumbClickHandler = null,
  className = "",
  background = "white",
}) {
  if (windowStack.length === 0) {
    document.body.classList.add("mfe-no-scroll");
  }

  const zIndex = 100000 + windowStack.length * 100;

  // Create overlay from template
  const overlay = createWindowTemplate({
    id,
    className,
    background,
    showMenuBar,
    menuBarDisabled,
    zIndex,
  });

  // Set inline positioning styles
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";

  // Attach close button handler
  const closeButton = overlay.querySelector(".mfe-window-close-btn");
  if (closeButton) {
    closeButton.onclick = (e) => {
      e.stopPropagation();
      closeTopWindow();
    };
  }

  // Add disabled class to menubar if needed
  if (menuBarDisabled && showMenuBar) {
    const menuBar = overlay.querySelector(".mfe-window-menubar");
    if (menuBar) {
      menuBar.classList.add("mfe-menubar-disabled");
    }
  }

  // Insert content into the content inner div
  const contentInner = overlay.querySelector("[data-mfe-content-inner]");
  if (contentInner) {
    if (content instanceof HTMLElement) {
      contentInner.appendChild(content);
    } else if (typeof content === "string") {
      contentInner.innerHTML = content;
    }
  }

  // Append overlay to DOM
  document.body.appendChild(overlay);

  const windowInstance = {
    id,
    dom: overlay,
    onClose,
    breadcrumbLabel,
    breadcrumbItems,
    breadcrumbClickHandler,
    menuBarDisabled,
  };

  windowStack.push(windowInstance);
  updateBreadcrumbs();

  if (onMount) onMount(overlay, windowInstance);

  return windowInstance;
}

/**
 * Closes the topmost window in the stack.
 */
export function closeTopWindow() {
  if (windowStack.length === 0) return;

  const win = windowStack.pop();

  // Cleanup DOM
  if (win.dom && win.dom.parentNode) {
    win.dom.remove();
  }

  // Trigger callback
  if (win.onClose) {
    win.onClose();
  }

  // Unlock scrolling if no more windows
  if (windowStack.length === 0) {
    document.body.classList.remove("mfe-no-scroll");
  } else {
    // Update breadcrumbs for remaining windows
    updateBreadcrumbs();
  }
}

/**
 * Closes a specific window by its ID or instance.
 */
export function closeWindow(winOrId) {
  const index =
    typeof winOrId === "string"
      ? windowStack.findIndex((w) => w.id === winOrId)
      : windowStack.indexOf(winOrId);

  if (index === -1) return;

  const [win] = windowStack.splice(index, 1);
  if (win.dom && win.dom.parentNode) {
    win.dom.remove();
  }
  if (win.onClose) win.onClose();

  if (windowStack.length === 0) {
    document.body.classList.remove("mfe-no-scroll");
  } else {
    updateBreadcrumbs();
  }
}

/**
 * Global Keyboard Listener for Escape key.
 * Only triggers for the topmost window when NOT inside an input/textarea.
 */
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") {
      if (windowStack.length > 0) {
        // Don't intercept Escape if user is typing in an input/textarea
        // Let the input handle it normally (blur on first escape)
        const isInInput =
          document.activeElement &&
          (document.activeElement.tagName === "INPUT" ||
            document.activeElement.tagName === "TEXTAREA");

        if (!isInInput) {
          e.preventDefault();
          e.stopPropagation();
          closeTopWindow();
        }
      }
    }
  },
  true,
); // Capture phase to catch it before other listeners
