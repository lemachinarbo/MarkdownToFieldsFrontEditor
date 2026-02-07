/**
 * Window Template Manager
 *
 * Provides HTML templates for window structure to avoid inline DOM creation.
 */

/**
 * Creates a new window overlay from template
 * @param {Object} options - Configuration options
 * @returns {HTMLElement} The overlay element
 */
export function createWindowTemplate({
  id = "",
  className = "",
  background = "white",
  showMenuBar = true,
  menuBarDisabled = false,
  zIndex = 100000,
}) {
  const html = `
    <div class="mfe-window-overlay ${className}" 
         id="${escapeHtml(id)}" 
         data-mfe-window="true"
         style="z-index: ${zIndex}; background: ${background};">
      
      ${
        showMenuBar
          ? `
        <div class="mfe-window-menubar" 
             data-mfe-menubar="true"
             ${menuBarDisabled ? 'data-menubar-disabled="true"' : ""}>
          <div class="mfe-window-inner" data-mfe-menubar-inner="true"></div>
        </div>
      `
          : ""
      }
      
      <button type="button" 
              class="mfe-window-close-btn" 
              title="Close window"
              aria-label="Close window">×</button>
      
      <section class="mfe-window-container" data-mfe-content="true">
        <div class="mfe-window-content">
          <nav class="mfe-window-breadcrumbs" data-mfe-breadcrumb="true">
            <div class="mfe-window-inner" data-mfe-breadcrumb-inner="true"></div>
          </nav>
          <div class="mfe-window-inner mfe-window-content-inner" data-mfe-content-inner="true"></div>
        </div>
      </section>
    </div>
  `;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  return wrapper.firstElementChild;
}

/**
 * Helper function to escape HTML entities
 */
function escapeHtml(text) {
  if (!text) return "";
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
