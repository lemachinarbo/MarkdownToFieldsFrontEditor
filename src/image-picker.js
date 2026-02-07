import { fetchCsrfToken } from "./editor-core.js";
import { openWindow, closeTopWindow } from "./window-manager.js";

/**
 * Image Picker Overlay - Revamped UI
 *
 * Displays a fullscreen, minimal split-view layout for selecting images.
 * Left: Sidebar with preview and metadata.
 * Right: Remote URL field and masonry image gallery.
 */

export function createImagePicker({ onSelect, onClose, initialData = null }) {
  let selectedImage = initialData
    ? {
        filename: initialData.originalFilename || initialData.filename || "",
        url: initialData.src || initialData.url || "",
      }
    : null;

  // Internal helper to resolve local filenames to ProcessWire asset paths
  function resolveImageUrl(url) {
    if (!url) return "";
    if (url.match(/^(https?:|\/)/)) return url;

    // For relative URLs (filenames), try to resolve to page assets
    const pageId = document
      .querySelector(".fe-editable")
      ?.getAttribute("data-page");
    if (pageId) {
      return `/site/assets/files/${pageId}/${url}`;
    }
    return url;
  }

  const isRemote = selectedImage?.url.startsWith("http");

  // Create the main container that will be passed to openWindow
  const container = document.createElement("div");
  container.className = "mfe-image-picker-container";

  // --- LEFT COLUMN: SIDEBAR ---
  const sidebar = document.createElement("div");
  sidebar.className = "mfe-picker-sidebar";

  const previewArea = document.createElement("div");
  previewArea.className = "mfe-picker-preview-wrapper";

  const placeholder = document.createElement("div");
  placeholder.className = "mfe-picker-preview-placeholder";
  placeholder.innerHTML = selectedImage
    ? `<img src="${escapeHtml(resolveImageUrl(selectedImage.url))}" alt="">`
    : "No image selected";
  previewArea.appendChild(placeholder);

  const metadata = document.createElement("div");
  metadata.className = "mfe-picker-metadata";

  const filenameLabel = document.createElement("div");
  filenameLabel.className = "mfe-picker-filename-label";
  filenameLabel.textContent =
    selectedImage && !isRemote ? `image: ${selectedImage.filename}` : "";

  const altGroup = document.createElement("div");
  altGroup.className = "mfe-picker-field-group";
  altGroup.innerHTML = `
    <label>Alt name:</label>
    <input type="text" id="mfe-picker-alt-input" value="${escapeHtml(initialData?.alt || "")}" placeholder="Describe the image...">
  `;

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "mfe-picker-insert-btn";
  addBtn.textContent = "Add image";
  addBtn.disabled = !selectedImage;

  metadata.append(filenameLabel, altGroup, addBtn);
  sidebar.append(previewArea, metadata);

  // --- RIGHT COLUMN: GALLERY PANE ---
  const galleryPane = document.createElement("div");
  galleryPane.className = "mfe-picker-gallery-pane";

  const remoteSection = document.createElement("div");
  remoteSection.className = "mfe-picker-remote-section";
  remoteSection.innerHTML = `
    <label>Select a remote image</label>
    <input type="url" id="mfe-picker-remote-input" placeholder="http://" value="${isRemote ? escapeHtml(selectedImage.url) : ""}">
    <div class="mfe-picker-separator-text">
      <span>OR</span>
    </div>
  `;

  const gallerySection = document.createElement("div");
  gallerySection.className = "mfe-picker-gallery-section";
  gallerySection.innerHTML = `
    <label>Pick from the gallery</label>
    <div class="mfe-picker-gallery-grid">
      <div class="mfe-picker-loading">Loading images...</div>
    </div>
  `;

  galleryPane.append(remoteSection, gallerySection);
  container.append(sidebar, galleryPane);

  // Open the window
  const win = openWindow({
    id: "mfe-image-picker",
    content: container,
    onClose: onClose,
    showMenuBar: true,
    menuBarDisabled: true,
    breadcrumbLabel: "Image Picker",
    className: "mfe-image-picker-window",
    background: "white",
  });

  // --- LOGIC ---

  function updatePreview(url) {
    if (url) {
      placeholder.innerHTML = `<img src="${escapeHtml(resolveImageUrl(url))}" alt="">`;
    } else {
      placeholder.innerHTML = "No image selected";
    }
  }

  // Remote URL Change
  const remoteInput = remoteSection.querySelector("#mfe-picker-remote-input");
  remoteInput.addEventListener("input", (e) => {
    const url = e.target.value.trim();
    if (url) {
      selectedImage = { filename: "", url: url };
      updatePreview(url);
      filenameLabel.textContent = "";
      addBtn.disabled = false;
      // Deselect gallery items
      gallerySection
        .querySelectorAll(".mfe-gallery-item")
        .forEach((i) => i.classList.remove("is-selected"));
    } else {
      selectedImage = null;
      updatePreview(null);
      addBtn.disabled = true;
    }
  });

  // Insert Action
  addBtn.addEventListener("click", () => {
    const altInput = sidebar.querySelector("#mfe-picker-alt-input");
    if (selectedImage && onSelect) {
      onSelect({
        filename: selectedImage.filename,
        url: selectedImage.url,
        alt: altInput.value,
      });
    }
    closeTopWindow();
  });

  function loadImages() {
    const pageId =
      document.querySelector(".fe-editable")?.getAttribute("data-page") || "0";
    const grid = gallerySection.querySelector(".mfe-picker-gallery-grid");

    return fetchCsrfToken()
      .then((csrf) => {
        const formData = new FormData();
        formData.append("action", "listImages");
        formData.append("pageId", pageId);
        if (csrf) formData.append(csrf.name, csrf.value);

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
        if (!data.status)
          throw new Error(data.message || "Failed to load images");
        renderImages(data.images || []);
      })
      .catch((err) => {
        grid.innerHTML = `<div class="mfe-picker-error">Error: ${err.message}</div>`;
      });
  }

  function renderImages(images) {
    const grid = gallerySection.querySelector(".mfe-picker-gallery-grid");
    if (images.length === 0) {
      grid.innerHTML = '<div class="mfe-picker-empty">No images found.</div>';
      return;
    }

    grid.innerHTML = "";
    images.forEach((image) => {
      const item = document.createElement("div");
      item.className = "mfe-gallery-item";
      if (selectedImage && selectedImage.filename === image.filename) {
        item.classList.add("is-selected");
      }

      const img = document.createElement("img");
      img.src = image.url;
      img.alt = image.filename;
      img.loading = "lazy";

      item.appendChild(img);

      item.addEventListener("click", () => {
        selectedImage = { filename: image.filename, url: image.url };

        gallerySection
          .querySelectorAll(".mfe-gallery-item")
          .forEach((i) => i.classList.remove("is-selected"));
        item.classList.add("is-selected");

        updatePreview(image.url);
        filenameLabel.textContent = `image: ${image.filename}`;
        remoteInput.value = ""; // Clear remote input on gallery selection
        addBtn.disabled = false;
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

  loadImages();

  return win;
}
