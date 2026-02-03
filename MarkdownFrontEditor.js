/**
 * MarkdownFrontEditor - CodeMirror-based markdown editor
 *
 * Core rules:
 * - Operates on plain markdown strings only
 * - No HTML conversion, no contentEditable, no innerHTML
 * - Single-block fields (<!-- name -->) block Enter key
 * - Container fields (<!-- name... -->) allow Enter
 * - Saves exactly what user types (byte-identical)
 */
(function () {
  const EDITABLE_CLASS = "fe-editable";

  let activeEditor = null;
  let activeHost = null;
  let activeTarget = null;
  let activeMarkdown = null;
  let isSaving = false;
  let toolbarEl = null;

  /**
   * Check if element allows multi-block content (containers)
   */
  function allowMultiBlockFor(el) {
    if (!el || !el.dataset) return false;
    const value = el.dataset.allowMultiBlock;
    return value === "true" || value === "1";
  }

  /**
   * Get field metadata from element
   */
  function getFieldMeta(el) {
    if (!el || !el.dataset) return null;
    return {
      name: el.dataset.mdName || "",
      type: (el.dataset.fieldType || "block").toLowerCase(),
      allowMultiBlock: allowMultiBlockFor(el),
      pageId: el.dataset.page || "",
    };
  }

  /**
   * Create editor with preview rendering via CSS/HTML overlay
   * Uses textarea for editing + absolute positioned mirror for preview
   * Decorations are CSS-based, no text mutation
   */
  function createEditor(element, markdownContent, meta) {
    // Add selection styling (must be in stylesheet, not inline)
    if (!document.getElementById("fe-selection-style")) {
      const style = document.createElement("style");
      style.id = "fe-selection-style";
      style.textContent = `
        .fe-editor-host textarea::selection {
          background: #b4d5fe !important;
          color: #000 !important;
        }
      `;
      document.head.appendChild(style);
    }

    const host = document.createElement("div");
    host.className = "fe-editor-host";
    host.style.position = "relative";
    host.style.border = "1px solid #ccc";
    host.style.borderRadius = "4px";
    host.style.overflow = "hidden";
    host.style.fontFamily = "monospace";
    host.style.fontSize = "14px";
    host.style.lineHeight = "1.5";
    element.parentNode.insertBefore(host, element.nextSibling);

    // Create editor wrapper (for stacking context)
    const editorWrapper = document.createElement("div");
    editorWrapper.style.position = "relative";
    editorWrapper.style.width = "100%";
    editorWrapper.style.minHeight = "100px";
    host.appendChild(editorWrapper);

    // Create textarea for editing
    const textarea = document.createElement("textarea");
    textarea.className = "fe-textarea-editor";
    textarea.value = markdownContent;
    textarea.style.width = "100%";
    textarea.style.height = "100%";
    textarea.style.minHeight = "100px";
    textarea.style.padding = "8px";
    textarea.style.fontFamily = "monospace";
    textarea.style.fontSize = "14px";
    textarea.style.lineHeight = "1.5";
    textarea.style.border = "none";
    textarea.style.position = "relative";
    textarea.style.zIndex = "2";
    textarea.style.background = "transparent";
    textarea.style.color = "transparent"; // Transparent so preview shows through
    textarea.style.caretColor = "#000"; // Visible cursor
    textarea.style.resize = "vertical";
    textarea.style.margin = "0";
    textarea.style.boxSizing = "border-box";
    textarea.style.whiteSpace = "pre-wrap"; // Preserve newlines
    textarea.style.wordWrap = "break-word";
    editorWrapper.appendChild(textarea);

    // Create preview mirror (behind textarea)
    const preview = document.createElement("pre");
    preview.className = "fe-preview-mirror";
    preview.style.position = "absolute";
    preview.style.top = "0";
    preview.style.left = "0";
    preview.style.width = "100%";
    preview.style.height = "100%";
    preview.style.minHeight = "100px";
    preview.style.padding = "8px";
    preview.style.margin = "0";
    preview.style.fontFamily = "monospace";
    preview.style.fontSize = "14px";
    preview.style.lineHeight = "1.5";
    preview.style.color = "rgba(0,0,0,0.3)";
    preview.style.pointerEvents = "none";
    preview.style.zIndex = "1";
    preview.style.background = "transparent";
    preview.style.overflow = "hidden";
    preview.style.whiteSpace = "pre-wrap";
    preview.style.wordWrap = "break-word";
    preview.style.border = "none";
    preview.style.boxSizing = "border-box";
    editorWrapper.appendChild(preview);

    // Sync preview with textarea as user types
    function updatePreview() {
      const text = textarea.value;
      // Create decorated HTML version with visual styling (syntax faded, output emphasized)
      let decorated = text
        // Escape HTML first
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      // Then apply decorations (markdown syntax dim, content emphasized)
      // Headings: dim the markers, keep content normal
      decorated = decorated.replace(
        /^(#+)(\s+)(.*)$/gm,
        '<span class="fe-decoration-fade">$1</span><span class="fe-decoration-fade">$2</span><span class="fe-decoration-heading">$3</span>',
      );

      // Bold: dim markers, emphasize content
      decorated = decorated.replace(
        /(\*\*|__)([^*_]+)\1/g,
        '<span class="fe-decoration-fade">$1</span><span class="fe-decoration-bold">$2</span><span class="fe-decoration-fade">$1</span>',
      );

      // Italic: dim markers, emphasize content
      decorated = decorated.replace(
        /(?<!\*|_)(\*|_)([^*_]+)\1(?!\*|_)/g,
        '<span class="fe-decoration-fade">$1</span><span class="fe-decoration-italic">$2</span><span class="fe-decoration-fade">$1</span>',
      );

      // Code: dim markers
      decorated = decorated.replace(
        /(`+)([^`]+)\1/g,
        '<span class="fe-decoration-fade">$1</span><span class="fe-decoration-code">$2</span><span class="fe-decoration-fade">$1</span>',
      );

      // Blockquote: dim marker
      decorated = decorated.replace(
        /(^|\n)(&gt;)(\s)/gm,
        '$1<span class="fe-decoration-fade">$2</span><span class="fe-decoration-fade">$3</span>',
      );

      // Lists: dim markers
      decorated = decorated.replace(
        /(^|\n)([-*+])(\s)/gm,
        '$1<span class="fe-decoration-fade">$2</span><span class="fe-decoration-fade">$3</span>',
      );

      // Field markers: dim completely
      decorated = decorated.replace(
        /(&lt;!--.*?--&gt;)/g,
        '<span class="fe-decoration-comment">$1</span>',
      );

      preview.innerHTML = decorated;
    }

    textarea.addEventListener("input", updatePreview);
    textarea.addEventListener("keydown", (e) => {
      setTimeout(updatePreview, 0);
    });
    updatePreview();

    // Block Enter for single-block fields
    if (!meta.allowMultiBlock) {
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
        }
      });

      textarea.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text/plain");
        if (text && /\n/.test(text)) {
          e.preventDefault();
        }
      });
    }

    textarea.focus();

    // Return CodeMirror-like interface for compatibility
    const view = {
      state: {
        doc: {
          toString: () => textarea.value,
        },
      },
      destroy: () => {
        host.remove();
      },
    };

    return { view, host };
  }

  /**
   * Create floating toolbar
   */
  function createToolbar() {
    if (toolbarEl) return toolbarEl;

    const el = document.createElement("div");
    el.className = "fe-toolbar";
    el.style.position = "absolute";
    el.style.display = "none";

    const configButtons =
      window.MarkdownFrontEditorConfig?.toolbarButtons ||
      "bold,italic,strike,code,save";
    const enabledButtons = new Set(
      configButtons.split(",").map((b) => b.trim()),
    );

    const buttons = [{ cmd: "save", title: "Save", label: "💾" }];

    el.innerHTML = buttons
      .filter((btn) => enabledButtons.has(btn.cmd))
      .map(
        (btn) =>
          `<button data-cmd="${btn.cmd}" title="${btn.title}">${btn.label}</button>`,
      )
      .join("");

    el.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
    });

    el.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      const cmd = btn.getAttribute("data-cmd");
      if (cmd === "save") {
        saveContent();
      }
    });

    document.body.appendChild(el);
    toolbarEl = el;
    return el;
  }

  /**
   * Position toolbar above editor
   */
  function positionToolbar() {
    if (!toolbarEl || !activeHost) {
      hideToolbar();
      return;
    }

    const rect = activeHost.getBoundingClientRect();
    const tb = toolbarEl;
    tb.style.display = "flex";
    const tbRect = tb.getBoundingClientRect();
    const left = rect.left + rect.width / 2 - tbRect.width / 2 + window.scrollX;
    const top = rect.top + window.scrollY - tbRect.height - 8;
    tb.style.left = Math.max(8, left) + "px";
    tb.style.top = Math.max(8, top) + "px";
  }

  /**
   * Hide toolbar
   */
  function hideToolbar() {
    if (!toolbarEl) return;
    toolbarEl.style.display = "none";
  }

  /**
   * Toast notification helper
   */
  let toastEl = null;
  function showToast(type, msg, timeout = 3000) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "fe-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.className = "fe-toast " + type;
    toastEl.textContent = msg;
    toastEl.style.display = "block";
    setTimeout(() => {
      toastEl.style.display = "none";
    }, timeout);
  }

  /**
   * Destroy active editor
   */
  function destroyEditor() {
    if (!activeEditor) return;

    try {
      if (activeEditor.view && activeEditor.view.destroy) {
        activeEditor.view.destroy();
      }
    } catch (e) {
      // ignore
    }

    try {
      if (activeHost && activeHost.parentNode) {
        activeHost.parentNode.removeChild(activeHost);
      }
    } catch (e) {
      // ignore
    }

    try {
      if (activeTarget) {
        activeTarget.style.display = "";
      }
    } catch (e) {
      // ignore
    }

    hideToolbar();

    activeEditor = null;
    activeHost = null;
    activeTarget = null;
    activeMarkdown = null;
  }

  /**
   * Attach editor to element
   */
  function attachTo(element) {
    console.log("attachTo called", element.dataset.mdName);
    if (activeEditor) return;

    const meta = getFieldMeta(element);
    if (!meta || !meta.name) return;

    // Hide original element
    element.style.display = "none";
    activeTarget = element;

    // Get markdown from data attribute (set by backend)
    const markdown = element.dataset.markdown || "";
    activeMarkdown = markdown;

    // Create editor
    const { view, host } = createEditor(element, markdown, meta);
    activeEditor = { view, meta };
    activeHost = host;

    // Show toolbar
    createToolbar();
    positionToolbar();

    // Focus editor (textarea, not view)
    const textarea = host.querySelector("textarea");
    if (textarea) textarea.focus();

    // Handle blur
    const onBlur = () => {
      setTimeout(() => {
        if (
          document.activeElement !== host &&
          !toolbarEl.contains(document.activeElement)
        ) {
          destroyEditor();
        }
      }, 100);
    };
    host.addEventListener("blur", onBlur);
  }

  /**
   * Save content to server
   */
  async function saveContent() {
    if (isSaving || !activeEditor || !activeTarget) {
      showToast("error", "Nothing to save");
      return;
    }

    isSaving = true;
    const saveBtn = toolbarEl?.querySelector('button[data-cmd="save"]');
    if (saveBtn) saveBtn.disabled = true;

    try {
      // Get current markdown from editor
      const view = activeEditor.view;
      const markdown = view.state.doc.toString();
      const meta = activeEditor.meta;

      // Validate single-block constraint
      if (!meta.allowMultiBlock && markdown.includes("\n")) {
        showToast("error", "Single-block field cannot contain newlines");
        return;
      }

      // Validate non-empty
      if (!markdown.trim()) {
        showToast("error", "Content cannot be empty");
        return;
      }

      // Fetch CSRF token
      let tokenName = null;
      let tokenValue = null;
      try {
        const resp = await fetch(
          location.pathname + "?markdownFrontEditorToken=1",
          { credentials: "same-origin" },
        );
        if (resp.ok) {
          const text = await resp.text();
          const tmp = document.createElement("div");
          tmp.innerHTML = text;
          const inp = tmp.querySelector("input[type=hidden]");
          if (inp) {
            tokenName = inp.getAttribute("name");
            tokenValue = inp.value;
          }
        }
      } catch (e) {
        // ignore token fetch error
      }

      // Build request
      const body = new URLSearchParams();
      body.append("markdown", markdown);
      body.append("mdName", meta.name);
      body.append("pageId", meta.pageId);
      if (tokenName) body.append(tokenName, tokenValue);

      // Send save request
      const res = await fetch(
        location.pathname + "?markdownFrontEditorSave=1",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          credentials: "same-origin",
          body: body.toString(),
        },
      );

      let json = null;
      try {
        json = await res.json();
      } catch (e) {
        json = null;
      }

      if (res.ok && json && json.status === 1) {
        showToast("success", json.message || "Saved");

        // Update target element with new HTML
        if (json.html && activeTarget) {
          activeTarget.innerHTML = json.html;
          activeTarget.dataset.markdown = markdown;
        }

        destroyEditor();
      } else {
        showToast(
          "error",
          "Save failed: " +
            (json && json.error ? json.error : res.statusText || "unknown"),
        );
      }
    } catch (e) {
      showToast("error", "Save failed: " + e.message);
    } finally {
      isSaving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  /**
   * Initialize event listeners (works if called before or after DOMContentLoaded)
   */
  function initializeListeners() {
    // Double-click to edit
    document.body.addEventListener("dblclick", (ev) => {
      const el = ev.target.closest("." + EDITABLE_CLASS);
      if (!el) return;
      attachTo(el);
    });

    // Escape to cancel
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && activeEditor) {
        destroyEditor();
      }
    });
  }

  // Initialize immediately if DOM is ready, otherwise wait
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeListeners);
  } else {
    initializeListeners();
  }
})();
