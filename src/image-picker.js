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
        path: initialData.originalFilename || initialData.path || "",
        filename: initialData.originalFilename || initialData.filename || "",
        url: initialData.src || initialData.url || "",
      }
    : null;

  function getImageBaseUrl() {
    const fromConfig = window.MarkdownFrontEditorConfig?.imageBaseUrl;
    const base =
      typeof fromConfig === "string" && fromConfig.trim() !== ""
        ? fromConfig
        : "/";
    return base.endsWith("/") ? base : `${base}/`;
  }

  // Internal helper to resolve local filenames to ProcessWire asset paths
  function resolveImageUrl(url) {
    if (!url) return "";
    if (url.match(/^(https?:|\/)/)) return url;
    return `${getImageBaseUrl()}${url.replace(/^\/+/, "")}`;
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
  addBtn.addEventListener("click", async () => {
    const altInput = sidebar.querySelector("#mfe-picker-alt-input");
    if (!selectedImage || !onSelect) return;

    // For local images: ensure file exists in PW assets, but store RELATIVE path in markdown
    const relativePath = selectedImage.path || selectedImage.filename;
    let resolveWarning = null;
    let pwUrl = null; // PW URL for display (if resolution succeeds)

    if (selectedImage.filename && !selectedImage.url.startsWith("http")) {
      const pageId =
        document.querySelector(".fe-editable")?.getAttribute("data-page") ||
        "0";
      const saveUrl = window.MarkdownFrontEditorConfig?.saveUrl || "./";

      try {
        const csrf = await fetchCsrfToken();
        const formData = new FormData();
        formData.append("action", "resolveImage");
        formData.append("pageId", pageId);
        formData.append("imagePath", relativePath);
        if (csrf) {
          formData.append(csrf.name, csrf.value);
        }

        const response = await fetch(saveUrl, {
          method: "POST",
          body: formData,
          credentials: "same-origin",
        });
        const result = await response.json();

        if (result.status === 1 && result.url) {
          // Success: use PW URL for display
          pwUrl = result.url;
        } else {
          resolveWarning =
            "Image may not preview correctly (processing deferred to render)";
          console.warn("Image resolve deferred:", result);
        }
      } catch (err) {
        resolveWarning = "Image processing failed (will retry at render time)";
        console.warn("Image resolution error:", err);
      }
    }

    // Pass both pieces of information:
    // - url: PW URL for display (or fallback to relative if failed)
    // - filename: relative path for markdown serialization
    const displayUrl = pwUrl || relativePath;

    onSelect({
      filename: relativePath,
      url: displayUrl, // PW URL for display (relative as fallback)
      alt: altInput.value,
      _resolveWarning: resolveWarning, // Soft warning for UI feedback
    });

    closeTopWindow();
  });

  function loadImages() {
    const pageId =
      document.querySelector(".fe-editable")?.getAttribute("data-page") || "0";
    const grid = gallerySection.querySelector(".mfe-picker-gallery-grid");
    const saveUrl = window.MarkdownFrontEditorConfig?.saveUrl || "./";

    return fetchCsrfToken()
      .then((csrf) => {
        const formData = new FormData();
        formData.append("action", "listImages");
        formData.append("pageId", pageId);
        if (csrf) formData.append(csrf.name, csrf.value);

        return fetch(saveUrl, {
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
    const pendingThumbs = [];
    const requestThumbs = [];

    images.forEach((image) => {
      const item = document.createElement("div");
      item.className = "mfe-gallery-item";
      if (
        selectedImage &&
        (selectedImage.path === image.path ||
          selectedImage.filename === image.filename)
      ) {
        item.classList.add("is-selected");
      }

      const img = document.createElement("img");
      if (image.thumbUrl) {
        // Cached thumb exists - use it
        img.src = image.thumbUrl;
      } else if (image.thumbPending) {
        // Has hash but thumb missing - show placeholder, wait for SSE
        img.src =
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect fill='%23f0f0f0' width='300' height='300'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23999' font-size='14'%3ELoading...%3C/text%3E%3C/svg%3E";
        img.dataset.thumbName = image.thumbName;
        img.dataset.imagePath = image.fullPath || image.path;
        img.dataset.hash = image.hash || "";
        img.dataset.relativePath = image.path || "";
        pendingThumbs.push(img);
      } else if (image.requestThumb) {
        // No hash yet - show placeholder, generate thumb in background
        img.src =
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect fill='%23f0f0f0' width='300' height='300'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23999' font-size='14'%3ELoading...%3C/text%3E%3C/svg%3E";
        img.dataset.imagePath = image.fullPath || image.path;
        img.dataset.hash = "";
        img.dataset.relativePath = image.path || "";
        requestThumbs.push(img);
      } else {
        // Use full URL directly (only for SVG or unsupported formats)
        img.src = image.url;
      }
      img.alt = image.filename;
      img.loading = "lazy";

      item.appendChild(img);

      item.addEventListener("click", () => {
        selectedImage = {
          filename: image.filename,
          path: image.path || image.filename,
          url: image.url,
        };

        gallerySection
          .querySelectorAll(".mfe-gallery-item")
          .forEach((i) => i.classList.remove("is-selected"));
        item.classList.add("is-selected");

        updatePreview(image.url);
        filenameLabel.textContent = `image: ${image.path || image.filename}`;
        remoteInput.value = ""; // Clear remote input on gallery selection
        addBtn.disabled = false;
      });

      grid.appendChild(item);
    });

    if (pendingThumbs.length > 0 || requestThumbs.length > 0) {
      generateThumbs([...pendingThumbs, ...requestThumbs]);
    }
  }

  function generateThumbs(pendingImgs) {
    const saveUrl = window.MarkdownFrontEditorConfig?.saveUrl || "./";
    const debug = !!window.MarkdownFrontEditorConfig?.debug;

    const withHash = pendingImgs.filter((img) => img.dataset.hash);
    const withoutHash = pendingImgs.filter((img) => !img.dataset.hash);

    // Start SSE for images with known hashes
    if (withHash.length > 0) {
      const thumbNames = withHash
        .map((img) => img.dataset.thumbName)
        .filter(Boolean);
      if (thumbNames.length > 0) {
        const sseUrl = `${saveUrl}?action=thumbStream&thumbs=${encodeURIComponent(thumbNames.join(","))}`;
        const eventSource = new EventSource(sseUrl);

        eventSource.addEventListener("ready", (e) => {
          try {
            const data = JSON.parse(e.data);
            const img = withHash.find(
              (i) => i.dataset.thumbName === data.thumbName,
            );
            if (img) {
              img.src = data.thumbUrl;
            }
          } catch (err) {
            if (debug) console.error("[MFE] SSE parse error:", err);
          }
        });

        eventSource.addEventListener("done", () => {
          eventSource.close();
        });

        eventSource.onerror = (err) => {
          if (debug) console.error("[MFE] SSE error:", err);
          eventSource.close();
        };
      }
    }

    // Generate thumbs: withHash first (while SSE is listening), then withoutHash
    const orderedImgs = [...withHash, ...withoutHash];
    orderedImgs.forEach((img) => {
      const hasHash = !!img.dataset.hash;

      fetchCsrfToken().then((csrf) => {
        const formData = new FormData();
        formData.append("action", "generateThumb");
        formData.append("imagePath", img.dataset.imagePath);
        if (img.dataset.relativePath) {
          formData.append("relativePath", img.dataset.relativePath);
        }
        if (img.dataset.hash) {
          formData.append("hash", img.dataset.hash);
        }
        if (csrf) {
          formData.append(csrf.name, csrf.value);
        }

        fetch(saveUrl, {
          method: "POST",
          body: formData,
          credentials: "same-origin",
        })
          .then((res) => res.json())
          .then((data) => {
            // Handle SVG skip - use original URL
            if (data.status === "skip" && data.reason === "svg") {
              // SVG files don't get thumbs, already showing full URL
              return;
            }

            // Update image src if thumb was created (for images without hash)
            // Images with hash are updated via SSE
            if (!hasHash && data.thumbUrl) {
              img.src = data.thumbUrl;
            }
          })
          .catch((err) => {
            if (debug) console.error("[MFE] Thumb generation failed:", err);
          });
      });
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
