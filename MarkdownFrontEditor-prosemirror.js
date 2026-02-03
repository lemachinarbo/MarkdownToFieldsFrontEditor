/**
 * MarkdownFrontEditor - ProseMirror Markdown Edition
 * Based on official ProseMirror Markdown example: https://prosemirror.net/examples/markdown/
 *
 * Core principles:
 * 1. Markdown is the canonical state (parse on load, serialize on save)
 * 2. Uses ProseMirror markdown schema, parser, and serializer
 * 3. Preserves everything the user typed (byte-identical round trip)
 * 4. WYSIWYG editing experience (headings render as headings, lists as lists, etc.)
 * 5. Respects field semantics (single-block vs multi-line from MarkdownToFields)
 */

(async function () {
  // Wait for ProseMirror libraries to load from CDN
  await waitForProseMirror();

  const EDITABLE_CLASS = "fe-editable";

  // Extract ProseMirror modules from window (loaded via CDN)
  const { EditorState } = window.PM.state;
  const { EditorView } = window.PM.view;
  const { schema, defaultMarkdownParser, defaultMarkdownSerializer } =
    window.PM.markdown;
  const { exampleSetup } = window.PM.exampleSetup;
  const { keymap } = window.PM.keymap;

  let activeEditor = null;
  let activeHost = null;
  let activeTarget = null;
  let activeMarkdown = null;
  let isSaving = false;
  let toolbarEl = null;

  /**
   * Wait for ProseMirror libraries to be loaded from CDN
   */
  function waitForProseMirror() {
    return new Promise((resolve) => {
      const check = () => {
        if (
          window.PM &&
          window.PM.state &&
          window.PM.view &&
          window.PM.markdown &&
          window.PM.exampleSetup &&
          window.PM.keymap
        ) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /**
   * Check if field allows multi-block content
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
   * Create ProseMirror editor
   * Parses markdown into ProseMirror document on load
   * Serializes back to markdown on save
   */
  function createEditor(element, markdownContent, meta) {
    const host = document.createElement("div");
    host.className = "fe-editor-host";
    host.style.position = "relative";
    host.style.border = "1px solid #ccc";
    host.style.borderRadius = "4px";
    host.style.background = "#fff";
    host.style.padding = "8px";
    host.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    host.style.fontSize = "14px";
    host.style.lineHeight = "1.6";
    element.parentNode.insertBefore(host, element.nextSibling);

    // Parse markdown to ProseMirror document
    const doc = defaultMarkdownParser.parse(markdownContent || "");

    // Custom keymap for Enter key (block if single-block field)
    const customKeymap = {};
    if (!meta.allowMultiBlock) {
      // Block Enter key in single-block fields
      customKeymap["Enter"] = () => true; // Return true to prevent default
      customKeymap["Shift-Enter"] = () => true;
      customKeymap["Ctrl-Enter"] = () => true;
    }

    // Create editor state with markdown document
    const state = EditorState.create({
      doc,
      plugins: [
        ...exampleSetup({ schema }),
        keymap(customKeymap), // Add our custom keymap last to override
      ],
    });

    // Create editor view
    const view = new EditorView(host, {
      state,
      // Handle paste events
      handlePaste(view, event, slice) {
        if (!meta.allowMultiBlock) {
          // In single-block fields, reject multi-line pastes
          const text = event.clipboardData?.getData("text/plain") || "";
          if (text.includes("\n")) {
            console.log("Multi-line paste blocked in single-block field");
            event.preventDefault();
            return true; // Handled
          }
        }
        return false; // Let ProseMirror handle it
      },
    });

    return { view, host };
  }

  /**
   * Save content to server
   */
  function saveContent() {
    if (isSaving || !activeEditor) return;

    // Serialize ProseMirror document to markdown
    const markdown = defaultMarkdownSerializer.serialize(
      activeEditor.view.state.doc,
    );

    isSaving = true;
    const meta = activeEditor.meta;

    fetch("/markdown-editor/save/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: meta.pageId,
        field: meta.name,
        markdown: markdown, // Byte-identical markdown string
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          console.log("Saved successfully");
          // Update data attribute with new markdown
          if (activeTarget) {
            activeTarget.dataset.markdown = markdown;
          }
          // Update active markdown
          activeMarkdown = markdown;
          // Re-render the preview
          if (activeTarget) {
            activeTarget.innerHTML = data.html || "";
          }
        } else {
          alert(`Save failed: ${data.message || "Unknown error"}`);
        }
      })
      .catch((err) => {
        console.error("Save error:", err);
        alert(`Save error: ${err.message}`);
      })
      .finally(() => {
        isSaving = false;
      });
  }

  /**
   * Destroy active editor
   */
  function destroyEditor() {
    if (activeEditor) {
      activeEditor.view.destroy();
      activeEditor = null;
    }
    if (activeHost) {
      activeHost.remove();
      activeHost = null;
    }
    if (activeTarget) {
      activeTarget.style.display = "";
      activeTarget = null;
    }
    if (toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
    }
    activeMarkdown = null;
  }

  /**
   * Create save toolbar
   */
  function createToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "fe-toolbar";
    toolbar.style.position = "fixed";
    toolbar.style.top = "10px";
    toolbar.style.right = "10px";
    toolbar.style.zIndex = "10000";
    toolbar.style.background = "#fff";
    toolbar.style.border = "1px solid #ccc";
    toolbar.style.borderRadius = "4px";
    toolbar.style.padding = "4px 8px";
    toolbar.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "💾 Save";
    saveBtn.style.padding = "4px 12px";
    saveBtn.style.cursor = "pointer";
    saveBtn.onclick = () => saveContent();

    toolbar.appendChild(saveBtn);
    document.body.appendChild(toolbar);
    toolbarEl = toolbar;
  }

  /**
   * Position toolbar near editor
   */
  function positionToolbar() {
    if (!toolbarEl || !activeHost) return;
    const rect = activeHost.getBoundingClientRect();
    toolbarEl.style.top = `${rect.top + window.scrollY - 40}px`;
    toolbarEl.style.right = "10px";
  }

  /**
   * Attach editor to an element
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
    // Convert escaped newlines to actual newlines if needed
    let markdown = element.dataset.markdown || "";
    // Handle literal \n in HTML attributes
    markdown = markdown.replace(/\\n/g, "\n");
    markdown = markdown.replace(/\\r/g, "\r");
    markdown = markdown.replace(/\\t/g, "\t");
    activeMarkdown = markdown;

    // Create editor
    const { view, host } = createEditor(element, markdown, meta);
    activeEditor = { view, meta };
    activeHost = host;

    // Show toolbar
    createToolbar();
    positionToolbar();

    // Focus editor
    view.focus();

    // Handle blur (close editor when clicking outside)
    const onBlur = () => {
      setTimeout(() => {
        if (
          document.activeElement !== host &&
          !host.contains(document.activeElement) &&
          !toolbarEl.contains(document.activeElement)
        ) {
          destroyEditor();
        }
      }, 100);
    };
    // Listen to blur on the ProseMirror content element
    const pmContent = host.querySelector(".ProseMirror");
    if (pmContent) {
      pmContent.addEventListener("blur", onBlur);
    }
  }

  /**
   * Initialize editors
   */
  function init() {
    document.querySelectorAll(`.${EDITABLE_CLASS}`).forEach((el) => {
      el.addEventListener("dblclick", () => attachTo(el));
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
