import { NodeSelection } from "prosemirror-state";
import { createToolbarButtons } from "./editor-toolbar.js";
import { renderToolbarButtons } from "./editor-toolbar-renderer.js";
import { createImagePicker } from "./image-picker.js";

/**
 * Applies the fullscreen split-pane width preference to the shell.
 * Does not create panes or mutate canonical document authority.
 */
export function applySplitSecondarySize({
  percent,
  editorShell,
  setSplitSecondarySizePercent,
}) {
  const numeric = Number(percent);
  if (!Number.isFinite(numeric)) return;
  const nextPercent = Math.max(30, Math.min(70, numeric));
  setSplitSecondarySizePercent(nextPercent);
  if (editorShell?.style?.setProperty) {
    editorShell.style.setProperty(
      "--mfe-split-secondary-size",
      `${nextPercent}%`,
    );
  }
}

/**
 * Hydrates non-primary translation states for the active fullscreen scope.
 * Does not own split-pane creation or canonical save authority.
 */
export function hydrateTranslationsForActiveScope({
  reasonPrefix = "openSplit",
  buildTranslationHydrationKey,
  getActiveSessionStateKey,
  activeOriginFieldKey,
  activeOriginKey,
  activeFieldId,
  activeTarget,
  activeFieldScope,
  activeFieldSection,
  activeFieldSubsection,
  activeFieldName,
  pendingTranslationHydrationByKey,
  normalizeLangValue,
  getLanguagesConfig,
  fetchTranslations,
  isStateTraceEnabled,
  getDocumentStateForActiveField,
  ingestDocumentStateMarkdown,
}) {
  const translationLoadKey = buildTranslationHydrationKey({
    sessionStateId: getActiveSessionStateKey(),
    originKey: activeOriginFieldKey || activeOriginKey || activeFieldId || "",
    pageId: activeTarget?.getAttribute("data-page") || "0",
    scope: activeFieldScope || "field",
    section: activeFieldSection || "",
    subsection: activeFieldSubsection || "",
    name: activeFieldName || "",
  });
  if (!translationLoadKey) return Promise.resolve(false);
  const pending = pendingTranslationHydrationByKey.get(translationLoadKey);
  if (pending) {
    return pending;
  }

  const pageId = activeTarget?.getAttribute("data-page") || "";
  const currentLang = normalizeLangValue(getLanguagesConfig().current);
  const sessionStateKey = getActiveSessionStateKey();
  const run = fetchTranslations("document", pageId, "document", "")
    .then((data) => {
      const translations = data && typeof data === "object" ? data : {};
      Object.entries(translations).forEach(([lang, markdown]) => {
        const normalizedLang = normalizeLangValue(lang);
        if (!normalizedLang) {
          return;
        }
        if (normalizedLang === currentLang) {
          if (
            isStateTraceEnabled() &&
            typeof console !== "undefined" &&
            typeof console.info === "function"
          ) {
            console.info(
              "HYDRATE_SKIPPED_PRIMARY",
              JSON.stringify({
                reason: `${reasonPrefix}:hydrateTranslations`,
                language: normalizedLang,
                stateId: sessionStateKey
                  ? `${sessionStateKey}|${normalizedLang}`
                  : "",
              }),
            );
          }
          return;
        }
        const state = getDocumentStateForActiveField(normalizedLang, {
          reason: `${reasonPrefix}:hydrateStateBind`,
          trigger: "scope-navigation",
        });
        ingestDocumentStateMarkdown(state, String(markdown || ""), {
          lang: normalizedLang,
          source: `${reasonPrefix}:hydrateTranslations`,
          trigger: "system-rehydrate",
        });
      });
      return true;
    })
    .catch(() => false)
    .finally(() => {
      pendingTranslationHydrationByKey.delete(translationLoadKey);
    });

  pendingTranslationHydrationByKey.set(translationLoadKey, run);
  return run;
}

/**
 * Installs pointer handlers for resizing the fullscreen split panes.
 * Does not decide when split mode should open or close.
 */
export function setupSplitResizeHandle({
  splitHandle,
  editorShell,
  splitResizeCleanup,
  fullscreenEventRegistry,
  onResizePercent,
  setSplitResizeEventScope,
  setSplitResizeCleanup,
}) {
  if (!splitHandle || !editorShell || splitResizeCleanup) return;
  const splitResizeEventScope = fullscreenEventRegistry.createScope(
    "fullscreen-split-resize",
  );
  setSplitResizeEventScope(splitResizeEventScope);

  let dragging = false;
  const onPointerMove = (event) => {
    if (!dragging || !editorShell) return;
    const rect = editorShell.getBoundingClientRect();
    if (!rect.width) return;
    const handleWidth = splitHandle?.getBoundingClientRect?.().width || 14;
    const pointerX = Number(event.clientX || 0) - rect.left;
    const minPrimaryPx = 320;
    const minSecondaryPx = 320;
    const minPct = ((minSecondaryPx + handleWidth) / rect.width) * 100;
    const maxPct =
      100 - ((minPrimaryPx + handleWidth) / Math.max(1, rect.width)) * 100;
    const rawSecondaryPct = ((rect.width - pointerX) / rect.width) * 100;
    const clamped = Math.max(minPct, Math.min(maxPct, rawSecondaryPct));
    onResizePercent(clamped);
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("mfe-split-resizing");
  };

  const startDragging = (event) => {
    event.preventDefault();
    dragging = true;
    document.body.classList.add("mfe-split-resizing");
  };

  splitResizeEventScope.register(splitHandle, "pointerdown", startDragging);
  splitResizeEventScope.register(window, "pointermove", onPointerMove);
  splitResizeEventScope.register(window, "pointerup", stopDragging);
  splitResizeEventScope.register(window, "blur", stopDragging);

  setSplitResizeCleanup(() => {
    splitResizeEventScope?.disposeAll();
    setSplitResizeEventScope(null);
    setSplitResizeCleanup(null);
    document.body.classList.remove("mfe-split-resizing");
  });
}

/**
 * Builds and opens the fullscreen split-pane chrome for secondary language editing.
 * Does not own secondary language canonical mutation authority.
 */
export function openSplit({
  editorShell,
  secondaryEditor,
  getLanguagesConfig,
  normalizeLangValue,
  splitPreferredLanguage,
  splitSecondarySizePercent,
  applySplitSecondarySize,
  createEditorInstance,
  activeFieldType,
  activeFieldName,
  refreshToolbarState,
  setupSplitResizeHandle,
  hydrateTranslationsForActiveScope,
  setSecondaryLanguage,
  setSplitRegion,
  setSplitHandle,
  setSplitPane,
  setSecondaryEditor,
  setActiveEditor,
  getSecondaryEditor,
}) {
  if (!editorShell || secondaryEditor) return;
  const { langs, current } = getLanguagesConfig();
  const currentName = normalizeLangValue(current);
  const seen = new Set();
  const otherLangs = (Array.isArray(langs) ? langs : []).filter((lang) => {
    const name = normalizeLangValue(lang?.name);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return name !== currentName;
  });

  if (otherLangs.length === 0) return;

  editorShell.classList.add("mfe-editor-shell--split");
  applySplitSecondarySize(splitSecondarySizePercent);

  const splitRegion = document.createElement("div");
  splitRegion.className = "mfe-editor-split-region";

  const splitHandle = document.createElement("button");
  splitHandle.type = "button";
  splitHandle.className = "mfe-editor-split-handle";
  splitHandle.setAttribute("aria-label", "Resize language split panes");
  splitHandle.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M8 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M8 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M8 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M14 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M14 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M14 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /></svg>';

  const splitPane = document.createElement("div");
  splitPane.className = "mfe-editor-pane mfe-editor-pane--secondary";

  const header = document.createElement("div");
  header.className = "mfe-editor-pane-header";
  header.innerHTML = `
    <label class="mfe-editor-pane-label">Language</label>
    <select class="mfe-editor-pane-select"></select>
  `;

  const select = header.querySelector(".mfe-editor-pane-select");
  otherLangs.forEach((lang) => {
    const opt = document.createElement("option");
    opt.value = lang.name;
    const label =
      typeof lang.title === "string" && lang.title.trim() !== ""
        ? lang.title
        : String(lang.title || lang.name);
    opt.textContent = label;
    select.appendChild(opt);
  });
  if (otherLangs[0]) {
    const preferred = normalizeLangValue(splitPreferredLanguage);
    const preferredOption = otherLangs.find(
      (lang) => normalizeLangValue(lang?.name) === preferred,
    );
    select.value = preferredOption?.name || otherLangs[0].name;
  }

  const body = document.createElement("div");
  body.className = "mfe-editor-pane-body";

  splitPane.appendChild(header);
  splitPane.appendChild(body);
  splitRegion.appendChild(splitHandle);
  splitRegion.appendChild(splitPane);
  editorShell.appendChild(splitRegion);

  setSplitRegion(splitRegion);
  setSplitHandle(splitHandle);
  setSplitPane(splitPane);
  setupSplitResizeHandle();

  const nextSecondaryEditor = createEditorInstance(
    body,
    activeFieldType,
    activeFieldName,
  );
  setSecondaryEditor(nextSecondaryEditor);
  setActiveEditor(nextSecondaryEditor);
  if (typeof refreshToolbarState === "function") {
    refreshToolbarState();
  }

  select.onchange = () => {
    setSecondaryLanguage(select.value);
  };

  hydrateTranslationsForActiveScope("openSplit").finally(() => {
    if (getSecondaryEditor()) {
      setSecondaryLanguage(select.value);
    }
  });
}

/**
 * Tears down the fullscreen split-pane chrome and secondary editor shell.
 * Does not clear canonical state or translation session ownership.
 */
export function closeSplit({
  splitResizeCleanup,
  secondaryEditor,
  splitRegion,
  editorShell,
  primaryEditor,
  refreshToolbarState,
  setSecondaryEditor,
  setSplitRegion,
  setSplitPane,
  setSplitHandle,
  setActiveEditor,
}) {
  if (typeof splitResizeCleanup === "function") {
    splitResizeCleanup();
  }
  if (secondaryEditor) {
    secondaryEditor.destroy();
    setSecondaryEditor(null);
  }
  if (splitRegion) {
    splitRegion.remove();
    setSplitRegion(null);
  }
  setSplitPane(null);
  setSplitHandle(null);
  editorShell?.classList?.remove("mfe-editor-shell--split");
  setActiveEditor(primaryEditor);
  if (typeof refreshToolbarState === "function") {
    refreshToolbarState();
  }
}

/**
 * Toggles the fullscreen split-pane chrome state flag and delegates open/close work.
 * Does not bind translation state or mutate canonical markdown directly.
 */
export function toggleSplit({
  secondaryEditor,
  setSplitEnabledByUser,
  openSplit,
  closeSplit,
}) {
  if (secondaryEditor) {
    setSplitEnabledByUser(false);
    closeSplit();
  } else {
    setSplitEnabledByUser(true);
    openSplit();
  }
}

/**
 * Opens the image picker and applies the selected image change to the active editor.
 * Does not own fullscreen save authority outside the explicit editor mutation callbacks it invokes.
 */
export function openImagePicker({
  initialData = null,
  imagePos = null,
  getActiveEditor,
  getPrimaryEditor,
  getSecondaryEditor,
  getSecondaryLang,
  markUserIntentToken,
  debugWarn,
  statusManager,
  traceStateMutation,
  normalizeLangValue,
  getLanguagesConfig,
  captureExplicitApplyScopeMeta,
  getDocumentStateForActiveField,
  getMarkdownFromEditor,
  applyMarkdownToStateForReferenceScope,
  normalizeComparableMarkdown,
  getDocumentConfigMarkdownRaw,
  setDocumentDraftMarkdown,
  getActiveScopedHtmlKey,
  draftMarkdownByScopedKey,
  activeFieldId,
  afterNextPaint,
}) {
  const editor = getActiveEditor() || getPrimaryEditor();
  if (!editor) return;

  createImagePicker({
    initialData,
    onSelect: (imageData) => {
      const activeEditor = getActiveEditor() || getPrimaryEditor();
      if (!activeEditor) return;
      markUserIntentToken("image-picker:select");

      if (imageData._resolveWarning) {
        debugWarn(
          "[mfe:image-picker] resolve warning",
          String(imageData._resolveWarning || ""),
        );
        statusManager.setError("There was an error processing the image.");
      }

      let shouldReplaceSelectedImage = false;
      if (typeof imagePos === "number") {
        const imageNode = activeEditor.state.doc.nodeAt(imagePos);
        if (imageNode && imageNode.type.name === "image") {
          const tr = activeEditor.state.tr.setSelection(
            NodeSelection.create(activeEditor.state.doc, imagePos),
          );
          activeEditor.view.dispatch(tr);
          shouldReplaceSelectedImage = true;
        }
      }
      if (!shouldReplaceSelectedImage) {
        const { selection } = activeEditor.state;
        shouldReplaceSelectedImage =
          selection.node && selection.node.type.name === "image";
      }

      if (shouldReplaceSelectedImage) {
        activeEditor
          .chain()
          .focus()
          .updateAttributes("image", {
            src: imageData.url,
            alt: imageData.alt || "",
            originalFilename: imageData.filename,
          })
          .run();
      } else {
        activeEditor
          .chain()
          .focus()
          .setImage({
            src: imageData.url,
            alt: imageData.alt || "",
            originalFilename: imageData.filename,
          })
          .run();
      }

      if (activeEditor === getPrimaryEditor()) {
        traceStateMutation({
          reason: "openImagePicker:onSelect",
          trigger: "user-edit",
          mutate: () => {
            const currentLang = normalizeLangValue(
              getLanguagesConfig().current,
            );
            const applyScopeMeta = captureExplicitApplyScopeMeta(
              "openImagePicker:onSelect:primary",
            );
            const scopeKind = applyScopeMeta.scopeKind;
            const primaryState = getDocumentStateForActiveField(currentLang, {
              reason: "openImagePicker:onSelect:primary:bind",
              trigger: "scope-navigation",
            });
            if (primaryState) {
              const primaryMarkdown = getMarkdownFromEditor(activeEditor);
              applyMarkdownToStateForReferenceScope(
                primaryState,
                primaryMarkdown,
                scopeKind,
                "openImagePicker:onSelect:primary",
                {
                  trigger: "user-command",
                  applyScopeMeta,
                  requireExplicitScope: true,
                },
              );
              const nextDocumentDraft = primaryState.recomposeMarkdownForSave(
                primaryState.getDraft(),
              );
              if (
                normalizeComparableMarkdown(nextDocumentDraft) ===
                normalizeComparableMarkdown(getDocumentConfigMarkdownRaw())
              ) {
                setDocumentDraftMarkdown("");
              } else {
                setDocumentDraftMarkdown(nextDocumentDraft);
              }
            }
            const scopedKey = getActiveScopedHtmlKey();
            if (scopedKey) {
              draftMarkdownByScopedKey.set(
                scopedKey,
                getMarkdownFromEditor(activeEditor),
              );
            }
            if (activeFieldId) {
              statusManager.markDirty(activeFieldId);
            }
          },
        });
      }
      if (
        activeEditor === getSecondaryEditor() &&
        getSecondaryLang()
      ) {
        const secondaryState = getDocumentStateForActiveField(getSecondaryLang());
        const applyScopeMeta = captureExplicitApplyScopeMeta(
          "openImagePicker:onSelect:secondary",
        );
        const secondaryScopeKind = applyScopeMeta.scopeKind;
        if (secondaryState) {
          applyMarkdownToStateForReferenceScope(
            secondaryState,
            getMarkdownFromEditor(activeEditor),
            secondaryScopeKind,
            "openImagePicker:onSelect:secondary",
            {
              trigger: "user-command",
              applyScopeMeta,
              requireExplicitScope: true,
            },
          );
        }
      }
    },
    onClose: () => {
      afterNextPaint(() => editor.view.focus());
    },
  });
}

/**
 * Builds the fullscreen toolbar and wires view-toggle controls to the active editors.
 * Does not own fullscreen lifecycle or canonical save routing.
 */
export function createToolbar({
  getActiveEditor,
  saveAllEditors,
  toggleSplit,
  isSplitEnabled,
  openDocumentOutlineView,
  getActiveSession,
  getActiveFieldScope,
  isDocumentScopeActive,
  isOutlineViewActive,
  toggleOutlineView,
  setRefreshToolbarState,
  setSaveStatusEl,
  statusManager,
}) {
  const toolbar = document.createElement("div");
  toolbar.id = "editor-toolbar";
  toolbar.className = "mfe-toolbar";
  toolbar.setAttribute("data-editor-toolbar", "true");

  const buttons = createToolbarButtons({
    getEditor: getActiveEditor,
    onSave: saveAllEditors,
    onToggleSplit: toggleSplit,
    isSplitActive: () => Boolean(isSplitEnabled()),
    onOpenDocumentView: openDocumentOutlineView,
    canOpenDocumentView: () => {
      const scopeKind =
        getActiveSession()?.metadata?.scopeKind || getActiveFieldScope() || "field";
      return scopeKind !== "document";
    },
    isDocumentView: () => isDocumentScopeActive() && isOutlineViewActive(),
    onToggleOutlineView: toggleOutlineView,
    isOutlineView: () => isOutlineViewActive(),
  });

  const baseConfigButtons =
    window.MarkdownFrontEditorConfig?.toolbarButtons ||
    "bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,|,code,codeblock,clear,|,split,document,outline";
  const normalizedConfigButtons = String(baseConfigButtons || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry === "markers" ? "outline" : entry));
  if (!normalizedConfigButtons.includes("document")) {
    normalizedConfigButtons.push("document");
  }
  if (!normalizedConfigButtons.includes("outline")) {
    normalizedConfigButtons.push("outline");
  }
  const configButtons = normalizedConfigButtons.join(",");
  const { statusEl, refreshButtons } = renderToolbarButtons({
    toolbar,
    buttons,
    configButtons,
    getEditor: getActiveEditor,
  });
  setRefreshToolbarState(refreshButtons);
  setSaveStatusEl(statusEl);
  statusManager.registerStatusEl(statusEl);

  return toolbar;
}

/**
 * Registers fullscreen keyboard shortcuts against the shared session event scope.
 * Does not interpret editor changes beyond dispatching the existing editor commands.
 */
export function setupKeyboardShortcuts({
  getDisposeFullscreenKeydown,
  setDisposeFullscreenKeydown,
  getFullscreenSessionEventScope,
  setFullscreenSessionEventScope,
  fullscreenEventRegistry,
  getActiveEditor,
  saveAllEditors,
}) {
  const disposeFullscreenKeydown = getDisposeFullscreenKeydown();
  if (disposeFullscreenKeydown) {
    disposeFullscreenKeydown();
    setDisposeFullscreenKeydown(null);
  }

  const onFullscreenKeydown = (event) => {
    const activeEditor = getActiveEditor();
    if (!activeEditor) return;

    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      event.stopPropagation();
      saveAllEditors();
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      switch (event.key.toLowerCase()) {
        case "b":
          event.preventDefault();
          activeEditor.chain().focus().toggleBold().run();
          return;
        case "i":
          event.preventDefault();
          activeEditor.chain().focus().toggleItalic().run();
          return;
        case "k": {
          event.preventDefault();
          const url = prompt("Enter URL:");
          if (url) {
            activeEditor.chain().focus().setLink({ href: url }).run();
          }
          return;
        }
      }
    }
  };

  let fullscreenSessionEventScope = getFullscreenSessionEventScope();
  if (!fullscreenSessionEventScope) {
    fullscreenSessionEventScope =
      fullscreenEventRegistry.createScope("fullscreen-session");
    setFullscreenSessionEventScope(fullscreenSessionEventScope);
  }
  setDisposeFullscreenKeydown(
    fullscreenSessionEventScope.register(
      document,
      "keydown",
      onFullscreenKeydown,
      true,
    ),
  );
}
