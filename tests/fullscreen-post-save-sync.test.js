/** @jest-environment jsdom */

import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { handlePrimarySaveResponse } from "../src/fullscreen-post-save-sync.js";
import { getMetaAttr } from "../src/editor-shared-helpers.js";

function buildTestSchema() {
  return getSchema([
    StarterKit.configure({
      codeBlock: true,
      link: false,
      underline: false,
    }),
    Link.configure({
      openOnClick: false,
      linkOnPaste: true,
    }),
  ]);
}

describe("fullscreen post-save sync active editor reseed", () => {
  test("does not reseed the active editor when the active key was requested but not applied", async () => {
    document.body.innerHTML = [
      '<div id="host"',
      ' class="fe-editable"',
      ' data-page="123"',
      ' data-mfe-scope="field"',
      ' data-mfe-name="hero"',
      ' data-markdown="stale body"></div>',
    ].join("");
    window.MarkdownFrontEditorConfig = {
      sectionsIndex: [],
      fieldsIndex: [],
    };

    const activeTarget = document.getElementById("host");
    const setActiveMarkdownState = jest.fn();
    const setContent = jest.fn();
    const setTextSelection = jest.fn();
    const clearDirty = jest.fn();
    const requestRenderedFragments = jest.fn().mockResolvedValue({
      cycleId: 41,
      applied: [],
      missingKeys: [],
      skippedSectionKeys: [],
      staleScopeKeys: [],
    });

    await handlePrimarySaveResponse({
      data: {
        htmlMap: {
          "field:hero": "<div>saved html</div>",
        },
        changed: ["field:hero"],
      },
      finalMarkdown: "saved body",
      options: {
        updateActiveEditor: true,
      },
      activeFieldScope: "field",
      activeFieldId: "123:hero",
      activeTarget,
      primaryEditor: {
        schema: buildTestSchema(),
        state: {
          selection: { from: 1, to: 1 },
        },
        commands: {
          setContent,
          setTextSelection,
        },
      },
      statusManager: {
        clearDirty,
      },
      primaryDraftsByFieldId: new Map(),
      draftMarkdownByScopedKey: new Map(),
      getActiveScopedHtmlKey: () => "field:hero",
      syncDirtyStatusForActiveField: jest.fn(),
      setDocumentDraftMarkdown: jest.fn(),
      traceStateMutation: ({ mutate }) => mutate(),
      writeDocumentMarkdownCache: jest.fn(),
      requestRenderedFragments,
      setLastCompileReport: jest.fn(),
      getLanguagesConfig: () => ({ current: "default" }),
      resolveHostImageSrc: (_host, src) => src,
      debugWarn: jest.fn(),
      debugInfo: jest.fn(),
      debugTable: jest.fn(),
      isDevMode: () => true,
      annotateBoundImages: jest.fn(),
      initEditors: jest.fn(),
      setActiveMarkdownState,
      enforceBodyOnlyEditorInput: (markdown) => markdown,
      sanitizeEditorMarkdownForScope: (markdown) => markdown,
      decodeMaybeB64: (value) => value,
      encodeMarkdownBase64: (value) => value,
      normalizeCanonicalMarkdownForIngress: (markdown) => markdown,
      normalizeScopeKind: (scope) => scope || "field",
      normalizeLangValue: (lang) => lang || "default",
      runWithoutDirtyTracking: (callback) => callback(),
      getMetaAttr,
    });

    expect(requestRenderedFragments).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "123",
        lang: "default",
        keys: ["field:hero"],
      }),
    );
    expect(setActiveMarkdownState).not.toHaveBeenCalled();
    expect(setContent).not.toHaveBeenCalled();
    expect(setTextSelection).not.toHaveBeenCalled();
    expect(activeTarget.getAttribute("data-markdown")).toBe("stale body");
  });
});
