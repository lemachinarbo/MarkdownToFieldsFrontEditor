import { fetchCsrfToken } from "./editor-core.js";

/**
 * Image Picker Overlay
 * 
 * Displays available images from the source folder and allows users to select
 * an image to insert into the markdown editor.
 */

export function createImagePicker({ onSelect, onClose, initialData = null }) {
  let selectedImage = initialData ? { 
    filename: initialData.originalFilename || initialData.filename || "",
    url: initialData.src || initialData.url || "" 
  } : null;

  // Internal helper to resolve local filenames to ProcessWire asset paths
  function resolveImageUrl(url) {
    if (!url) return "";
    // If it's already an absolute URL or starts with /, use as-is
    if (url.match(/^(https?:|\/)/)) return url;
    
    // For relative URLs (filenames), try to resolve to page assets
    const pageId = document.querySelector(".fe-editable")?.getAttribute("data-page");
    if (pageId) {
      return `/site/assets/files/${pageId}/${url}`;
    }
    return url;
  }

  // Determine initial tab: if we have a URL that looks remote, start on remote tab
  const isRemote = selectedImage?.url.startsWith("http");
  let activeTab = isRemote ? "remote" : "local";

  const overlay = document.createElement("div");
  overlay.className = "mfe-image-picker-overlay";
  overlay.setAttribute("data-image-picker", "true");

  const container = document.createElement("div");
  container.className = "mfe-image-picker-container";

  const header = document.createElement("div");
  header.className = "mfe-image-picker-header";
  header.innerHTML = `
    <h3>Image Picker</h3>
    <button type="button" class="mfe-image-picker-close" title="Close">×</button>
  `;

  // Tab Switcher
  const tabSwitcher = document.createElement("div");
  tabSwitcher.className = "mfe-picker-tabs";
  tabSwitcher.innerHTML = `
    <button type="button" class="mfe-tab-btn ${activeTab === "local" ? "is-active" : ""}" data-tab="local">Local Gallery</button>
    <button type="button" class="mfe-tab-btn ${activeTab === "remote" ? "is-active" : ""}" data-tab="remote">Remote URL</button>
  `;

  // Selection/Preview Area (Permanent)
  const selectionArea = document.createElement("div");
  selectionArea.className = "mfe-image-picker-selection";
  selectionArea.innerHTML = `
    <div class="mfe-image-selection-preview">
      <div class="mfe-preview-placeholder">${selectedImage ? `<img src="${escapeHtml(resolveImageUrl(selectedImage.url))}" alt="">` : "No image selected"}</div>
    </div>
    <div class="mfe-image-selection-fields">
      <div class="mfe-field-group mfe-remote-url-group ${activeTab === "remote" ? "" : "is-hidden"}">
        <label for="mfe-remote-url">Image URL</label>
        <input type="url" id="mfe-remote-url" placeholder="https://example.com/image.jpg" value="${isRemote ? escapeHtml(selectedImage.url) : ""}">
      </div>
      <div class="mfe-field-group">
        <label for="mfe-image-alt">Alt Text</label>
        <input type="text" id="mfe-image-alt" placeholder="Describe the image..." value="${escapeHtml(initialData?.alt || "")}">
      </div>
      <div class="mfe-selection-info">
        <span class="mfe-selected-filename">${selectedImage && !isRemote ? escapeHtml(selectedImage.filename) : ""}</span>
      </div>
    </div>
  `;

  // Tab Contents
  const tabContent = document.createElement("div");
  tabContent.className = "mfe-picker-tab-content";

  // Local Tab (Grid)
  const grid = document.createElement("div");
  grid.className = `mfe-image-picker-grid ${activeTab === "local" ? "is-visible" : "is-hidden"}`;
  grid.innerHTML = '<div class="mfe-image-picker-loading">Loading gallery...</div>';

  // Remote Tab (Empty)
  const remoteTab = document.createElement("div");
  remoteTab.className = `mfe-remote-tab-info ${activeTab === "remote" ? "is-visible" : "is-hidden"}`;
  remoteTab.innerHTML = "";

  const footer = document.createElement("div");
  footer.className = "mfe-image-picker-footer";
  footer.innerHTML = `
    <button type="button" class="mfe-btn mfe-btn-secondary mfe-picker-cancel">Cancel</button>
    <button type="button" class="mfe-btn mfe-btn-primary mfe-picker-confirm" ${!selectedImage ? "disabled" : ""}>Insert Image</button>
  `;

  container.appendChild(header);
  container.appendChild(tabSwitcher);
  container.appendChild(selectionArea);
  tabContent.appendChild(grid);
  tabContent.appendChild(remoteTab);
  container.appendChild(tabContent);
  container.appendChild(footer);
  overlay.appendChild(container);

  // Tab Switching Logic
  tabSwitcher.querySelectorAll(".mfe-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      activeTab = tab;
      
      tabSwitcher.querySelectorAll(".mfe-tab-btn").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      
      grid.className = `mfe-image-picker-grid ${tab === "local" ? "is-visible" : "is-hidden"}`;
      remoteTab.className = `mfe-remote-tab-info ${tab === "remote" ? "is-visible" : "is-hidden"}`;
      
      // Toggle Remote URL field visibility
      const urlGroup = selectionArea.querySelector(".mfe-remote-url-group");
      if (tab === "remote") {
        urlGroup.classList.remove("is-hidden");
      } else {
        urlGroup.classList.add("is-hidden");
      }
    });
  });

  // Remote URL Change Logic
  const remoteUrlInput = selectionArea.querySelector("#mfe-remote-url");
  remoteUrlInput.addEventListener("input", (e) => {
    const url = e.target.value.trim();
    if (url) {
      selectedImage = { filename: "", url: url };
      updatePreview(url);
      confirmBtn.disabled = false;
      // Clear filename info since it's remote
      selectionArea.querySelector(".mfe-selected-filename").textContent = "";
    } else {
      selectedImage = null;
      updatePreview(null);
      confirmBtn.disabled = true;
    }
  });

  function updatePreview(url) {
    const preview = selectionArea.querySelector(".mfe-preview-placeholder");
    if (url) {
      // Resolve URL for the preview specifically
      preview.innerHTML = `<img src="${escapeHtml(resolveImageUrl(url))}" alt="">`;
    } else {
      preview.innerHTML = "No image selected";
    }
  }

  // Close button handlers
  header.querySelector(".mfe-image-picker-close").addEventListener("click", closePicker);
  footer.querySelector(".mfe-picker-cancel").addEventListener("click", closePicker);

  const confirmBtn = footer.querySelector(".mfe-picker-confirm");
  confirmBtn.addEventListener("click", () => {
    const altInput = selectionArea.querySelector("#mfe-image-alt");
    if (selectedImage && onSelect) {
      onSelect({
        filename: selectedImage.filename, // empty for remote
        url: selectedImage.url,
        alt: altInput.value
      });
    }
    closePicker();
  });

  // Close on overlay click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePicker();
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
    const pageId = document.querySelector(".fe-editable")?.getAttribute("data-page") || "0";
    
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
        if (!data.status) throw new Error(data.message || "Failed to load images");
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
      // Highlight if current image is this filename
      if (selectedImage && selectedImage.filename === image.filename) {
        item.classList.add("is-selected");
      }

      item.innerHTML = `
        <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.filename)}" loading="lazy">
        <div class="mfe-image-picker-filename">${escapeHtml(image.filename)}</div>
      `;
      
      item.addEventListener("click", () => {
        // Update selection
        selectedImage = { filename: image.filename, url: image.url };
        
        // Update UI
        container.querySelectorAll(".mfe-image-picker-item").forEach(i => i.classList.remove("is-selected"));
        item.classList.add("is-selected");
        
        updatePreview(image.url);
        
        const info = selectionArea.querySelector(".mfe-selected-filename");
        info.textContent = image.filename;

        confirmBtn.disabled = false;
      });

      grid.appendChild(item);
    });
  }

  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  document.body.appendChild(overlay);
  loadImages();

  return { close: closePicker };
}
