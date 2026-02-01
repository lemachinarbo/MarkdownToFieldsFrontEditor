(function () {
  const EDITABLE_CLASS = "fe-editable";
  let activeEditor = null;
  let activeHost = null;
  let activeTarget = null;

  function createHost(nextTo) {
    const host = document.createElement("div");
    host.className = "fe-editor-host";
    host.style.minHeight = "1.2em";
    nextTo.parentNode.insertBefore(host, nextTo.nextSibling);
    return host;
  }

  // Floating toolbar implementation
  let toolbarEl = null;
  // Suppress finishEditing's auto-apply when we intentionally replace content
  let suppressFinishEditing = false;
  let allowedCommands = null;
  let allowedBlocks = null;

  function getFieldMeta(el) {
    if (!el || !el.dataset) return null;
    const typeRaw = (el.dataset.fieldType || "").toLowerCase();
    const isContainer =
      el.dataset.isContainer === "true" || el.dataset.isContainer === "1";
    return {
      type: typeRaw || "block",
      isContainer,
    };
  }

  /**
   * Parse toolbar config string into commands and blocks
   * Config format: "bold,italic,strike,code,paragraph,h1,h2,h3,h4,h5,h6,bulletList,orderedList,blockquote,link"
   */
  function parseToolbarConfig(configString) {
    if (!configString) return null;

    const items = configString
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const commands = new Set();
    const blocks = new Set();
    const headingLevels = new Set();

    const cmdMap = {
      bold: "bold",
      italic: "italic",
      strike: "strike",
      code: "code",
      link: "link",
      save: "save",
      clear: "clear",
      paragraph: "paragraph",
      ul: "ul",
      bulletlist: "ul",
      orderedlist: "ol",
      ol: "ol",
      blockquote: "blockquote",
      h1: "h1",
      h2: "h2",
      h3: "h3",
      h4: "h4",
      h5: "h5",
      h6: "h6",
    };

    const blockMap = {
      paragraph: "paragraph",
      bulletlist: "list",
      orderedlist: "list",
      blockquote: "quote",
      quote: "quote",
      hr: "hr",
      horizontalrule: "hr",
    };

    items.forEach((item) => {
      const lower = item.toLowerCase();

      // Check if it's a heading level
      if (/^h[1-6]$/.test(lower)) {
        commands.add(lower);
        blocks.add("heading");
        headingLevels.add(parseInt(lower.charAt(1)));
      }
      // Check if it's a command
      if (cmdMap[lower]) {
        commands.add(cmdMap[lower]);
      }
      // Check if it's a block type
      if (blockMap[lower]) {
        blocks.add(blockMap[lower]);
      }
    });

    return { commands, blocks, headingLevels: Array.from(headingLevels) };
  }

  function resolveConstraints(meta) {
    if (!meta) return null;

    // For containers, use module config if available
    if (meta.isContainer) {
      const config = window.MarkdownFrontEditorConfig;
      if (config && config.containerToolbar) {
        const parsed = parseToolbarConfig(config.containerToolbar);
        if (parsed) {
          // Always include save
          parsed.commands.add("save");
          return parsed;
        }
      }
      // Fallback to default container config
      return {
        commands: new Set([
          "bold",
          "italic",
          "strike",
          "code",
          "paragraph",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "ul",
          "ol",
          "blockquote",
          "link",
          "clear",
          "save",
        ]),
        blocks: new Set(["paragraph", "heading", "list", "quote", "hr"]),
        headingLevels: [1, 2, 3, 4, 5, 6],
      };
    }

    // Non-container fields use hardcoded constraints
    // Block-count enforcement happens at runtime (Enter guard, paste guard, post-command undo)
    // UI shows all available buttons - runtime guards prevent violations
    switch (meta.type) {
      case "heading":
        return {
          commands: new Set([
            "bold",
            "italic",
            "strike",
            "code",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "ul",
            "ol",
            "blockquote",
            "link",
            "clear",
            "save",
          ]),
          blocks: new Set(["heading", "paragraph", "list", "quote"]),
          headingLevels: [1, 2, 3, 4, 5, 6],
        };
      case "paragraph":
        return {
          commands: new Set([
            "bold",
            "italic",
            "strike",
            "code",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "ul",
            "ol",
            "blockquote",
            "link",
            "clear",
            "save",
          ]),
          blocks: new Set(["paragraph", "heading", "list", "quote"]),
          headingLevels: [1, 2, 3, 4, 5, 6],
        };
      case "list":
        return {
          commands: new Set([
            "bold",
            "italic",
            "strike",
            "code",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "ul",
            "ol",
            "blockquote",
            "link",
            "clear",
            "save",
          ]),
          blocks: new Set(["list", "paragraph", "heading", "quote"]),
          headingLevels: [1, 2, 3, 4, 5, 6],
        };
      default:
        return {
          commands: new Set([
            "bold",
            "italic",
            "strike",
            "code",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "ul",
            "ol",
            "blockquote",
            "link",
            "clear",
            "save",
          ]),
          blocks: new Set(["paragraph", "heading", "list", "quote", "hr"]),
          headingLevels: [1, 2, 3, 4, 5, 6],
        };
    }
  }

  function applyToolbarConstraints(meta) {
    const constraints = resolveConstraints(meta);
    allowedCommands = constraints ? constraints.commands : null;
    allowedBlocks = constraints ? constraints.blocks : null;

    if (!toolbarEl) return;
    const buttons = toolbarEl.querySelectorAll("button[data-cmd]");
    buttons.forEach((btn) => {
      const cmd = btn.getAttribute("data-cmd");
      if (!allowedCommands || allowedCommands.has(cmd)) {
        btn.style.display = "";
        btn.disabled = false;
      } else {
        btn.style.display = "none";
      }
    });
  }

  function buildExtensions(libs, meta) {
    // Not used - using contentEditable editor instead
    return [];
  }

  function createToolbarEl() {
    if (toolbarEl) return toolbarEl;
    const el = document.createElement("div");
    el.className = "fe-toolbar";
    el.setAttribute("aria-hidden", "true");
    el.style.position = "absolute";
    el.style.display = "none";

    // All possible toolbar buttons (will be shown/hidden based on constraints)
    el.innerHTML = `
      <button data-cmd="bold" title="Bold"><strong>B</strong></button>
      <button data-cmd="italic" title="Italic"><em>I</em></button>
      <button data-cmd="strike" title="Strikethrough"><s>S</s></button>
      <button data-cmd="code" title="Code"><code>C</code></button>
      <button data-cmd="paragraph" title="Paragraph">¶</button>
      <button data-cmd="h1" title="Heading 1">H1</button>
      <button data-cmd="h2" title="Heading 2">H2</button>
      <button data-cmd="h3" title="Heading 3">H3</button>
      <button data-cmd="h4" title="Heading 4">H4</button>
      <button data-cmd="h5" title="Heading 5">H5</button>
      <button data-cmd="h6" title="Heading 6">H6</button>
      <button data-cmd="ul" title="Bulleted list">•</button>
      <button data-cmd="ol" title="Numbered list">1.</button>
      <button data-cmd="blockquote" title="Blockquote">"</button>
      <button data-cmd="link" title="Link">🔗</button>
      <button data-cmd="clear" title="Clear formatting">Tx</button>
      <button data-cmd="save" title="Save">💾</button>
    `;

    // Prevent mousedown from blurring the editor so clicks register
    el.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
    });

    el.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      const cmd = btn.getAttribute("data-cmd");
      if (cmd === "save") {
        saveContent();
      } else {
        performCommand(cmd);
      }
    });

    document.body.appendChild(el);
    toolbarEl = el;
    return el;
  }

  // Toast helper
  let toastEl = null;
  function getToastEl() {
    if (toastEl) return toastEl;
    const t = document.createElement("div");
    t.className = "fe-toast";
    document.body.appendChild(t);
    toastEl = t;
    return t;
  }

  function showToast(type, msg, timeout = 3000) {
    const t = getToastEl();
    t.className = "fe-toast " + type;
    t.textContent = msg;
    t.style.display = "block";
    setTimeout(() => {
      try {
        t.style.display = "none";
      } catch (e) {}
    }, timeout);
  }

  function toggleStrikeSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      // Expand to nearest word if collapsed
      if (range.startContainer && range.startContainer.nodeType === 3) {
        const text = range.startContainer.textContent || "";
        let start = range.startOffset;
        let end = range.startOffset;
        while (start > 0 && /\S/.test(text[start - 1])) start--;
        while (end < text.length && /\S/.test(text[end])) end++;
        if (end > start) {
          range.setStart(range.startContainer, start);
          range.setEnd(range.startContainer, end);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          return false;
        }
      } else {
        return false;
      }
    }

    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    const strikeEl =
      node && node.closest ? node.closest("del, s, strike") : null;
    if (strikeEl) {
      // Remove strike: unwrap and restore selection
      const parent = strikeEl.parentNode;
      const firstChild = strikeEl.firstChild;
      const lastChild = strikeEl.lastChild;

      while (strikeEl.firstChild)
        parent.insertBefore(strikeEl.firstChild, strikeEl);
      parent.removeChild(strikeEl);

      // Restore selection to unwrapped content
      if (firstChild && lastChild) {
        const newRange = document.createRange();
        try {
          if (firstChild.nodeType === 3) {
            newRange.setStart(firstChild, 0);
          } else {
            newRange.setStartBefore(firstChild);
          }

          if (lastChild.nodeType === 3) {
            newRange.setEnd(lastChild, lastChild.textContent.length);
          } else {
            newRange.setEndAfter(lastChild);
          }

          sel.removeAllRanges();
          sel.addRange(newRange);
        } catch (e) {
          // Silent fail on selection restoration
        }
      }

      return true;
    }

    // Add strike: wrap and restore selection
    const wrapper = document.createElement("del");
    try {
      range.surroundContents(wrapper);
      // Restore selection to wrapped content
      const newRange = document.createRange();
      newRange.selectNodeContents(wrapper);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } catch (e) {
      const frag = range.extractContents();
      wrapper.appendChild(frag);
      range.insertNode(wrapper);
      // Restore selection to wrapped content
      const newRange = document.createRange();
      newRange.selectNodeContents(wrapper);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    return true;
  }

  function performCommand(cmd) {
    if (!cmd) return;
    if (allowedCommands && !allowedCommands.has(cmd)) return;

    // Manual formatting via DOM manipulation and execCommand
    if (cmd === "strike") {
      const toggled = toggleStrikeSelection();
      if (toggled) return;
    }

    // Use document.execCommand for common features
    switch (cmd) {
      case "bold":
        document.execCommand("bold");
        break;
      case "italic":
        document.execCommand("italic");
        break;
      case "strike":
        if (!toggleStrikeSelection()) {
          document.execCommand("strikethrough");
        }
        break;
      case "paragraph":
        document.execCommand("formatBlock", false, "p");
        break;
      case "h1":
        document.execCommand("formatBlock", false, "h1");
        break;
      case "h2":
        document.execCommand("formatBlock", false, "h2");
        break;
      case "h3":
        document.execCommand("formatBlock", false, "h3");
        break;
      case "h4":
        document.execCommand("formatBlock", false, "h4");
        break;
      case "h5":
        document.execCommand("formatBlock", false, "h5");
        break;
      case "h6":
        document.execCommand("formatBlock", false, "h6");
        break;
      case "ul":
        document.execCommand("insertUnorderedList");
        break;
      case "ol":
        document.execCommand("insertOrderedList");
        break;
      case "blockquote":
        document.execCommand("formatBlock", false, "blockquote");
        break;
      case "clear":
        document.execCommand("removeFormat");
        document.execCommand("formatBlock", false, "p");
        break;
      case "link": {
        const url = prompt("Enter link URL");
        if (url) document.execCommand("createLink", false, url);
        break;
      }
    }

    // Block-count enforcement: Audit after command to ensure constraint maintained
    if (activeEditableEl && countTopLevelBlocks(activeEditableEl) > 1) {
      // If command violated constraint, undo (experimental feature)
      document.execCommand("undo");
    }
  }

  function positionToolbar() {
    if (!toolbarEl || (!activeHost && !activeTarget)) return hideToolbar();

    const sel = document.getSelection();
    let rect = null;
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      rect = range.getBoundingClientRect();
    }
    if (!rect) {
      const el = activeHost || activeTarget;
      rect = el.getBoundingClientRect();
    }

    const tb = toolbarEl;
    tb.style.display = "flex";
    const tbRect = tb.getBoundingClientRect();
    const left = rect.left + rect.width / 2 - tbRect.width / 2 + window.scrollX;
    const top = rect.top + window.scrollY - tbRect.height - 8;
    tb.style.left = Math.max(8, left) + "px";
    tb.style.top = Math.max(8, top) + "px";

    // Also reposition slash menu if visible
    if (slashMenuEl && slashMenuEl.style.display !== "none") {
      const mr = slashMenuEl.getBoundingClientRect();
      const left2 = rect.left + rect.width / 2 - mr.width / 2 + window.scrollX;
      const top2 = rect.top + window.scrollY - mr.height - 8;
      slashMenuEl.style.left = Math.max(8, left2) + "px";
      slashMenuEl.style.top = Math.max(8, top2) + "px";
    }
  }

  function createAndShowToolbar(hostOrEl, isTipTap, meta) {
    createToolbarEl();
    applyToolbarConstraints(meta);
    positionToolbar();
    toolbarEl.setAttribute("aria-hidden", "false");
  }

  function hideToolbar() {
    if (!toolbarEl) return;
    toolbarEl.style.display = "none";
    toolbarEl.setAttribute("aria-hidden", "true");
  }

  // Notion-like slash menu and block handle
  let slashMenuEl = null;
  let activeEditableEl = null;
  let activeKeydownListener = null;
  let activeHandleEl = null;

  function createSlashMenu() {
    if (slashMenuEl) return slashMenuEl;
    const menu = document.createElement("div");
    menu.className = "fe-slash-menu";
    menu.style.display = "none";
    const list = document.createElement("ul");

    const items = [
      { id: "paragraph", label: "Paragraph" },
      { id: "h1", label: "Heading 1" },
      { id: "h2", label: "Heading 2" },
      { id: "h3", label: "Heading 3" },
      { id: "h4", label: "Heading 4" },
      { id: "h5", label: "Heading 5" },
      { id: "h6", label: "Heading 6" },
      { id: "ul", label: "Bulleted list" },
      { id: "ol", label: "Numbered list" },
      { id: "quote", label: "Quote" },
      { id: "hr", label: "Divider" },
    ];

    for (const it of items) {
      const li = document.createElement("li");
      li.setAttribute("data-id", it.id);
      li.textContent = it.label;
      li.addEventListener("click", () => {
        applyBlockCommand(it.id);
        hideSlashMenu();
      });
      list.appendChild(li);
    }

    menu.appendChild(list);
    document.body.appendChild(menu);
    slashMenuEl = menu;
    return menu;
  }

  function showSlashMenuAt(rect) {
    const menu = createSlashMenu();
    if (allowedBlocks) {
      const items = menu.querySelectorAll("li[data-id]");
      items.forEach((li) => {
        const id = li.getAttribute("data-id");
        let blockType = null;
        if (id === "paragraph") blockType = "paragraph";
        else if (/^h[1-6]$/.test(id)) blockType = "heading";
        else if (id === "ul" || id === "ol") blockType = "list";
        else if (id === "quote") blockType = "quote";
        else if (id === "hr") blockType = "hr";

        if (!blockType || allowedBlocks.has(blockType)) {
          li.style.display = "";
        } else {
          li.style.display = "none";
        }
      });
    }
    const mr = menu.getBoundingClientRect();
    const left = rect.left + rect.width / 2 - mr.width / 2 + window.scrollX;
    const top = rect.top + window.scrollY - mr.height - 8;
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";
    menu.style.display = "block";
  }

  function hideSlashMenu() {
    if (!slashMenuEl) return;
    slashMenuEl.style.display = "none";
  }

  /**
   * Count top-level block elements in the editable content.
   * Block elements: p, h1-h6, ul, ol, blockquote, pre, div, hr
   * (div is treated as block for normalization purposes)
   */
  function countTopLevelBlocks(element) {
    if (!element) return 0;
    let count = 0;
    for (let i = 0; i < element.childNodes.length; i++) {
      const node = element.childNodes[i];
      if (node.nodeType === 1) {
        // Element node
        const tag = node.tagName.toLowerCase();
        if (/^(p|h[1-6]|ul|ol|blockquote|pre|div|hr)$/.test(tag)) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Check if pasted HTML would create multiple top-level blocks.
   * Parse HTML and count block-level elements at root level.
   */
  function wouldCreateMultipleBlocks(html) {
    if (!html) return false;
    const temp = document.createElement("div");
    temp.innerHTML = html;
    return countTopLevelBlocks(temp) > 1;
  }

  function applyBlockCommand(cmd) {
    if (!activeEditableEl) return;
    if (allowedBlocks) {
      let blockType = null;
      if (cmd === "paragraph") blockType = "paragraph";
      else if (/^h[1-6]$/.test(cmd)) blockType = "heading";
      else if (cmd === "ul" || cmd === "ol") blockType = "list";
      else if (cmd === "quote") blockType = "quote";
      else if (cmd === "hr") blockType = "hr";

      if (blockType && !allowedBlocks.has(blockType)) return;
    }

    // Use execCommand for block formatting
    switch (cmd) {
      case "paragraph":
        document.execCommand("formatBlock", false, "p");
        break;
      case "h1":
        document.execCommand("formatBlock", false, "h1");
        break;
      case "h2":
        document.execCommand("formatBlock", false, "h2");
        break;
      case "h3":
        document.execCommand("formatBlock", false, "h3");
        break;
      case "h4":
        document.execCommand("formatBlock", false, "h4");
        break;
      case "h5":
        document.execCommand("formatBlock", false, "h5");
        break;
      case "h6":
        document.execCommand("formatBlock", false, "h6");
        break;
      case "ul":
        document.execCommand("insertUnorderedList");
        break;
      case "ol":
        document.execCommand("insertOrderedList");
        break;
      case "quote":
        document.execCommand("formatBlock", false, "blockquote");
        break;
      case "hr":
        document.execCommand("insertHorizontalRule");
        break;
    }

    // Block-count enforcement: Audit after command to ensure constraint maintained
    if (activeEditableEl && countTopLevelBlocks(activeEditableEl) > 1) {
      // If command violated constraint, undo
      document.execCommand("undo");
    }
  }

  function onEditableKeydown(ev) {
    // Block-count enforcement: Prevent Enter only if it would create a NEW top-level block
    // Enter is ALLOWED inside multi-item blocks (list items, blockquotes) to create new items/lines
    if (ev.key === "Enter" && ev.type === "keydown") {
      if (activeEditableEl && countTopLevelBlocks(activeEditableEl) >= 1) {
        const sel = document.getSelection();
        if (sel && sel.rangeCount > 0) {
          let node = sel.anchorNode || sel.focusNode;
          if (node && node.nodeType === 3) node = node.parentNode;

          // Check if cursor is inside a multi-item block context
          // These contexts allow Enter to create new items/lines without creating new top-level blocks
          let current = node;
          while (current && current !== activeEditableEl) {
            const tag = current.tagName?.toLowerCase();

            // Inside list item: Enter creates new <li>, stays in list block ✓
            if (tag === "li") {
              // Allow Enter but audit after to catch list-exit case
              setTimeout(() => {
                if (
                  activeEditableEl &&
                  countTopLevelBlocks(activeEditableEl) > 1
                ) {
                  document.execCommand("undo");
                }
              }, 0);
              return;
            }

            // Inside blockquote: Enter creates new line, stays in quote block ✓
            if (tag === "blockquote") {
              // Allow Enter but audit after
              setTimeout(() => {
                if (
                  activeEditableEl &&
                  countTopLevelBlocks(activeEditableEl) > 1
                ) {
                  document.execCommand("undo");
                }
              }, 0);
              return;
            }

            current = current.parentNode;
          }

          // Not in multi-item context: we're in a paragraph/heading at top-level
          // Enter would create a new top-level block, so block it
          ev.preventDefault();
          return;
        }
      }
    }

    if (ev.key === "/" && ev.type === "keydown") {
      // Only when selection collapsed
      const sel = document.getSelection();
      if (!sel || !sel.isCollapsed) return;
      // Show menu anchored at caret
      ev.preventDefault();
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showSlashMenuAt(rect);
    }

    // Escape hides menu
    if (ev.key === "Escape") hideSlashMenu();
  }

  function createHandle(host) {
    if (activeHandleEl) return activeHandleEl;
    const btn = document.createElement("button");
    btn.className = "fe-handle";
    btn.type = "button";
    btn.innerHTML = "≡";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const rect = host.getBoundingClientRect();
      showSlashMenuAt(rect);
    });
    host.style.position = "relative";
    host.insertBefore(btn, host.firstChild);
    activeHandleEl = btn;
    return btn;
  }

  function removeHandle() {
    if (!activeHandleEl) return;
    if (activeHandleEl.parentNode)
      activeHandleEl.parentNode.removeChild(activeHandleEl);
    activeHandleEl = null;
  }

  function destroyEditor() {
    if (!activeEditor) return;
    try {
      if (typeof activeEditor.destroy === "function") activeEditor.destroy();
    } catch (e) {
      /* ignore */
    }

    try {
      if (activeHost && activeHost.parentNode)
        activeHost.parentNode.removeChild(activeHost);
    } catch (e) {
      // Error removing activeHost
    }

    try {
      if (activeTarget && typeof activeTarget.style !== "undefined")
        activeTarget.style.display = "";
    } catch (e) {
      // Error setting activeTarget display
    }

    // If we used contentEditable fallback, clear that state
    try {
      const at = activeTarget;
      if (at && typeof at.removeAttribute === "function") {
        try {
          at.removeAttribute("contenteditable");
        } catch (_) {}
        try {
          at.removeAttribute("data-fe-editing");
        } catch (_) {}
      }
    } catch (e) {
      // Error clearing activeTarget attributes
    }

    // Cleanup toolbar, slash menu, handle and listeners
    hideToolbar();
    hideSlashMenu();
    removeHandle();
    try {
      document.removeEventListener("selectionchange", positionToolbar);
    } catch (e) {}
    if (activeEditableEl && activeKeydownListener) {
      activeEditableEl.removeEventListener("keydown", activeKeydownListener);
    }

    activeEditor = null;
    activeHost = null;
    activeTarget = null;
    activeEditableEl = null;
    activeKeydownListener = null;
  }

  function finishEditing() {
    if (suppressFinishEditing) {
      suppressFinishEditing = false;
      return;
    }
    if (!activeEditor || !activeTarget) return;
    // TipTap editor exposes getHTML, while fallback uses innerHTML directly
    const html =
      typeof activeEditor.getHTML === "function"
        ? activeEditor.getHTML()
        : activeTarget.innerHTML;
    destroyEditor();
    if (html) activeTarget.innerHTML = html;
  }

  function fallbackAttach(element) {
    // Simple contentEditable fallback
    activeTarget = element;
    element.setAttribute("contenteditable", "true");
    element.setAttribute("data-fe-editing", "1");
    element.focus();

    // remember editable element and add keydown handler for slash menu
    activeEditableEl = element;
    activeKeydownListener = onEditableKeydown;
    element.addEventListener("keydown", activeKeydownListener);

    // Block-count enforcement: Guard paste to prevent multi-block content
    element.addEventListener("paste", (ev) => {
      ev.preventDefault();

      let html = "";
      if (ev.clipboardData) {
        // Try to get HTML first, fallback to text
        html = ev.clipboardData.getData("text/html");
        if (!html) {
          html = ev.clipboardData.getData("text/plain");
        }
      }

      // Check if pasted content would exceed block count
      if (wouldCreateMultipleBlocks(html)) {
        // Silently reject multi-block paste
        return;
      }

      // Insert single-block paste content
      if (html) {
        document.execCommand("insertHTML", false, html);
      }
    });

    function onBlur() {
      element.removeEventListener("blur", onBlur);
      try {
        destroyEditor();
      } catch (e) {
        // destroyEditor error on blur
      }
    }
    element.addEventListener("blur", onBlur);
    activeEditor = { getHTML: () => element.innerHTML };
  }

  function attachTo(element) {
    if (activeEditor) return; // single-editor restriction
    const meta = getFieldMeta(element);

    // Use contentEditable editor
    fallbackAttach(element);
    createAndShowToolbar(element, false, meta);
    document.addEventListener("selectionchange", positionToolbar);
  }
  let isSaving = false;

  function normalizeHtmlForMarkdown(html) {
    if (!html) return html;

    // Restore encoded strike tags so converter can handle them
    html = html.replace(
      /&lt;(\/?)(strike|s)([^&]*?)&gt;/gi,
      (m, slash, tag, attrs) => `<${slash}${tag}${attrs}>`,
    );

    const root = document.createElement("div");
    root.innerHTML = html;

    const decodeHtml = (value) => {
      if (!value) return "";
      const tmp = document.createElement("textarea");
      tmp.innerHTML = value;
      return tmp.value;
    };

    // Unwrap spans and drop inline styles that break markdown conversion
    root.querySelectorAll("span").forEach((span) => {
      const frag = document.createDocumentFragment();
      while (span.firstChild) frag.appendChild(span.firstChild);
      span.replaceWith(frag);
    });

    // Normalize strike tags to <del> for markdown conversion
    root.querySelectorAll("strike, s").forEach((el) => {
      const del = document.createElement("del");
      del.innerHTML = el.innerHTML;
      el.replaceWith(del);
    });

    // Remove inline styles that can leak into markdown
    root.querySelectorAll("[style]").forEach((el) => {
      el.removeAttribute("style");
    });

    const buildBlocksFromLines = (lines, doc) => {
      const frag = doc.createDocumentFragment();
      let currentType = null;
      let currentEl = null;

      const flush = () => {
        if (currentEl) frag.appendChild(currentEl);
        currentEl = null;
        currentType = null;
      };

      for (const raw of lines) {
        const line = (raw || "").trim();
        if (!line) {
          flush();
          continue;
        }

        let type = "p";
        let content = line;
        if (/^>\s*/.test(line)) {
          type = "quote";
          content = line.replace(/^>\s*/, "");
        } else if (/^\d+\.\s+/.test(line)) {
          type = "ol";
          content = line.replace(/^\d+\.\s+/, "");
        } else if (/^[-*]\s+/.test(line)) {
          type = "ul";
          content = line.replace(/^[-*]\s+/, "");
        }

        if (type === "p") {
          flush();
          const p = doc.createElement("p");
          p.textContent = content;
          frag.appendChild(p);
          continue;
        }

        if (type !== currentType) {
          flush();
          if (type === "ol" || type === "ul") {
            currentEl = doc.createElement(type);
          } else if (type === "quote") {
            currentEl = doc.createElement("blockquote");
          }
          currentType = type;
        }

        if (type === "ol" || type === "ul") {
          const li = doc.createElement("li");
          li.textContent = content;
          currentEl.appendChild(li);
        } else if (type === "quote") {
          const p = doc.createElement("p");
          p.textContent = content;
          currentEl.appendChild(p);
        }
      }

      flush();
      return frag;
    };

    const getLinesFromElement = (el) => {
      if (!el) return [];
      const innerText = typeof el.innerText === "string" ? el.innerText : "";
      if (innerText.trim()) {
        return innerText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
      }

      const html = el.innerHTML || "";
      const normalized = html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n");
      const text = decodeHtml(normalized.replace(/<[^>]+>/g, ""));
      return text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    };

    const replaceElementWithLines = (el) => {
      const lines = getLinesFromElement(el);
      if (!lines.length) return;

      const hasMarkers = lines.some((l) =>
        /^(?:\d+\.\s+|[-*]\s+|>\s*)/.test(l),
      );
      if (!hasMarkers) return;

      const frag = buildBlocksFromLines(lines, el.ownerDocument);
      if (frag && frag.childNodes.length) el.replaceWith(frag);
    };

    // Split headings containing <br> into separate blocks
    root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      if (!/<br\s*\/?>/i.test(h.innerHTML)) return;
      const parts = h.innerHTML
        .split(/<br\s*\/?>/i)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length <= 1) return;

      h.innerHTML = parts.shift();
      const lines = parts
        .map((p) => p.replace(/<[^>]+>/g, "").trim())
        .filter(Boolean);
      if (!lines.length) return;

      const frag = buildBlocksFromLines(lines, h.ownerDocument);
      h.after(frag);
    });

    // Convert divs/paragraphs that contain list/quote-like lines
    root.querySelectorAll("div, p").forEach((el) => {
      replaceElementWithLines(el);
    });

    // Force conversion for plain text div blocks with list/quote markers
    root.querySelectorAll("div").forEach((el) => {
      if (el.children && el.children.length) return;
      const lines = getLinesFromElement(el);
      if (!lines.length) return;
      const hasMarkers = lines.some((l) =>
        /^(?:\d+\.\s+|[-*]\s+|>\s*)/.test(l),
      );
      if (!hasMarkers) return;
      const frag = buildBlocksFromLines(lines, el.ownerDocument);
      if (frag && frag.childNodes.length) el.replaceWith(frag);
    });

    return root.innerHTML;
  }

  async function saveContent() {
    if (isSaving) {
      showToast("error", "Save in progress");
      return;
    }
    isSaving = true;
    // disable save button to prevent duplicates
    const disableSaveBtn = () => {
      if (toolbarEl) {
        const btn = toolbarEl.querySelector('button[data-cmd="save"]');
        if (btn) btn.disabled = true;
      }
    };
    const enableSaveBtn = () => {
      if (toolbarEl) {
        const btn = toolbarEl.querySelector('button[data-cmd="save"]');
        if (btn) btn.disabled = false;
      }
    };
    disableSaveBtn();

    try {
      // Deterministic HTML source: prefer activeEditor.getHTML(), then activeHost's editable child, then activeTarget, then first .fe-editable
      let html = "";
      try {
        if (activeEditor && typeof activeEditor.getHTML === "function") {
          html = activeEditor.getHTML();
        } else if (activeHost) {
          const shim = activeHost.querySelector(".tiptap-shim-editable");
          const editableChild = activeHost.querySelector("[contenteditable]");
          if (shim) html = shim.innerHTML;
          else if (editableChild) html = editableChild.innerHTML;
          else html = activeHost.innerHTML || "";
        } else if (activeTarget) {
          html = activeTarget.innerHTML || "";
        } else {
          const el = document.querySelector(".fe-editable");
          if (el) html = el.innerHTML || "";
        }
      } catch (e) {
        html = activeTarget ? activeTarget.innerHTML : "";
      }

      // Validate block-count constraint: reject saves with multiple top-level blocks
      try {
        const temp = document.createElement("div");
        temp.innerHTML = html;
        if (countTopLevelBlocks(temp) > 1) {
          enableSaveBtn();
          isSaving = false;
          showToast(
            "error",
            "Cannot save: field must contain exactly one block",
          );
          return;
        }
      } catch (e) {
        /* ignore */
      }

      // Strip known client chrome (handles, toolbar) before sending
      try {
        html = html.replace(
          /<button[^>]*class=["']?[^"']*fe-handle[^"']*["']?[^>]*>[\s\S]*?<\/button>/gi,
          "",
        );
        html = html.replace(
          /<div[^>]*class=["']?[^"']*fe-toolbar[^"']*["']?[^>]*>[\s\S]*?<\/div>/gi,
          "",
        );
        html = html.replace(/ data-fe-editing="[^"]*"/g, "");
      } catch (e) {
        /* ignore */
      }

      // Ensure inline breaks are real <br> tags before posting
      try {
        html = html.replace(
          /<md-inline-break\b[^>]*><\/md-inline-break>/gi,
          "<br>",
        );
      } catch (e) {
        /* ignore */
      }

      // Normalize editor HTML to improve markdown conversion
      try {
        html = normalizeHtmlForMarkdown(html);
      } catch (e) {
        /* ignore */
      }

      // If the editor normalized a heading+paragraphs (common when <br> was inside a heading),
      // or created multiple consecutive headings, merge them back into a single heading with <br>.
      // Also normalize all nested heading levels to h1 to prevent silent data loss.
      try {
        // First try: merge consecutive headings of same level
        html = html.replace(
          /<h([1-6])>([\s\S]*?)<\/h\1>(?:\s*<h\1>([\s\S]*?)<\/h\1>)+/g,
          (match, lvl) => {
            // Extract all heading contents (regardless of level)
            const contents = [];
            const headingRegex = /<h[1-6]>([\s\S]*?)<\/h[1-6]>/g;
            let hMatch;
            while ((hMatch = headingRegex.exec(match))) {
              contents.push(hMatch[1]);
            }
            const merged = contents.join("<br>");
            return `<h${lvl}>${merged}</h${lvl}>`;
          },
        );

        // Normalize any remaining nested headings (h2, h3, etc) to match parent level
        // This prevents silent data loss when user creates h2 inside h1
        html = html.replace(
          /^<h([1-6])>([\s\S]*?)<\/h\1>$/i,
          (match, lvl, content) => {
            const normalized = content.replace(
              /<h[1-6]>([\s\S]*?)<\/h[1-6]>/g,
              (hMatch, hContent) => hContent,
            );
            if (normalized !== content) {
              return `<h${lvl}>${normalized}</h${lvl}>`;
            }
            return match;
          },
        );

        // Second try: merge paragraphs after heading
        html = html.replace(
          /^\s*<h([1-6])>([\s\S]*?)<\/h\1>((?:\s*<p>[\s\S]*?<\/p>)+)\s*$/i,
          (match, lvl, headingContent, paragraphs) => {
            const pContents = [];
            const pRegex = /<p>([\s\S]*?)<\/p>/g;
            let pMatch;
            while ((pMatch = pRegex.exec(paragraphs))) {
              pContents.push(pMatch[1]);
            }
            const merged = [headingContent, ...pContents].join("<br>");
            return `<h${lvl}>${merged}</h${lvl}>`;
          },
        );
      } catch (e) {
        // Merge error ignored
      }

      // Validate non-empty content (allow images/media)
      const tmp = document.createElement("div");
      tmp.innerHTML = html || "";
      const text = (tmp.textContent || "").trim();
      const hasMedia = !!tmp.querySelector("img,video,iframe,svg");
      if (!text && !hasMedia) {
        showToast("error", "Nothing to save");
        return;
      }

      // fetch CSRF token
      let tokenName = null,
        tokenValue = null;
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
        /* ignore token fetch error */
      }

      const body = new URLSearchParams();
      body.append("html", html);
      if (tokenName) body.append(tokenName, tokenValue);
      // Include block identifier and page id when available for single-block replacement
      const mdName =
        activeTarget && activeTarget.dataset && activeTarget.dataset.mdName
          ? activeTarget.dataset.mdName
          : null;
      const pageId =
        activeTarget && activeTarget.dataset && activeTarget.dataset.page
          ? activeTarget.dataset.page
          : null;
      if (mdName) body.append("mdName", mdName);
      if (pageId) body.append("pageId", pageId);

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
        if (json.html) {
          try {
            suppressFinishEditing = true;
            destroyEditor();
          } catch (e) {}
          const hostEl =
            document.querySelector(
              `.fe-editable[data-md-name="${mdName}"][data-page="${pageId}"]`,
            ) || activeTarget;
          if (hostEl) {
            try {
              hostEl.innerHTML = json.html;
            } catch (e) {}
            setTimeout(() => {
              try {
                hostEl.innerHTML = json.html;
              } catch (e) {}
            }, 120);
          }
        } else {
          try {
            destroyEditor();
          } catch (e) {}
        }
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
      enableSaveBtn();
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.body.addEventListener("dblclick", (ev) => {
      const el = ev.target.closest("." + EDITABLE_CLASS);
      if (!el) return;
      attachTo(el);
    });

    // Escape key cancels edit
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && activeEditor) {
        destroyEditor();
      }
    });
  });
})();
