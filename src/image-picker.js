import { fetchCsrfToken, getSaveUrl } from "./editor-core.js";
import { getImageBaseUrl } from "./editor-shared-helpers.js";
import { openWindow, closeTopWindow } from "./window-manager.js";
import { request, assertOk, getDataOrThrow } from "./network.js";
import { createEventRegistry } from "./event-registry.js";

/**
 * Image Picker Overlay - Revamped UI
 *
 * Displays a fullscreen, minimal split-view layout for selecting images.
 * Left: Sidebar with preview and metadata.
 * Right: Remote URL field and masonry image gallery.
 */

export function createImagePicker({ onSelect, onClose, initialData = null }) {
  const pickerEventRegistry = createEventRegistry();
  const pickerEventScope = pickerEventRegistry.createScope("image-picker");
  let selectedImage = initialData
    ? {
        path: initialData.originalFilename || initialData.path || "",
        filename: initialData.originalFilename || initialData.filename || "",
        url: initialData.src || initialData.url || "",
      }
    : null;

  // Internal helper to resolve local filenames to ProcessWire asset paths
  function resolveImageUrl(url) {
    if (!url) return "";
    if (url.match(/^(https?:|\/)/)) return url;
    return `${getImageBaseUrl()}${url.replace(/^\/+/, "")}`;
  }

  const isRemote = selectedImage?.url.startsWith("http");

  function resolvePageId() {
    const editablePage = document
      .querySelector(".fe-editable[data-page]")
      ?.getAttribute("data-page");
    if (editablePage && editablePage !== "0") return editablePage;

    const anyPageAttr = document
      .querySelector("[data-page]")
      ?.getAttribute("data-page");
    if (anyPageAttr && anyPageAttr !== "0") return anyPageAttr;

    const cfgPage = String(window.MarkdownFrontEditorConfig?.pageId || "0");
    if (cfgPage !== "0") return cfgPage;

    return "0";
  }

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
    onClose: () => {
      pickerEventScope.disposeAll();
      if (typeof onClose === "function") {
        onClose();
      }
    },
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
  remoteInput.oninput = (e) => {
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
  };

  // Insert Action
  addBtn.onclick = async () => {
    const altInput = sidebar.querySelector("#mfe-picker-alt-input");
    if (!selectedImage || !onSelect) return;

    // For local images: require successful ProcessWire resolution to page assets
    const relativePath = selectedImage.path || selectedImage.filename;
    let pwUrl = null;

    if (selectedImage.filename && !selectedImage.url.startsWith("http")) {
      const pageId = resolvePageId();
      const saveUrl = getSaveUrl();

      try {
        const csrf = await fetchCsrfToken();
        const formData = new FormData();
        formData.append("action", "resolveImage");
        formData.append("pageId", pageId);
        formData.append("imagePath", relativePath);
        if (csrf) {
          formData.append(csrf.name, csrf.value);
        }

        const response = await request(saveUrl, {
          method: "POST",
          headers: undefined,
          body: formData,
          parse: "json",
        });
        const result = response.data;

        if (result.status === 1 && result.url) {
          pwUrl = result.url;
        } else {
          console.error("Image resolve failed:", result);
          return;
        }
      } catch (err) {
        console.error("Image resolution error:", err);
        return;
      }
    }

    const displayUrl = pwUrl || selectedImage.url;
    if (!displayUrl) {
      return;
    }

    onSelect({
      filename: relativePath,
      url: displayUrl,
      alt: altInput.value,
    });

    closeTopWindow();
  };

  function loadImages() {
    const pageId = resolvePageId();
    const grid = gallerySection.querySelector(".mfe-picker-gallery-grid");
    const saveUrl = getSaveUrl();

    return fetchCsrfToken()
      .then((csrf) => {
        const formData = new FormData();
        formData.append("action", "listImages");
        formData.append("pageId", pageId);
        if (csrf) formData.append(csrf.name, csrf.value);

        return request(saveUrl, {
          method: "POST",
          headers: undefined,
          body: formData,
          parse: "json",
        });
      })
      .then((result) => {
        const data = getDataOrThrow(assertOk(result));
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

      // Create aspect ratio wrapper for stable layout during image load
      const wrapper = document.createElement("div");
      wrapper.className = "mfe-gallery-item-wrapper";

      // Calculate padding-top based on aspect ratio if dimensions available
      if (image.width && image.height) {
        const aspectRatioPct = (image.height / image.width) * 100;
        wrapper.style.paddingTop = aspectRatioPct + "%";
      } else {
        // Fallback if dimensions unavailable
        wrapper.style.paddingTop = "66.67%";
      }

      const img = document.createElement("img");
      if (image.thumbUrl) {
        // Cached thumb exists - use it
        img.src = image.thumbUrl;
      } else if (image.thumbPending) {
        // Has hash but thumb missing - show placeholder, wait for SSE
        img.style.backgroundColor = "#e8e8e8";
        img.dataset.thumbName = image.thumbName;
        img.dataset.imagePath = image.fullPath || image.path;
        img.dataset.hash = image.hash || "";
        img.dataset.relativePath = image.path || "";
        pendingThumbs.push(img);
      } else if (image.requestThumb) {
        // No hash yet - show placeholder, generate thumb in background
        img.style.backgroundColor = "#e8e8e8";
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

      wrapper.appendChild(img);
      item.appendChild(wrapper);

      item.onclick = () => {
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
      };

      grid.appendChild(item);
    });

    if (pendingThumbs.length > 0 || requestThumbs.length > 0) {
      generateThumbs([...pendingThumbs, ...requestThumbs]);
    }
  }

  function generateThumbs(pendingImgs) {
    const saveUrl = getSaveUrl();
    const debug = !!window.MarkdownFrontEditorConfig?.debug;
    const pageId = resolvePageId();

    function buildActionUrl(action, extraParams = {}) {
      const [base, query = ""] = String(saveUrl).split("?");
      const params = new URLSearchParams(query);
      params.set("action", action);
      Object.entries(extraParams).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        params.set(key, String(value));
      });
      const qs = params.toString();
      return qs ? `${base || ""}?${qs}` : base || saveUrl;
    }

    const visualOrdered = [...pendingImgs].sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const topDelta = rectA.top - rectB.top;
      if (Math.abs(topDelta) > 4) return topDelta;
      return rectA.left - rectB.left;
    });

    const withHash = visualOrdered.filter((img) => img.dataset.hash);
    const withoutHash = visualOrdered.filter((img) => !img.dataset.hash);

    // Start SSE for images with known hashes
    if (withHash.length > 0) {
      const thumbNames = withHash
        .map((img) => img.dataset.thumbName)
        .filter(Boolean);
      if (thumbNames.length > 0) {
        const sseUrl = buildActionUrl("thumbStream", {
          thumbs: thumbNames.join(","),
        });
        const eventSource = new EventSource(sseUrl);

        pickerEventScope.register(eventSource, "ready", (e) => {
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

        pickerEventScope.register(eventSource, "done", () => {
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
    const maxConcurrent = 2;

    fetchCsrfToken().then((csrf) => {
      let nextIndex = 0;

      const runOne = async () => {
        while (nextIndex < orderedImgs.length) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          const img = orderedImgs[currentIndex];
          const hasHash = !!img.dataset.hash;

          const formData = new FormData();
          formData.append("action", "generateThumb");
          formData.append("pageId", pageId);
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

          try {
            const res = await request(saveUrl, {
              method: "POST",
              headers: undefined,
              body: formData,
              parse: "text",
            });

            const raw = typeof res.data === "string" ? res.data : "";
            let data = null;

            if (raw) {
              try {
                data = JSON.parse(raw);
              } catch (parseErr) {
                throw new Error(
                  `[${res.status}] Invalid JSON response: ${raw.slice(0, 240)}`,
                );
              }
            }

            if (!res.ok) {
              const message =
                (data && data.message) ||
                (data && data.error) ||
                raw ||
                `HTTP ${res.status}`;
              throw new Error(message);
            }

            if (!data) {
              throw new Error(`Empty response (HTTP ${res.status})`);
            }

            // Handle SVG skip - use original URL
            if (data.status === "skip" && data.reason === "svg") {
              continue;
            }

            // Images with hash are updated via SSE; without hash update immediately
            if (!hasHash && data.thumbUrl) {
              img.src = data.thumbUrl;
            }
          } catch (err) {
            if (debug) console.error("[MFE] Thumb generation failed:", err);
          }
        }
      };

      const workerCount = Math.min(maxConcurrent, orderedImgs.length);
      for (let i = 0; i < workerCount; i += 1) {
        runOne();
      }
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
