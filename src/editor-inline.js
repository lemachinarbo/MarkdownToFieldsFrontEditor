import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { common, createLowlight } from "lowlight";
import { NodeSelection } from "prosemirror-state";
import {
  shouldWarnForExtraContent,
  countSignificantTopLevelBlocks,
  parseMarkdownToDoc,
  decodeMarkdownBase64,
  decodeHtmlEntitiesInFences,
  trimTrailingLineBreaks,
  getLanguagesConfig,
  saveTranslation,
} from "./editor-core.js";
import {
  InlineHtmlLabelExtension,
  MarkerAwareBold,
  UnderlineMark,
  SuperscriptMark,
  SubscriptMark,
  MarkerAwareItalic,
  createMfeImageExtension,
} from "./editor-tiptap-extensions.js";
import {
  getMetaAttr,
  getImageBaseUrl,
  normalizeFieldHostIdentity,
  setOriginalBlockCount,
  getOriginalBlockCount,
  applyFieldAttributes,
  stripTrailingEmptyParagraph,
  getMarkdownFromEditor,
} from "./editor-shared-helpers.js";
import { Marker, GapSentinel } from "./marker-extension.js";
import { createToolbarButtons } from "./editor-toolbar.js";
import { renderToolbarButtons } from "./editor-toolbar-renderer.js";
import {
  openFullscreenForTarget,
  openInlineForTarget,
  isFullscreenOpen,
} from "./host-router.js";
import {
  setInlineShellOpen,
  setInlineDebugShell,
  setInlineLabelStyle,
} from "./inline-shell.js";
import { createOverlayEngine } from "./overlay-engine.js";
import { resolveDblclickAction } from "./scope-resolver.js";
import { scopedHtmlKeyFromMeta } from "./sync-by-key.js";
import {
  createScope,
  createView,
  createHost,
  resolveSession,
} from "./session-resolver.js";
import {
  createMenubarShell,
  attachToolbarToMenubarInner,
} from "./editor-menubar.js";
import {
  getSectionEntry,
  getSubsectionEntry,
  getFieldsIndex,
} from "./content-index.js";
import { createImagePicker } from "./image-picker.js";
import {
  registerStatusEl,
  markDirty,
  clearDirty,
  setSaved,
  setNoChanges,
  setError,
} from "./editor-status.js";
import {
  CANONICAL_SCOPE_SET,
  assertCanonicalPayloadSchema,
} from "./canonical-contract.js";
import {
  HeadingSingleLineExtension,
  SingleBlockDocumentExtension,
  createSingleBlockEnterToastExtension,
} from "./field-constraints-extension.js";
import {
  isHostDebugClicksEnabled,
  isHostDebugLabelsEnabled,
  isHostFlagEnabled,
} from "./host-env.js";
import { parseDataMfe } from "./identity-resolver.js";
import { afterNextPaint } from "./async-queue.js";
import { assertOk, getDataOrThrow } from "./network.js";
import { createEventRegistry } from "./event-registry.js";
import { createInlineStateAdapter } from "./inline-state-adapter.js";
import { getDocumentState } from "./document-state.js";
import { createTransactionGuardExtension } from "./transaction-guard-extension.js";

let activeEditor = null;
let activeTarget = null;
let activeFieldName = null;
let activeFieldType = null;
let activeFieldScope = "field";
let activeFieldSection = "";
let activeFieldSubsection = "";
let activeScopeKey = "";
let isClosingInlineEditor = false;
let toolbarEl = null;
let toolbarStatusEl = null;
let toolbarCloseBtn = null;
const inlineEventRegistry = createEventRegistry();
let inlineRuntimeEventScope = null;
let inlineRuntimeEventsBound = false;
let hoverRaf = null;
let lastHoverKey = "";
let lastHoverRect = null;
let pendingLinkNavigation = null;
let debugLabels = isHostDebugLabelsEnabled();
const debugClicks = isHostDebugClicksEnabled();
const overlayEngine = createOverlayEngine({ debugLabels });
let allowSystemTransactionDepth = 0;
let lastInlineEditorInputAt = 0;
let lastInlineEditorInputSource = "none";
let lastInlineIntentAt = 0;
let lastInlineIntentSource = "none";

function markInlineEditorInputSource(source) {
  lastInlineEditorInputAt = Date.now();
  lastInlineEditorInputSource = String(source || "unknown");
  markInlineIntentToken(`editor:${lastInlineEditorInputSource}`);
}

function markInlineIntentToken(source) {
  lastInlineIntentAt = Date.now();
  lastInlineIntentSource = String(source || "ui");
}

function resolveInlineUpdateSource(transaction) {
  const now = Date.now();
  const fromRecentEditorInput = now - lastInlineEditorInputAt <= 1500;
  const fromRecentIntent = now - lastInlineIntentAt <= 1500;
  const uiEvent = String(transaction?.getMeta?.("uiEvent") || "");
  const pointer = Boolean(transaction?.getMeta?.("pointer"));
  const docChanged = Boolean(transaction?.docChanged);
  if (fromRecentEditorInput || (fromRecentIntent && docChanged)) {
    return {
      source: "human",
      inputSource: lastInlineEditorInputSource,
      intentSource: lastInlineIntentSource,
      uiEvent,
      pointer,
      docChanged,
    };
  }
  return {
    source: "system",
    inputSource: lastInlineEditorInputSource,
    intentSource: lastInlineIntentSource,
    uiEvent,
    pointer,
    docChanged,
  };
}

function shouldBlockInlineTransaction(transaction) {
  if (!transaction?.docChanged) return false;
  if (allowSystemTransactionDepth > 0) return false;
  const updateSource = resolveInlineUpdateSource(transaction);
  return updateSource.source !== "human";
}

function reportInlineTransactionBlocked(transaction) {
  const updateSource = resolveInlineUpdateSource(transaction);
  const payload = {
    type: "MFE_TX_GUARD_BLOCKED",
    host: "inline",
    scope: activeFieldScope || "",
    fieldId: activeFieldId || "",
    uiEvent: String(updateSource.uiEvent || ""),
    pointer: Boolean(updateSource.pointer),
    inputSource: String(updateSource.inputSource || ""),
    intentSource: String(updateSource.intentSource || ""),
    docChanged: Boolean(updateSource.docChanged),
    stepCount: Array.isArray(transaction?.steps) ? transaction.steps.length : 0,
  };
  if (isHostFlagEnabled("debug")) {
    try {
      console.warn("MFE_TX_GUARD_BLOCKED", JSON.stringify(payload));
    } catch (_error) {
      // noop
    }
  }
}

function isDblclickDebugEnabled() {
  return isHostFlagEnabled("debug");
}

function toDblclickTargetDebug(element) {
  if (!(element instanceof Element)) return null;
  return {
    scope: getMetaAttr(element, "scope") || "",
    section: getMetaAttr(element, "section") || "",
    subsection: getMetaAttr(element, "subsection") || "",
    name: getMetaAttr(element, "name") || "",
    page: element.getAttribute("data-page") || "",
    fieldType: element.getAttribute("data-field-type") || "",
    source: element.getAttribute("data-mfe-source") || "",
    sourcePath: element.getAttribute("data-mfe") || "",
    inlineActiveClass: element.classList.contains("mfe-inline-active"),
    classes: element.className || "",
  };
}

function debugInlineDblclick({ event, hit, action, reason }) {
  if (!isDblclickDebugEnabled()) return;
  console.info("[mfe:dblclick:inline]", {
    reason,
    modifiers: {
      ctrl: Boolean(event?.ctrlKey),
      meta: Boolean(event?.metaKey),
      shift: Boolean(event?.shiftKey),
      alt: Boolean(event?.altKey),
    },
    detail: Number(event?.detail || 0),
    hit: toDblclickTargetDebug(hit),
    action: action
      ? {
          type: action.action || "",
          target: toDblclickTargetDebug(action.target || null),
        }
      : null,
  });
}

let dirty = false;
const originalBlockCounts = new WeakMap();
const originalHtml = new WeakMap();
let activeFieldId = null;
let suppressUpdates = false;
const inlineState = createInlineStateAdapter();
const inlineDocumentStates = new Map();

function findFieldEntry({ name, section = "", subsection = "" }) {
  const fields = getFieldsIndex().filter(
    (f) => (f?.name || "") === (name || ""),
  );
  if (!fields.length) return null;

  let matches = fields;
  if (section) {
    matches = matches.filter((f) => (f?.section || "") === section);
  }
  if (subsection) {
    matches = matches.filter((f) => (f?.subsection || "") === subsection);
  }
  if (matches.length) return matches[0];

  if (!section && !subsection) {
    const topLevel = fields.find((f) => !(f?.section || ""));
    if (topLevel) return topLevel;
  }
  return fields[0];
}

function resolveDataMfe(parsed) {
  if (!parsed) return null;

  if (parsed.scope === "section") {
    const entry = getSectionEntry(parsed.name);
    return {
      scope: "section",
      name: parsed.name,
      section: "",
      subsection: "",
      b64: entry?.markdownB64 || "",
    };
  }

  if (parsed.scope === "subsection") {
    const subEntry = getSubsectionEntry(parsed.section, parsed.name);
    return {
      scope: "subsection",
      name: parsed.name,
      section: parsed.section || "",
      subsection: "",
      b64: subEntry?.markdownB64 || "",
    };
  }

  if (parsed.scope === "field") {
    const fieldEntry = findFieldEntry({
      name: parsed.name,
      section: parsed.section || "",
      subsection: parsed.subsection || "",
    });
    if (!fieldEntry) return null;
    return {
      scope: "field",
      name: fieldEntry.name || "",
      section: fieldEntry.section || "",
      subsection: fieldEntry.subsection || "",
      b64: fieldEntry.markdownB64 || "",
      fieldType:
        fieldEntry.kind === "container" || fieldEntry.type === "container"
          ? "container"
          : "tag",
    };
  }

  if (parsed.scope === "auto") {
    const fieldEntry = findFieldEntry({
      name: parsed.name,
      section: parsed.section || "",
      subsection: parsed.subsection || "",
    });
    if (fieldEntry) {
      return {
        scope: "field",
        name: fieldEntry.name || "",
        section: fieldEntry.section || "",
        subsection: fieldEntry.subsection || "",
        b64: fieldEntry.markdownB64 || "",
        fieldType:
          fieldEntry.kind === "container" || fieldEntry.type === "container"
            ? "container"
            : "tag",
      };
    }

    if (parsed.section) {
      const subEntry = getSubsectionEntry(parsed.section, parsed.name);
      if (subEntry) {
        return {
          scope: "subsection",
          name: parsed.name,
          section: parsed.section || "",
          subsection: "",
          b64: subEntry.markdownB64 || "",
        };
      }
    }

    const secEntry = getSectionEntry(parsed.name);
    if (secEntry) {
      return {
        scope: "section",
        name: parsed.name,
        section: "",
        subsection: "",
        b64: secEntry.markdownB64 || "",
      };
    }
  }

  return null;
}

function findDataMfeTargetFromPoint(x, y) {
  const stack =
    typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(x, y)
      : [];
  const hit = stack.find((el) => el?.closest?.("[data-mfe]"));
  const host = hit?.closest ? hit.closest("[data-mfe]") : null;
  if (!host) return null;
  const parsed = parseDataMfe(host.getAttribute("data-mfe"));
  const resolved = resolveDataMfe(parsed);
  if (!resolved) return null;
  const hostRect = host.getBoundingClientRect();
  const hasBox =
    hostRect &&
    Number.isFinite(hostRect.left) &&
    Number.isFinite(hostRect.right) &&
    Number.isFinite(hostRect.top) &&
    Number.isFinite(hostRect.bottom) &&
    hostRect.right > hostRect.left &&
    hostRect.bottom > hostRect.top;
  const rect = hasBox ? hostRect : getRectFromChildren(host) || hostRect;
  return {
    scope: resolved.scope,
    name: resolved.name,
    section: resolved.section || "",
    subsection: resolved.subsection || "",
    b64: resolved.b64 || "",
    fieldType: resolved.fieldType || "",
    rect,
  };
}

function findTargetFromPoint(x, y) {
  const dataMfeTarget = findDataMfeTargetFromPoint(x, y);
  if (dataMfeTarget) return dataMfeTarget;
  return null;
}

function createVirtualTarget({
  pageId,
  scope,
  name,
  section = "",
  subsection = "",
  fieldType = "",
  markdown,
}) {
  const el = document.createElement("div");
  el.className = "fe-editable md-edit mfe-virtual";
  el.setAttribute("data-page", pageId);
  el.setAttribute("data-mfe-scope", scope);
  el.setAttribute("data-mfe-name", name);
  if (fieldType) {
    el.setAttribute("data-field-type", fieldType);
  }
  if (section) {
    el.setAttribute("data-mfe-section", section);
  }
  if (subsection) {
    el.setAttribute("data-mfe-subsection", subsection);
  }
  if (markdown !== undefined) {
    el.setAttribute(
      "data-markdown-b64",
      btoa(unescape(encodeURIComponent(markdown))),
    );
  }
  return el;
}

function getEditLabel(scope, name, section, subsection = "") {
  if (!debugLabels) return "Double click to edit";
  if (scope === "subsection") {
    return `subsection:${section}:${name}`;
  }
  if (scope === "section") {
    return `section:${name}`;
  }
  if (scope === "field" && section && subsection) {
    return `field:${section}:${subsection}:${name}`;
  }
  if (section) {
    return `${scope}:${section}:${name}`;
  }
  if (name) {
    return `${scope}:${name}`;
  }
  return `${scope}`;
}

function applyEditLabelAttributes(el) {
  if (!el) return;
  const scope = getMetaAttr(el, "scope") || "field";
  const name = getMetaAttr(el, "name") || "";
  const section = getMetaAttr(el, "section") || "";
  const subsection = getMetaAttr(el, "subsection") || "";
  const label = getEditLabel(scope, name, section, subsection);
  el.setAttribute("data-mfe-label", label);
}

function applyDataMfeLabelAttributes(el) {
  if (!el) return;
  const parsed = parseDataMfe(el.getAttribute("data-mfe"));
  const resolved = resolveDataMfe(parsed);
  if (!resolved) return;
  const label = getEditLabel(
    resolved.scope,
    resolved.name,
    resolved.section || "",
    resolved.subsection || "",
  );
  el.setAttribute("data-mfe-label", label);
}

function getRectFromChildren(el) {
  const children = Array.from(el.children);
  if (!children.length) return null;
  const rects = children.map((c) => c.getBoundingClientRect());
  return rects.reduce(
    (acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

function inflateRect(rect, padding = 48) {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding,
  };
}

function isPointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isInEditableZone(node) {
  if (!node?.closest) return false;
  return Boolean(node.closest(".fe-editable") || node.closest("[data-mfe]"));
}

function clearPendingLinkNavigation() {
  if (!pendingLinkNavigation) return;
  window.clearTimeout(pendingLinkNavigation.timer);
  pendingLinkNavigation = null;
}

function navigateFromLink(link, clickEvent) {
  const href = link.getAttribute("href");
  if (!href || href === "#") return;
  const target = (link.getAttribute("target") || "").toLowerCase();
  if (target === "_blank") {
    window.open(href, "_blank", "noopener");
    return;
  }
  if (clickEvent?.metaKey || clickEvent?.ctrlKey) {
    window.open(href, "_blank");
    return;
  }
  window.location.assign(href);
}

function buildFieldId({ pageId, scope, section, name }) {
  const parts = [
    String(pageId || ""),
    scope || "field",
    section || "",
    name || "",
  ];
  return parts.map((part) => encodeURIComponent(part)).join("|");
}

function parseFieldId(fieldId) {
  const [pageId, scope, section, name] = fieldId
    .split("|")
    .map((part) => decodeURIComponent(part || ""));
  return {
    pageId,
    scope: scope || "field",
    section: section || "",
    name: name || "",
  };
}

function buildScopeKey({ scope, section, subsection, name }) {
  return scopedHtmlKeyFromMeta(
    scope || "field",
    section || "",
    subsection || "",
    name || "",
  );
}

function ensureInlineDocumentState(field, fallbackTarget = null) {
  const fieldId = buildFieldId({
    pageId: field.pageId,
    scope: field.scope,
    section: field.section,
    name: field.name,
  });
  if (!fieldId) return null;
  if (inlineDocumentStates.has(fieldId)) {
    return { fieldId, docState: inlineDocumentStates.get(fieldId) };
  }
  const target =
    fallbackTarget ||
    inlineState.getFieldElement(fieldId) ||
    activeTarget ||
    null;
  if (!target) return null;
  const { current: lang } = getLanguagesConfig();
  const session = resolveSession({
    pageId: field.pageId,
    section: field.section,
    subsection: field.subsection,
    name: field.name,
    scope: field.scope,
    target,
  });
  const payloadMeta = {
    element: target,
    pageId: field.pageId,
    fieldScope: field.scope,
    fieldSection: field.section,
    fieldSubsection: field.subsection,
    fieldName: field.name,
    sessionId: session.sessionKey,
  };
  const initialPersistedMarkdown =
    inlineState.getOriginalMarkdown(fieldId) || target.dataset.markdown || "";
  const docState = getDocumentState(inlineDocumentStates, payloadMeta, lang, {
    reason: "inline-field-bind",
    trigger: "scope-navigation",
    currentScope: field.scope || "field",
    initialPersistedMarkdown,
    initialDraftMarkdown: initialPersistedMarkdown,
  });
  inlineDocumentStates.set(fieldId, docState);
  return { fieldId, docState };
}

function setCanonicalInlineDraft(field, markdown, fallbackTarget = null) {
  const entry = ensureInlineDocumentState(field, fallbackTarget);
  if (!entry) return null;
  const { fieldId, docState } = entry;
  const scopeKey = buildScopeKey(field);
  docState.setDraft(markdown, {
    reason: "inline-draft-update",
    trigger: "user-edit-transaction",
    currentScope: field.scope || "field",
  });
  return { fieldId, scopeKey };
}

function buildDeterministicTargetKeyMap() {
  const out = new Map();
  for (const [fieldId, el] of inlineState.getFieldElementEntries()) {
    if (!fieldId || !el) continue;
    out.set(fieldId, el);
    const scope = getMetaAttr(el, "scope") || "field";
    const section = getMetaAttr(el, "section") || "";
    const subsection = getMetaAttr(el, "subsection") || "";
    const name = getMetaAttr(el, "name") || "";
    const scopeKey = buildScopeKey({ scope, section, subsection, name });
    if (scopeKey) {
      out.set(scopeKey, el);
    }
  }
  return out;
}

function renderDraftHtml(editor) {
  if (!editor) return "";
  const html = editor.getHTML();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const replacements = [
    { re: /<br\s*\/?>/gi, tag: "br" },
    { re: /<\/br>/gi, tag: "br" },
  ];

  const shouldSkip = (node) => {
    const parent = node.parentElement;
    if (!parent) return false;
    return parent.closest("code, pre");
  };

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  nodes.forEach((textNode) => {
    if (shouldSkip(textNode)) return;
    const text = textNode.nodeValue || "";
    let parts = [{ text }];

    replacements.forEach(({ re, tag }) => {
      const nextParts = [];
      parts.forEach((part) => {
        if (!part.text) {
          nextParts.push(part);
          return;
        }
        const segments = part.text.split(re);
        segments.forEach((seg, idx) => {
          if (seg) nextParts.push({ text: seg });
          if (idx < segments.length - 1) nextParts.push({ tag });
        });
      });
      parts = nextParts;
    });

    if (parts.length === 1 && parts[0].text === text) return;

    const frag = doc.createDocumentFragment();
    parts.forEach((part) => {
      if (part.tag) {
        frag.appendChild(doc.createElement(part.tag));
      } else if (part.text) {
        frag.appendChild(doc.createTextNode(part.text));
      }
    });
    textNode.parentNode.replaceChild(frag, textNode);
  });

  return doc.body.innerHTML;
}
function ensureInlineRuntimeEventScope() {
  if (inlineRuntimeEventScope) return inlineRuntimeEventScope;
  inlineRuntimeEventScope = inlineEventRegistry.createScope("inline-runtime");
  return inlineRuntimeEventScope;
}

function confirmDiscardChanges() {
  if (!dirty) return true;
  return window.confirm("You have unsaved changes. Discard them and close?");
}

const EscapeKeyExtension = Extension.create({
  name: "escapeKeyExtension",
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        closeInlineEditor({ saveOnClose: false, promptOnClose: true });
        return true;
      },
    };
  },
});

function highlightExtraContent(editor = activeEditor) {
  if (!editor) return;

  if (!shouldWarnForExtraContent(activeFieldType, activeFieldName)) {
    if (editor?.view?.dom) {
      editor.view.dom.removeAttribute("data-extra-warning-active");
    }
    return;
  }

  const currentBlockCount = countSignificantTopLevelBlocks(editor.state.doc);
  const originalCount = getOriginalBlockCount(editor, originalBlockCounts);

  if (currentBlockCount <= originalCount) {
    editor.view.dom.setAttribute("data-extra-warning-active", "false");
    return;
  }

  editor.view.dom.setAttribute("data-extra-warning-active", "true");
}

const EXTRA_SCOPE_SAVE_ERROR =
  "Can't save yet. Keep only the first line here, then save again.";

function hasBlockingExtraContent(editor = activeEditor) {
  if (!editor) return false;
  if (!shouldWarnForExtraContent(activeFieldType, activeFieldName))
    return false;
  const currentBlockCount = countSignificantTopLevelBlocks(editor.state.doc);
  const originalCount = getOriginalBlockCount(editor, originalBlockCounts);
  return currentBlockCount > originalCount;
}

function createEditorInstance(host, fieldType, fieldName) {
  const restrictToSingleBlock = shouldWarnForExtraContent(fieldType, fieldName);
  const starterKitOptions = {
    bold: false,
    codeBlock: false,
    italic: false,
    link: false,
    underline: false,
    ...(restrictToSingleBlock ? { document: false } : {}),
  };
  const lowlight = createLowlight(common);
  const SingleBlockEnterToastExtension =
    createSingleBlockEnterToastExtension(setError);
  const ImageExtension = createMfeImageExtension(getImageBaseUrl);

  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure(starterKitOptions),
      MarkerAwareBold,
      MarkerAwareItalic,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      ...(restrictToSingleBlock ? [SingleBlockDocumentExtension] : []),
      UnderlineMark,
      SuperscriptMark,
      SubscriptMark,
      Marker,
      GapSentinel,
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
      }),
      ImageExtension,
      InlineHtmlLabelExtension,
      ...(restrictToSingleBlock ? [SingleBlockEnterToastExtension] : []),
      HeadingSingleLineExtension,
      EscapeKeyExtension,
      createTransactionGuardExtension({
        name: "mfeInlineTxGuard",
        shouldBlockTransaction: shouldBlockInlineTransaction,
        onBlockedTransaction: reportInlineTransactionBlocked,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "mfe-inline-editor",
        spellcheck: "false",
      },
    },
  });

  applyFieldAttributes(editor, fieldType, fieldName);

  editor.on("focus", () => {
    activeEditor = editor;
  });

  if (inlineRuntimeEventScope) {
    inlineRuntimeEventScope.register(editor.view.dom, "beforeinput", () =>
      markInlineEditorInputSource("beforeinput"),
    );
    inlineRuntimeEventScope.register(editor.view.dom, "input", () =>
      markInlineEditorInputSource("input"),
    );
    inlineRuntimeEventScope.register(editor.view.dom, "keydown", () =>
      markInlineEditorInputSource("keydown"),
    );
    inlineRuntimeEventScope.register(editor.view.dom, "paste", () =>
      markInlineEditorInputSource("paste"),
    );
    inlineRuntimeEventScope.register(editor.view.dom, "drop", () =>
      markInlineEditorInputSource("drop"),
    );
    inlineRuntimeEventScope.register(editor.view.dom, "compositionend", () =>
      markInlineEditorInputSource("compositionend"),
    );
  }

  editor.on("update", ({ transaction }) => {
    if (suppressUpdates) return;
    if (!transaction?.docChanged) return;
    const updateSource = resolveInlineUpdateSource(transaction);
    if (updateSource.source !== "human") {
      return;
    }
    highlightExtraContent(editor);
    if (shouldWarnForExtraContent(fieldType, fieldName)) {
      stripTrailingEmptyParagraph(editor);
    }
    dirty = true;
    if (activeFieldId) {
      markDirty(activeFieldId);
    }
    if (activeScopeKey) {
      inlineState.setDraft(activeScopeKey, editor.getJSON());
      const activeField = parseFieldId(activeFieldId || "");
      const markdown = decodeHtmlEntitiesInFences(
        getMarkdownFromEditor(editor),
      );
      setCanonicalInlineDraft(activeField, markdown, activeTarget);
    }
  });

  return editor;
}

function saveAllDrafts({ showStatus = true } = {}) {
  if (hasBlockingExtraContent(activeEditor)) {
    setError(EXTRA_SCOPE_SAVE_ERROR);
    return Promise.resolve();
  }

  if (activeEditor && activeScopeKey && activeFieldId) {
    const activeField = parseFieldId(activeFieldId);
    const markdown = decodeHtmlEntitiesInFences(
      getMarkdownFromEditor(activeEditor),
    );
    setCanonicalInlineDraft(activeField, markdown, activeTarget);
  }

  const entries = [];
  for (const [scopeKey, meta] of inlineState.scopeMetaByKey.entries()) {
    if (!meta) continue;
    const { pageId, name, scope, section, subsection, fieldId } = meta;
    if (!pageId || !name) continue;
    const stateEntry = ensureInlineDocumentState(
      {
        pageId,
        scope: scope || "field",
        section: section || "",
        subsection: subsection || "",
        name,
      },
      inlineState.getFieldElement(fieldId || "") || null,
    );
    const docState = stateEntry?.docState || null;
    if (!docState || !docState.isDirty()) continue;
    const normalizedMarkdown = trimTrailingLineBreaks(
      String(docState.getDraft() || ""),
    );
    entries.push([scopeKey, normalizedMarkdown]);
  }

  if (entries.length === 0) {
    if (showStatus) setNoChanges();
    return Promise.resolve();
  }

  const grouped = new Map();
  entries.forEach(([scopeKey, markdown]) => {
    const meta = inlineState.getScopeMeta(scopeKey);
    if (!meta) return;
    const { pageId, name, scope, section, subsection, fieldId } = meta;
    if (!pageId || !name) return;
    if (!grouped.has(pageId)) grouped.set(pageId, []);
    const normalizedMarkdown = trimTrailingLineBreaks(markdown);
    grouped.get(pageId).push({
      key: scopeKey,
      fieldId,
      name,
      scope: scope || "field",
      section: section || "",
      subsection: subsection || "",
      markdown: normalizedMarkdown,
    });
  });

  const batchSaves = Array.from(grouped.entries()).map(([pageId, fields]) =>
    saveBatch(pageId, fields),
  );

  return batchSaves
    .reduce((chain, task) => chain.then(() => task), Promise.resolve())
    .then(() => {
      dirty = false;
      if (showStatus) setSaved();
    })
    .catch((err) => {
      // save errors are handled by caller
      if (showStatus) setError();
    });
}

function saveBatch(pageId, fields) {
  const fieldsByKey = new Map();
  fields.forEach((field) => {
    if (!field?.key) return;
    fieldsByKey.set(field.key, field);
  });
  const { current } = getLanguagesConfig();
  return fields.reduce(
    (chain, field) =>
      chain
        .then(() =>
          saveTranslation(
            pageId,
            field.scope === "document" ? "document" : field.name,
            current,
            field.markdown,
            field.scope || "field",
            field.section || "",
            field.subsection || "",
            field.fieldId || "",
          ),
        )
        .then((result) => {
          const data = getDataOrThrow(assertOk(result));
          if (!data.status) throw new Error(data.message || "Save failed");

          if (data.sectionsIndex) {
            window.MarkdownFrontEditorConfig =
              window.MarkdownFrontEditorConfig || {};
            window.MarkdownFrontEditorConfig.sectionsIndex = data.sectionsIndex;
          }
          if (data.fieldsIndex) {
            window.MarkdownFrontEditorConfig =
              window.MarkdownFrontEditorConfig || {};
            window.MarkdownFrontEditorConfig.fieldsIndex = data.fieldsIndex;
          }

          const htmlMap =
            data.htmlMap || (typeof data.html === "object" ? data.html : {});
          const targetsByKey = buildDeterministicTargetKeyMap();
          Object.entries(htmlMap).forEach(([fieldKey, html]) => {
            const target = targetsByKey.get(fieldKey);
            if (!target) return;
            const scope = getMetaAttr(target, "scope") || "field";
            const section = getMetaAttr(target, "section") || "";
            const subsection = getMetaAttr(target, "subsection") || "";
            const name = getMetaAttr(target, "name") || "";
            const scopeKey = buildScopeKey({
              scope,
              section,
              subsection,
              name,
            });
            const meta = inlineState.getScopeMeta(scopeKey);
            const fieldId = meta?.fieldId || "";
            const fieldData =
              fieldsByKey.get(scopeKey) || fieldsByKey.get(fieldKey);

            // Always update the stored original HTML and dataset
            if (html && typeof html === "string") {
              originalHtml.set(target, html);

              // Update TipTap or DOM
              if (target === activeTarget && activeEditor) {
                const selection = activeEditor.state.selection;
                const markdown = String(fieldData?.markdown || "");
                try {
                  const doc = parseMarkdownToDoc(markdown, activeEditor.schema);
                  activeEditor.commands.setContent(doc.toJSON(), false);
                } catch (_error) {
                  console.warn("[mfe:inline] parse-failed:refresh-active", {
                    scope,
                    section,
                    subsection,
                    name,
                    error: _error?.message || String(_error),
                  });
                }
                try {
                  activeEditor.commands.setTextSelection(selection);
                } catch (e) {}
              } else {
                target.innerHTML = html;
              }
            }

            if (fieldData?.markdown) {
              const markdown = fieldData.markdown;
              target.dataset.markdown = markdown;
              target.dataset.markdownB64 = btoa(
                unescape(encodeURIComponent(markdown)),
              );
              const stateEntry = ensureInlineDocumentState(
                {
                  pageId,
                  scope,
                  section,
                  subsection,
                  name,
                },
                target,
              );
              if (stateEntry?.docState) {
                const readbackClassification =
                  typeof stateEntry.docState.getLastReadbackClassification ===
                  "function"
                    ? stateEntry.docState.getLastReadbackClassification()
                    : null;
                stateEntry.docState.markSaved(markdown, {
                  reason: "inline-save-success",
                  trigger: "save-commit",
                  currentScope: scope,
                  readbackClassification,
                  readbackClass: String(
                    readbackClassification?.className || "",
                  ),
                });
              }
            }
            if (fieldId) {
              clearDirty(fieldId);
            }
            if (scopeKey) {
              inlineState.deleteDraft(scopeKey);
            }
          });
        }),
    Promise.resolve(),
  );
}

/**
 * Open image picker and insert selected image
 */
function openImagePickerInline(initialData = null, imagePos = null) {
  if (!activeEditor) return;

  createImagePicker({
    initialData,
    onSelect: (imageData) => {
      // imageData is { filename, url, alt }
      if (!activeEditor) return;
      markInlineIntentToken("image-picker:select");

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

      // Mark as dirty
      dirty = true;
      if (activeFieldId) {
        markDirty(activeFieldId);
      }
      if (activeScopeKey) {
        const activeField = parseFieldId(activeFieldId || "");
        const markdown = decodeHtmlEntitiesInFences(
          getMarkdownFromEditor(activeEditor),
        );
        setCanonicalInlineDraft(activeField, markdown, activeTarget);
      }
    },
    onClose: () => {
      // Refocus editor after picker closes
      afterNextPaint(() => activeEditor?.view?.focus());
    },
  });
}

// Override global check to ensure picker uses our inline context when active
if (window.mfeOpenImagePicker) {
  const originalOpen = window.mfeOpenImagePicker;
  window.mfeOpenImagePicker = (data, imagePos = null) => {
    if (activeEditor) return openImagePickerInline(data, imagePos);
    return originalOpen(data, imagePos);
  };
} else {
  window.mfeOpenImagePicker = openImagePickerInline;
}

function createInlineToolbar() {
  if (toolbarEl) {
    return;
  }
  const { menubar, menubarInner } = createMenubarShell({
    className: "mfe-inline-menubar",
    // rely on CSS variable --mfe-menubar-offset instead of hardcoded value
  });

  const toolbar = document.createElement("div");
  toolbar.className = "mfe-toolbar mfe-inline-toolbar";

  const buttons = createToolbarButtons({
    getEditor: () => activeEditor,
    onSave: () => saveAllDrafts({ showStatus: true }),
    onToggleSplit: null,
    isSplitActive: () => false,
    onToggleOutlineView: null,
    isOutlineView: null,
  });

  const configButtons =
    window.MarkdownFrontEditorConfig?.toolbarButtons ||
    "bold,italic,strike,paragraph,link,unlink,image,|,h1,h2,h3,h4,h5,h6,|,ul,ol,blockquote,|,code,codeblock,clear,|,split";

  const { statusEl } = renderToolbarButtons({
    toolbar,
    buttons,
    configButtons,
    getEditor: () => activeEditor,
  });

  toolbarStatusEl = statusEl;
  registerStatusEl(statusEl);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "editor-toolbar-btn mfe-inline-close";
  closeBtn.title = "Close (Esc)";
  closeBtn.innerHTML = "×";
  closeBtn.onclick = (e) => {
    e.preventDefault();
    closeInlineEditor({ saveOnClose: false, promptOnClose: true });
  };

  const toolbarMeta = toolbar.querySelector(".editor-toolbar-meta");
  if (toolbarMeta) {
    toolbarMeta.appendChild(closeBtn);
  } else {
    toolbar.appendChild(closeBtn);
  }
  attachToolbarToMenubarInner(menubarInner, toolbar);

  document.body.appendChild(menubar);
  toolbarEl = menubar;
  toolbarCloseBtn = closeBtn;
}

function buildCanonicalInlinePayloadFromElement(element, markdownContent) {
  if (!(element instanceof Element)) {
    throw new Error("[mfe] inline payload invariant: target element required");
  }
  const fieldScope = getMetaAttr(element, "scope") || "";
  if (!CANONICAL_SCOPE_SET.has(fieldScope)) {
    throw new Error(
      `[mfe] inline payload invariant: invalid target scope "${fieldScope}"`,
    );
  }
  const fieldName = getMetaAttr(element, "name") || "";
  if (fieldScope !== "document" && !fieldName) {
    throw new Error("[mfe] inline payload invariant: target name required");
  }
  const pageId = element.getAttribute("data-page") || "";
  if (!pageId) {
    throw new Error("[mfe] inline payload invariant: target pageId required");
  }
  return {
    element,
    markdownContent: typeof markdownContent === "string" ? markdownContent : "",
    fieldName: fieldName || "document",
    fieldType: element.getAttribute("data-field-type") || "tag",
    fieldScope,
    fieldSection: getMetaAttr(element, "section") || "",
    fieldSubsection: getMetaAttr(element, "subsection") || "",
    pageId,
    canonicalHydrated: true,
  };
}

async function openInlineEditorFromPayload(payload) {
  if (!payload || !payload.element) return;
  assertCanonicalPayloadSchema(payload, "inline:openInlineEditorFromPayload");
  const el = payload.element;
  if (activeTarget === el && activeEditor) return;

  if (activeEditor) {
    const closed = await closeInlineEditor({
      saveOnClose: false,
      promptOnClose: true, // Show unsaved changes prompt
      keepToolbar: true,
      persistDraft: true,
    });
    if (!closed) return;
  }

  const {
    markdownContent,
    fieldName,
    fieldType,
    fieldScope,
    fieldSection,
    fieldSubsection,
    pageId,
  } = payload;

  activeTarget = el;
  activeFieldName = fieldName;
  activeFieldType = fieldType;
  activeFieldScope = fieldScope;
  activeFieldSection = fieldSection;
  activeFieldSubsection = fieldSubsection || "";
  activeFieldId = buildFieldId({
    pageId,
    scope: fieldScope,
    section: fieldSection,
    name: fieldName,
  });
  activeScopeKey = buildScopeKey({
    scope: fieldScope,
    section: fieldSection,
    subsection: fieldSubsection || "",
    name: fieldName,
  });
  inlineState.setScopeMeta(activeScopeKey, {
    fieldId: activeFieldId,
    pageId,
    scope: fieldScope,
    section: fieldSection,
    subsection: fieldSubsection || "",
    name: fieldName,
  });
  inlineState.setFieldElement(activeFieldId, el);

  const scope = createScope({
    kind: fieldScope,
    pageId,
    section: fieldSection,
    subsection: fieldSubsection || "",
    name: fieldName,
    fieldType,
  });
  const view = createView({ kind: "rich" });
  const hostContext = createHost({ kind: "inline" });
  resolveSession({ scope, view, host: hostContext });

  if (!originalHtml.has(el)) {
    originalHtml.set(el, el.innerHTML);
  }

  el.classList.add("mfe-inline-active");
  el.innerHTML = "";

  const host = document.createElement("div");
  host.className = "mfe-inline-host";
  el.appendChild(host);

  activeEditor = createEditorInstance(host, fieldType, fieldName);

  suppressUpdates = true;
  allowSystemTransactionDepth += 1;
  try {
    const doc = parseMarkdownToDoc(markdownContent || "", activeEditor.schema);
    activeEditor.commands.setContent(doc.toJSON(), false);
  } catch (_error) {
    console.warn("[mfe:inline] parse-failed:open", {
      scope: fieldScope,
      section: fieldSection,
      subsection: fieldSubsection || "",
      name: fieldName,
      error: _error?.message || String(_error),
    });
  } finally {
    allowSystemTransactionDepth = Math.max(0, allowSystemTransactionDepth - 1);
  }
  dirty = false;
  clearDirty(activeFieldId);
  if (activeScopeKey) {
    inlineState.deleteDraft(activeScopeKey);
  }
  inlineState.setOriginalMarkdown(activeFieldId, markdownContent || "");
  const boundState = ensureInlineDocumentState(
    {
      pageId,
      scope: fieldScope,
      section: fieldSection,
      subsection: fieldSubsection || "",
      name: fieldName,
    },
    el,
  );
  if (boundState?.docState) {
    const readbackClassification =
      typeof boundState.docState.getLastReadbackClassification === "function"
        ? boundState.docState.getLastReadbackClassification()
        : null;
    boundState.docState.markSaved(markdownContent || "", {
      reason: "inline-open-sync",
      trigger: "save-commit",
      currentScope: fieldScope,
      readbackClassification,
      readbackClass: String(readbackClassification?.className || ""),
    });
  }
  suppressUpdates = false;
  if (shouldWarnForExtraContent(fieldType, fieldName)) {
    stripTrailingEmptyParagraph(activeEditor);
  }
  setOriginalBlockCount(
    activeEditor,
    fieldType,
    fieldName,
    originalBlockCounts,
  );
  highlightExtraContent(activeEditor);

  createInlineToolbar();

  const editor = activeEditor;
  afterNextPaint(() => editor?.view?.focus());
}

function closeInlineEditor({
  saveOnClose = false,
  promptOnClose = false,
  keepToolbar = false,
  persistDraft = false,
  flushToCanonical = false,
} = {}) {
  if (!activeEditor || !activeTarget) {
    if (toolbarEl) {
      toolbarEl.remove();
    }
    toolbarEl = null;
    toolbarStatusEl = null;
    toolbarCloseBtn = null;

    document.querySelectorAll(".mfe-inline-active").forEach((el) => {
      const finalHtml = originalHtml.get(el) || "";
      el.innerHTML = finalHtml;
      el.classList.remove("mfe-inline-active");
    });

    activeEditor = null;
    activeTarget = null;
    activeFieldName = null;
    activeFieldType = null;
    activeFieldScope = "field";
    activeFieldSection = "";
    activeFieldSubsection = "";
    activeFieldId = null;
    activeScopeKey = "";
    dirty = false;
    isClosingInlineEditor = false;
    return Promise.resolve(true);
  }

  if (isClosingInlineEditor) {
    return Promise.resolve(false);
  }

  isClosingInlineEditor = true;

  const target = activeTarget;
  const scopeKey = activeScopeKey;
  const editorForDraft = activeEditor;
  const hasDraft = scopeKey ? inlineState.hasDraft(scopeKey) : false;

  const cleanup = () => {
    if (activeEditor) {
      activeEditor.destroy();
    }
    activeEditor = null;
    activeTarget = null;
    activeFieldName = null;
    activeFieldType = null;
    activeFieldScope = "field";
    activeFieldSection = "";
    activeFieldSubsection = "";
    activeFieldId = null;
    activeScopeKey = "";
    dirty = false;
    isClosingInlineEditor = false;

    if (!keepToolbar) {
      if (toolbarEl) {
        toolbarEl.remove();
      }
      toolbarEl = null;
      toolbarStatusEl = null;
      toolbarCloseBtn = null;
    }

    target.classList.remove("mfe-inline-active");
    if (persistDraft && hasDraft && editorForDraft) {
      const rendered = renderDraftHtml(editorForDraft);
      target.innerHTML = rendered;
    } else {
      const finalHtml = originalHtml.get(target) || "";
      target.innerHTML = finalHtml;
    }
  };

  if (promptOnClose && !confirmDiscardChanges()) {
    // User canceled, restore state
    isClosingInlineEditor = false;
    return Promise.resolve(false);
  }

  if (persistDraft && scopeKey && editorForDraft) {
    const activeField = parseFieldId(activeFieldId || "");
    const markdown = decodeHtmlEntitiesInFences(
      getMarkdownFromEditor(editorForDraft),
    );
    setCanonicalInlineDraft(activeField, markdown, target);
  }

  if (!saveOnClose && promptOnClose) {
    for (const [, meta] of inlineState.scopeMetaByKey.entries()) {
      if (!meta) continue;
      const stateEntry = ensureInlineDocumentState(
        {
          pageId: meta.pageId,
          scope: meta.scope,
          section: meta.section,
          subsection: meta.subsection,
          name: meta.name,
        },
        inlineState.getFieldElement(meta.fieldId || "") || null,
      );
      if (!stateEntry?.docState) continue;
      stateEntry.docState.clearDraft({
        reason: "inline-discard",
        trigger: "explicit-discard",
      });
    }
    inlineState.forEachDraft((_, key) => {
      const meta = inlineState.getScopeMeta(key);
      if (!meta?.fieldId) return;
      clearDirty(meta.fieldId);
      const el = inlineState.getFieldElement(meta.fieldId);
      if (el) {
        const finalHtml = originalHtml.get(el) || "";
        el.innerHTML = finalHtml;
        el.classList.remove("mfe-inline-active");
      }
    });
    inlineState.clearDrafts();
    dirty = false;
  }

  const flushPromise = flushToCanonical
    ? (() => {
        if (!editorForDraft || !target) {
          throw new Error(
            "[mfe] inline: flush requested without active editor",
          );
        }
        const fullscreenApi = window.MarkdownFrontEditor;
        if (
          !fullscreenApi ||
          typeof fullscreenApi.applyScopedDraftForTarget !== "function" ||
          typeof fullscreenApi.getCanonicalState !== "function"
        ) {
          throw new Error(
            "[mfe] inline: canonical fullscreen bridge unavailable",
          );
        }
        const markdown = decodeHtmlEntitiesInFences(
          getMarkdownFromEditor(editorForDraft),
        );
        return Promise.resolve(
          fullscreenApi.applyScopedDraftForTarget(target, markdown),
        ).then(() => {
          fullscreenApi.getCanonicalState();
        });
      })()
    : Promise.resolve();

  const savePromise = saveOnClose
    ? saveAllDrafts({ showStatus: false })
    : Promise.resolve();
  return Promise.resolve(flushPromise)
    .then(() => savePromise)
    .then(
      () => {
        cleanup();
        return true;
      },
      (err) => {
        cleanup();
        return Promise.reject(err);
      },
    );
}

function initInlineEditor() {
  normalizeFieldHostIdentity(document);
  setInlineShellOpen(true);
  window.MarkdownFrontEditorInline = {
    isOpen() {
      return Boolean(activeEditor && activeTarget);
    },
    openForElement(target) {
      const opened = openInlineForTarget(target);
      if (!opened) {
        throw new Error("[mfe] inline: router unavailable for openForElement");
      }
      return opened;
    },
    openForElementFromCanonical(target, canonicalState = null) {
      const fullscreenApi = window.MarkdownFrontEditor;
      if (
        !fullscreenApi ||
        typeof fullscreenApi.resolveMarkdownForTarget !== "function"
      ) {
        throw new Error(
          "[mfe] inline: canonical fullscreen bridge unavailable",
        );
      }
      const markdownContent = fullscreenApi.resolveMarkdownForTarget(
        target,
        canonicalState,
      );
      const canonicalPayload = buildCanonicalInlinePayloadFromElement(
        target,
        markdownContent,
      );
      return openInlineEditorFromPayload(canonicalPayload);
    },
    close(options = {}) {
      return closeInlineEditor(options);
    },
    async flushToCanonical() {
      if (!activeEditor || !activeTarget) {
        const fullscreenApi = window.MarkdownFrontEditor;
        if (fullscreenApi?.getCanonicalState) {
          fullscreenApi.getCanonicalState();
        }
        return true;
      }
      return closeInlineEditor({
        saveOnClose: false,
        promptOnClose: false,
        keepToolbar: true,
        persistDraft: false,
        flushToCanonical: true,
      }).then(() => true);
    },
  };
  const cfg = window.MarkdownFrontEditorConfig || {};
  if (cfg.debugShowSections) {
    debugLabels = true;
    setInlineDebugShell({ showSections: true, showLabels: true });
  }
  if (cfg.debugShowLabels) {
    setInlineDebugShell({ showLabels: true });
    debugLabels = true;
  }
  const labelStyle = cfg.labelStyle || "outside";
  setInlineLabelStyle(labelStyle);

  const editables = Array.from(document.querySelectorAll(".fe-editable"));
  editables.forEach((el) => {
    applyEditLabelAttributes(el);
  });
  const mfeHosts = Array.from(document.querySelectorAll("[data-mfe]"));
  mfeHosts.forEach((el) => {
    applyDataMfeLabelAttributes(el);
  });

  overlayEngine.init();

  if (!inlineRuntimeEventsBound) {
    const scope = ensureInlineRuntimeEventScope();

    const onInlineDblclick = (e) => {
      markInlineIntentToken("dblclick");
      if (isFullscreenOpen()) {
        debugInlineDblclick({
          event: e,
          hit: e.target?.closest?.(".fe-editable") || null,
          action: null,
          reason: "fullscreen-open-skip",
        });
        return;
      }
      clearPendingLinkNavigation();
      const hit = e.target?.closest?.(".fe-editable");
      if (!hit) {
        debugInlineDblclick({
          event: e,
          hit: null,
          action: null,
          reason: "no-hit",
        });
      }

      e.preventDefault();
      e.stopPropagation();
      const action = resolveDblclickAction({
        event: e,
        hit,
        overlayEngine,
        findTargetFromPoint,
        findSectionFromText: () => null,
        decodeMarkdownBase64,
        createVirtualTarget,
        pageId:
          document.querySelector(".fe-editable")?.getAttribute("data-page") ||
          "0",
      });

      if (!action || action.action === "none") {
        debugInlineDblclick({
          event: e,
          hit,
          action,
          reason: "resolved-none",
        });
        return;
      }

      if (action.action === "fullscreen") {
        debugInlineDblclick({
          event: e,
          hit,
          action,
          reason: "open-fullscreen",
        });
        const opened = openFullscreenForTarget(action.target);
        if (!opened && isDblclickDebugEnabled()) {
          console.warn("[mfe:dblclick:inline] fullscreen-open-unavailable", {
            hit: toDblclickTargetDebug(hit),
            target: toDblclickTargetDebug(action.target),
          });
        }
        return;
      }

      if (action.action === "inline") {
        debugInlineDblclick({
          event: e,
          hit,
          action,
          reason: "open-inline",
        });
        openInlineForTarget(action.target);
      }
    };

    const onInlineClickBlock = (e) => {
      const linkHit = e.target?.closest?.("a");
      if (!linkHit) return;
      if (!isInEditableZone(e.target)) return;
      if (e.button !== 0) return;
      if (e.altKey || e.shiftKey) return;
      if (linkHit.hasAttribute("download")) return;

      if (e.detail === 1) {
        clearPendingLinkNavigation();
        e.preventDefault();
        pendingLinkNavigation = {
          link: linkHit,
          timer: window.setTimeout(() => {
            const nav = pendingLinkNavigation;
            pendingLinkNavigation = null;
            if (!nav) return;
            navigateFromLink(nav.link, e);
          }, 260),
        };
        return;
      }

      clearPendingLinkNavigation();
      e.preventDefault();
      e.stopPropagation();
    };

    const onInlineHover = (e) => {
      if (hoverRaf) return;
      hoverRaf = window.requestAnimationFrame(() => {
        hoverRaf = null;
        const fieldSubHit = overlayEngine.findFieldSubsectionTargetFromPoint(
          e.clientX,
          e.clientY,
        );
        const fallbackSub = fieldSubHit;
        if (fallbackSub?.rect) {
          const key = `${fallbackSub.scope}:${fallbackSub.section || ""}:${fallbackSub.subsection || ""}:${fallbackSub.name}`;
          if (lastHoverKey !== key) {
            lastHoverKey = key;
            overlayEngine.setLabel(
              getEditLabel(
                fallbackSub.scope,
                fallbackSub.name,
                fallbackSub.section || "",
                fallbackSub.subsection || "",
              ),
            );
            const inflated = inflateRect(fallbackSub.rect, 16);
            overlayEngine.showBox(inflated);
            lastHoverRect = inflated;
          }
          return;
        }

        const dataMfeTarget = findDataMfeTargetFromPoint(e.clientX, e.clientY);
        if (dataMfeTarget?.rect) {
          const key = `${dataMfeTarget.scope}:${dataMfeTarget.section || ""}:${dataMfeTarget.subsection || ""}:${dataMfeTarget.name}`;
          if (lastHoverKey !== key) {
            lastHoverKey = key;
            overlayEngine.setLabel(
              getEditLabel(
                dataMfeTarget.scope,
                dataMfeTarget.name,
                dataMfeTarget.section || "",
                dataMfeTarget.subsection || "",
              ),
            );
            const inflated = inflateRect(dataMfeTarget.rect, 16);
            overlayEngine.showBox(inflated);
            lastHoverRect = inflated;
          }
          return;
        }

        if (
          lastHoverRect &&
          isPointInRect(e.clientX, e.clientY, lastHoverRect)
        ) {
          return;
        }
        overlayEngine.hide();
        lastHoverKey = "";
      });
    };

    const onInlineBeforeUnload = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };

    const onInlineKeydown = (e) => {
      markInlineIntentToken("keydown");
      if (e.key === "Escape") {
        closeInlineEditor({ saveOnClose: false, promptOnClose: true });
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveAllDrafts({ showStatus: true });
        }
      }
    };

    scope.register(document, "dblclick", onInlineDblclick, true);
    scope.register(document, "click", onInlineClickBlock, true);
    scope.register(document, "mousemove", onInlineHover, true);
    scope.register(window, "scroll", overlayEngine.hide, true);
    scope.register(window, "beforeunload", onInlineBeforeUnload);
    scope.register(document, "keydown", onInlineKeydown, true);
    inlineRuntimeEventsBound = true;
  }
}

export { initInlineEditor };
