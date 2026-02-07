import { fetchCsrfToken } from "./editor-core.js";

/**
 * Image Picker Overlay
 * 
 * Displays available images from the source folder and allows users to select
 * an image to insert into the markdown editor.
 */

export function createImagePicker({ onSelect, onClose }) {
  const overlay = document.createElement("div");
  overlay.className = "mfe-image-picker-overlay";
  overlay.setAttribute("data-image-picker", "true");

  const container = document.createElement("div");
  container.className = "mfe-image-picker-container";

  const header = document.createElement("div");
  header.className = "mfe-image-picker-header";
  header.innerHTML = `
    <h3>Select Image</h3>
    <button type="button" class="mfe-image-picker-close" title="Close">×</button>
  `;

  const grid = document.createElement("div");
  grid.className = "mfe-image-picker-grid";
  grid.innerHTML = '<div class="mfe-image-picker-loading">Loading images...</div>';

  container.appendChild(header);
  container.appendChild(grid);
  overlay.appendChild(container);

  // Close button handler
  const closeBtn = header.querySelector(".mfe-image-picker-close");
  closeBtn.addEventListener("click", () => {
    closePicker();
  });

  // Close on overlay click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closePicker();
    }
  });

  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePicker();
    }
  };
  document.addEventListener("keydown", handleEscape, true);

  function closePicker() {
    document.removeEventListener("keydown", handleEscape, true);
    overlay.remove();
    if (onClose) onClose();
  }

  function loadImages() {
    // Get page ID from the active editable element
    const pageId = document.querySelector(".fe-editable")?.getAttribute("data-page") || "0";
    
    // Fetch CSRF token first
    return fetchCsrfToken()
      .then((csrf) => {
        const formData = new FormData();
        formData.append("action", "listImages");
        formData.append("pageId", pageId);
        if (csrf) {
          formData.append(csrf.name, csrf.value);
        }

        return fetch(window.MarkdownFrontEditorConfig?.saveUrl || "./", {
          method: "POST",
          body: formData,
          credentials: "same-origin",
        });
      })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data.status) {
          throw new Error(data.message || "Failed to load images");
        }
        renderImages(data.images || []);
      })
      .catch((err) => {
        grid.innerHTML = `<div class="mfe-image-picker-error">Error loading images: ${err.message}</div>`;
      });
  }

  function renderImages(images) {
    if (images.length === 0) {
      grid.innerHTML = '<div class="mfe-image-picker-empty">No images found in source folder</div>';
      return;
    }

    grid.innerHTML = "";
    images.forEach((image) => {
      const item = document.createElement("div");
      item.className = "mfe-image-picker-item";
      item.innerHTML = `
        <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.filename)}" loading="lazy">
        <div class="mfe-image-picker-filename">${escapeHtml(image.filename)}</div>
      `;
      
      item.addEventListener("click", () => {
        if (onSelect) {
          onSelect({
            filename: image.filename,
            url: image.url
          });
        }
        closePicker();
      });

      grid.appendChild(item);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }



  // Append to body and load images
  document.body.appendChild(overlay);
  loadImages();

  return {
    close: closePicker,
  };
}
