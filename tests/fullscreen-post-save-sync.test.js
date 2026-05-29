/** @jest-environment jsdom */

import { TextDecoder, TextEncoder } from "node:util";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  handlePrimarySaveResponse,
  requestRenderedFragmentsDatastar,
} from "../src/fullscreen-post-save-sync.js";
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

function installFragmentFetchStub(ssePayload) {
  const originalFetch = global.fetch;
  const encoder = new TextEncoder();

  global.fetch = jest.fn().mockImplementation((url) => {
    if (String(url).includes("markdownFrontEditorToken=1")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => '<input name="csrf" value="token-value">',
      });
    }
    if (String(url).includes("markdownFrontEditorFragments=1")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        body: {
          getReader() {
            let done = false;
            return {
              async read() {
                if (done) {
                  return { done: true, value: undefined };
                }
                done = true;
                return {
                  done: false,
                  value: encoder.encode(ssePayload),
                };
              },
            };
          },
        },
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  return () => {
    global.fetch = originalFetch;
  };
}

if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
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

  test("stale-scope event fires only after fragment patches complete", async () => {
    document.body.innerHTML = [
      '<div id="section-host"><span>hero before</span></div>',
      '<div id="body-host"><span>body before</span></div>',
    ].join("");

    const ssePayload = [
      'event: datastar-patch-signals\ndata: signals {"mfe_missing":["field:hero:title"]}',
      "event: datastar-patch-elements\ndata: key field:body:text\ndata: selector #body-host\ndata: mode inner\ndata: elements <p>body after</p>",
      "",
    ].join("\n\n");
    const eventSnapshots = [];
    const restoreFetch = installFragmentFetchStub(ssePayload);

    const onStaleScope = () => {
      eventSnapshots.push(
        document.getElementById("body-host")?.innerHTML || "",
      );
    };
    window.addEventListener("mfe:fragment-stale-scope", onStaleScope);

    try {
      const result = await requestRenderedFragmentsDatastar({
        pageId: "123",
        lang: "default",
        keys: ["section:hero", "field:hero:title", "field:body:text"],
        mountTargets: {
          "field:body:text": [{ selector: "#body-host", mode: "inner" }],
        },
        graphChecksum: "",
        graphNodeCount: 0,
        graphKeys: [],
        patchCycleCounter: {
          next: () => 77,
        },
        hasPendingUnsavedChanges: () => false,
        resolveHostImageSrc: (_host, src) => src,
        debugWarn: jest.fn(),
        debugInfo: jest.fn(),
        isInlineOpen: () => false,
        draftScopedKeys: [],
      });

      expect(result.updated).toBe(1);
      expect(eventSnapshots).toEqual(["<p>body after</p>"]);
      expect(document.getElementById("body-host")?.innerHTML).toBe(
        "<p>body after</p>",
      );
    } finally {
      window.removeEventListener("mfe:fragment-stale-scope", onStaleScope);
      restoreFetch();
    }
  });

  test("invalid fragment selectors fail with a controlled error instead of querySelectorAll", async () => {
    document.body.innerHTML =
      '<div id="body-host"><span>body before</span></div>';
    const ssePayload = [
      "event: datastar-patch-elements\ndata: key field:body:text\ndata: selector [[broken\ndata: mode inner\ndata: elements <p>body after</p>",
      "",
    ].join("\n\n");
    const restoreFetch = installFragmentFetchStub(ssePayload);

    try {
      await expect(
        requestRenderedFragmentsDatastar({
          pageId: "123",
          lang: "default",
          keys: ["field:body:text"],
          mountTargets: {
            "field:body:text": [{ selector: "#body-host", mode: "inner" }],
          },
          graphChecksum: "",
          graphNodeCount: 0,
          graphKeys: [],
          patchCycleCounter: {
            next: () => 78,
          },
          hasPendingUnsavedChanges: () => false,
          resolveHostImageSrc: (_host, src) => src,
          debugWarn: jest.fn(),
          debugInfo: jest.fn(),
          isInlineOpen: () => false,
          draftScopedKeys: [],
        }),
      ).rejects.toThrow(/fragment patch blocked: invalid selector/i);
    } finally {
      restoreFetch();
    }
  });
});
