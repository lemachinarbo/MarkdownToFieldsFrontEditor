import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { loadE2EConfig } from "./runtime-config.js";

const e2e = loadE2EConfig();

const CONTENT_ROOT = e2e.contentRoot;
const EN_FILE = path.join(CONTENT_ROOT, "en/home.md");
const ES_FILE = path.join(CONTENT_ROOT, "es/home.md");
const EN_BASELINE_FILE = path.join(
  process.cwd(),
  "tests/fixtures/en-home.baseline.md",
);
const EN_LONG_OUTLINE_BASELINE_FILE = path.join(
  process.cwd(),
  "tests/fixtures/en-home-long-outline.baseline.md",
);
const EN_COMPLEX_DOCUMENT_FIXTURE = path.join(
  process.cwd(),
  "tests/fixtures/en-home-complex-document.md",
);
const ES_BASELINE_FILE = path.join(
  process.cwd(),
  "tests/fixtures/es-home.baseline.md",
);

const HERO_BLOCK_REGEX_EN =
  /<!-- section:hero -->\n+<!-- title -->\n# The Urban <br>Farms?\n+<!-- intro\.\.\. -->/;

const ADMIN_USER = e2e.adminUser;
const ADMIN_PASS = e2e.adminPass;
const STATUS_SCOPE_MATRIX = [
  {
    scopeKind: "field",
    scope: "field",
    name: "title",
    section: "hero",
    subsection: "",
    readyContains: "The Urban",
  },
  {
    scopeKind: "section",
    scope: "section",
    name: "hero",
    section: "hero",
    subsection: "",
    readyContains: "The Urban",
  },
  {
    scopeKind: "subsection",
    scope: "subsection",
    name: "right",
    section: "columns",
    subsection: "right",
    readyContains: "How we work",
  },
  {
    scopeKind: "document",
    scope: "document",
    name: "document",
    section: "",
    subsection: "",
    readyContains: "The Urban",
  },
];

async function readEs() {
  return fs.readFile(ES_FILE, "utf8");
}

async function readEn() {
  return fs.readFile(EN_FILE, "utf8");
}

async function resetHomesFromFixtures() {
  const [enBaseline, esBaseline] = await Promise.all([
    fs.readFile(EN_BASELINE_FILE, "utf8"),
    fs.readFile(ES_BASELINE_FILE, "utf8"),
  ]);
  await Promise.all([
    fs.writeFile(EN_FILE, enBaseline, "utf8"),
    fs.writeFile(ES_FILE, esBaseline, "utf8"),
  ]);
}

async function normalizeHeroTitleToBaseline() {
  await resetHomesFromFixtures();
  const current = await readEn();
  const next = current.replace(
    /<!-- section:hero -->\n(?:.|\n)*?<!-- intro\.\.\. -->/,
    "<!-- section:hero -->\n\n<!-- title -->\n# The Urban <br>Farm\n\n<!-- intro... -->",
  );
  await fs.writeFile(EN_FILE, next, "utf8");
}

async function normalizeV2MatrixBaseline() {
  await resetHomesFromFixtures();
  let current = await readEn();
  current = current.replace(/# The Urban <br>Farm(?:\s*V2)?/g, "# The Urban <br>Farm");
  current = current.replace(
    /We grow food and ideas in the city(?: V2)?\.[^\n]*/g,
    "We grow food and ideas in the city. From rooftop gardens to indoor farms, we craft systems that actually produce. We work where soil, design, and tech collide.",
  );
  current = current.replace(
    /### How we work(?:\s*V2)?s*/g,
    "### How we work",
  );
  current = current.replace(
    /Mushrooms and sprouts(?:\s*V2)?/g,
    "Mushrooms and sprouts",
  );
  current = current.replace(
    /Every _plot_ starts _small_\. Every harvest stays \*\*predictable(?:-v2)?\*\*\./g,
    "Every _plot_ starts _small_. Every harvest stays **predictable**.",
  );
  current = current.replace(
    /\s*V2_(?:FIELD|SUBSECTION|SECTION|DOCUMENT)_SCOPE_TOKEN/g,
    "",
  );
  current = current.replace(/\s*V2_CLI_FLOW_[A-Z0-9_]+/g, "");
  current = current.replace(
    /_(?:FIELD|SUBSECTION|SECTION|DOCUMENT)_SCOPE_TOKEN/g,
    "",
  );
  await fs.writeFile(EN_FILE, current, "utf8");
}

async function appendOutlineOrderingFixture() {
  const current = String(await readEn());
  if (current.includes("<!-- section:about -->")) return;
  const block = [
    "",
    "",
    "<!-- section:about -->",
    "",
    "<!-- title -->",
    "## Chi sono",
    "",
    "<!-- description... -->",
    "Mi chiamo Daniela Fenini.",
    "",
    "Sono una donna, una madre, una nonna.",
    "",
    "Ho percorso questo cammino anch'io.",
    "",
  ].join("\n");
  await fs.writeFile(EN_FILE, `${current.replace(/\s*$/, "")}${block}`, "utf8");
}

async function appendPlainTagFieldFixture() {
  const current = String(await readEn());
  if (current.includes("<!-- section:edgecases -->")) return;
  const block = [
    "",
    "",
    "<!-- section:edgecases -->",
    "",
    "<!-- plain -->",
    "Alpha beta gamma",
    "",
    "<!-- after -->",
    "After marker stays untouched.",
    "",
  ].join("\n");
  await fs.writeFile(EN_FILE, `${current.replace(/\s*$/, "")}${block}`, "utf8");
}

async function resetHomeFromFixture(fixturePath) {
  const [enBaseline, esBaseline] = await Promise.all([
    fs.readFile(fixturePath, "utf8"),
    fs.readFile(ES_BASELINE_FILE, "utf8"),
  ]);
  await Promise.all([
    fs.writeFile(EN_FILE, enBaseline, "utf8"),
    fs.writeFile(ES_FILE, esBaseline, "utf8"),
  ]);
}

async function ensureAuthenticated(page) {
  await page.goto("/adm", { waitUntil: "domcontentloaded" });
  const userInput = page.locator('input[name="login_name"]');
  const passInput = page.locator('input[name="login_pass"]');
  const needsLogin =
    (await userInput.count()) > 0 && (await passInput.count()) > 0;
  if (!needsLogin) return true;

  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/SessionLoginThrottle/i.test(bodyText)) return false;

  await userInput.first().fill(ADMIN_USER);
  await passInput.first().fill(ADMIN_PASS);
  const submitButton = page.locator(
    'button[type="submit"], input[type="submit"]',
  );
  if ((await submitButton.count()) > 0) {
    await submitButton.first().click();
  } else {
    await passInput.first().press("Enter");
  }
  await page.waitForLoadState("domcontentloaded");
  const loginStillVisible = await userInput
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  return !loginStillVisible;
}

function getSaveButton(page) {
  return page.getByRole("button", { name: /Save changes/i }).first();
}

function getActivePrimaryEditor(page) {
  return page
    .locator('[data-mfe-window="true"]')
    .last()
    .locator(
      '.mfe-editor-pane--primary .mfe-editor[contenteditable="true"], .mfe-editor-pane--primary [role="textbox"][contenteditable="true"], .mfe-editor-pane--primary [contenteditable="true"]',
    )
    .first();
}

function getActiveSecondaryEditor(page) {
  return page
    .locator('[data-mfe-window="true"]')
    .last()
    .locator(
      '.mfe-editor-pane--secondary .mfe-editor[contenteditable="true"], .mfe-editor-pane--secondary [role="textbox"][contenteditable="true"], .mfe-editor-pane--secondary [contenteditable="true"]',
    )
    .first();
}

async function appendTokenInSecondaryEditor(page, token) {
  const activeTextbox = getActiveSecondaryEditor(page);
  await expect(activeTextbox).toBeVisible();
  const headingTarget = activeTextbox.locator("h1, h2, h3, h4, h5, h6").first();
  if (await headingTarget.isVisible().catch(() => false)) {
    await headingTarget.click();
    await page.keyboard.press("End");
  } else {
    const editableTarget = activeTextbox.locator("p, li").first();
    if (await editableTarget.isVisible().catch(() => false)) {
      await editableTarget.click();
      await page.keyboard.press("End");
    } else {
      await activeTextbox.click();
      await page.keyboard.press("End");
    }
  }
  await page.keyboard.type(` ${token}`);
}

async function ensureSplitLanguageSelected(page, languageLabel) {
  const secondaryEditor = getActiveSecondaryEditor(page);
  const alreadyVisible = await secondaryEditor
    .isVisible({ timeout: 400 })
    .catch(() => false);
  if (!alreadyVisible) {
    const splitButton = page.getByRole("button", { name: "View languages" });
    await expect(splitButton).toBeVisible();
    await splitButton.click();
  }
  const languageSelect = page.getByRole("combobox").first();
  await expect(languageSelect).toBeVisible();
  await languageSelect.selectOption({ label: String(languageLabel || "Spanish") });
  await expect(getActiveSecondaryEditor(page)).toBeVisible();
}

async function openFullscreenEditor(page) {
  await page.goto("/");

  const saveButton = getSaveButton(page);
  const editorWindow = page.locator('[data-mfe-window="true"]').last();
  const isWindowOpen = async () =>
    editorWindow.isVisible({ timeout: 800 }).catch(() => false);
  if (
    (await saveButton.first().isVisible({ timeout: 1500 }).catch(() => false)) &&
    (await isWindowOpen())
  ) {
    return true;
  }

  await page.waitForLoadState("domcontentloaded");

  const runtimeBefore = await page.evaluate(() => ({
    hasFullscreenApi:
      typeof window.MarkdownFrontEditor?.openForElement === "function",
    hasInlineApi:
      typeof window.MarkdownFrontEditorInline?.openForElement === "function",
    hasRecompileApi:
      typeof window.MarkdownFrontEditor?.recompile === "function",
    hostCount: document.querySelectorAll("[data-mfe]").length,
  }));

  if (runtimeBefore.hostCount === 0 && runtimeBefore.hasRecompileApi) {
    await page.evaluate(() => {
      window.MarkdownFrontEditor.recompile();
    });
    await page.waitForTimeout(350);
  }

  await page
    .waitForFunction(
      () => document.querySelectorAll("[data-mfe]").length > 0,
      undefined,
      { timeout: 8000 },
    )
    .catch(() => {});

  const openedByApi = await page.evaluate(() => {
    const candidate =
      document.querySelector('[data-mfe="field:hero/title"]') ||
      document.querySelector("[data-mfe]");
    const fullscreenApi = window.MarkdownFrontEditor;
    const inlineApi = window.MarkdownFrontEditorInline;
    if (
      fullscreenApi &&
      typeof fullscreenApi.openForElement === "function" &&
      candidate instanceof HTMLElement
    ) {
      fullscreenApi.openForElement(candidate);
      return true;
    }
    if (
      inlineApi &&
      typeof inlineApi.openForElement === "function" &&
      candidate instanceof HTMLElement
    ) {
      inlineApi.openForElement(candidate);
      return true;
    }
    return false;
  });

  if (openedByApi) {
    const opened =
      (await saveButton.first().isVisible({ timeout: 5000 }).catch(() => false)) &&
      (await isWindowOpen());
    if (opened) {
      return true;
    }
  }

  const candidateSelectors = [
    '[data-mfe="field:hero/title"]',
    '[data-mfe*="hero"]',
    "[data-mfe]",
    "main h1",
    "main p",
  ];

  for (const selector of candidateSelectors) {
    const target = page.locator(selector).first();
    const visible = await target.isVisible({ timeout: 2500 }).catch(() => false);
    if (!visible) continue;
    await target.dblclick({ force: true });
    const opened =
      (await saveButton.first().isVisible({ timeout: 4000 }).catch(() => false)) &&
      (await isWindowOpen());
    if (opened) {
      return true;
    }
  }

  const canonicalMarkdown = await readEn().catch(() => "");
  const openedByVirtualTarget = await page.evaluate((markdown) => {
    const api = window.MarkdownFrontEditor;
    if (!api || typeof api.openForElementFromCanonical !== "function") {
      return false;
    }

    const cfg = window.MarkdownFrontEditorConfig || {};
    const pageId = String(
      cfg.pageId ||
        document.body?.getAttribute?.("data-page") ||
        document.documentElement?.getAttribute?.("data-page") ||
        "1",
    );

    const virtual = document.createElement("div");
    virtual.setAttribute("data-page", pageId);
    virtual.setAttribute("data-mfe-scope", "document");
    virtual.setAttribute("data-mfe-name", "document");
    virtual.setAttribute("data-mfe-markdown-kind", "canonical");

    const encoded = btoa(unescape(encodeURIComponent(String(markdown || ""))));
    virtual.setAttribute("data-markdown-b64", encoded);

    try {
      api.openForElementFromCanonical(virtual, {
        markdown: String(markdown || ""),
        applied: [],
      });
      return true;
    } catch (_error) {
      return false;
    }
  }, canonicalMarkdown);

  if (openedByVirtualTarget) {
    const opened =
      (await saveButton.first().isVisible({ timeout: 5000 }).catch(() => false)) &&
      (await isWindowOpen());
    if (opened) {
      return true;
    }
  }

  await page.evaluate(() => {
    const candidate = document.querySelector("[data-mfe]");
    if (!candidate) return;
    candidate.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );
  });

  return Boolean(
    (await saveButton.first().isVisible({ timeout: 8000 }).catch(() => false)) &&
      (await isWindowOpen()),
  );
}

async function navigateToDocumentScope(page) {
  const windowShell = page.locator('[data-mfe-window="true"]').last();
  const documentLink = windowShell.getByRole("link", { name: "Document" }).first();

  if (await documentLink.isVisible({ timeout: 1500 }).catch(() => false)) {
    await documentLink.click();
    return;
  }

  const sectionLink = windowShell.getByRole("link", { name: /^Section:/ }).first();
  if (await sectionLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await sectionLink.click();
  }

  if (await documentLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await documentLink.click();
  }
}

async function ensureDocumentScopeHydrated(page) {
  const editor = getActivePrimaryEditor(page);
  await expect(editor).toBeVisible();
  await expect
    .poll(
      async () => String((await editor.textContent()) || "").length,
      { timeout: 10000 },
    )
    .toBeGreaterThan(200);
  await waitForEditorTextContains(page, "How we work");
}

async function openScopeFromCanonical(
  page,
  { scope, name, section = "", subsection = "", readyContains = "" },
) {
  const markdown = await readEn();
  const opened = await page.evaluate(
    ({ markdown, scope, name, section, subsection }) => {
      const api = window.MarkdownFrontEditor;
      if (!api || typeof api.openForElementFromCanonical !== "function") {
        return { ok: false, reason: "api-unavailable" };
      }
      const cfg = (window.MarkdownFrontEditorConfig =
        window.MarkdownFrontEditorConfig || {});
      const pageId = String(
        cfg.pageId ||
          document.body?.getAttribute?.("data-page") ||
          document.documentElement?.getAttribute?.("data-page") ||
          "1",
      );
      const virtual = document.createElement("div");
      virtual.setAttribute("data-page", pageId);
      virtual.setAttribute("data-field-type", "container");
      virtual.setAttribute("data-mfe-scope", String(scope || "field"));
      virtual.setAttribute(
        "data-mfe-name",
        String(name || (scope === "document" ? "document" : "")),
      );
      if (section) {
        virtual.setAttribute("data-mfe-section", String(section));
      }
      if (subsection) {
        virtual.setAttribute("data-mfe-subsection", String(subsection));
      }
      virtual.setAttribute("data-mfe-markdown-kind", "canonical");
      const encoded = btoa(unescape(encodeURIComponent(String(markdown || ""))));
      virtual.setAttribute("data-markdown-b64", encoded);

      try {
        api.openForElementFromCanonical(virtual, {
          markdown: String(markdown || ""),
          applied: [],
        });
        return { ok: true, reason: "opened" };
      } catch (error) {
        return {
          ok: false,
          reason: String(error?.message || error || "open-failed"),
        };
      }
    },
    { markdown, scope, name, section, subsection },
  );
  expect(opened.ok, opened.reason).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Boolean(
            window.MarkdownFrontEditor &&
              typeof window.MarkdownFrontEditor.isOpen === "function" &&
              window.MarkdownFrontEditor.isOpen(),
          ),
      ),
    )
    .toBe(true);
  await expect(getSaveButton(page)).toBeVisible();
  if (readyContains) {
    await waitForEditorTextContains(page, readyContains);
  }
}

async function appendTokenInOpenEditor(page, token) {
  const activeTextbox = getActivePrimaryEditor(page);
  await expect(activeTextbox).toBeVisible();
  const headingTarget = activeTextbox.locator("h1, h2, h3, h4, h5, h6").first();
  if (await headingTarget.isVisible().catch(() => false)) {
    await headingTarget.click();
    await page.keyboard.press("End");
  } else {
    const editableTarget = activeTextbox.locator("p, li").first();
    if (await editableTarget.isVisible().catch(() => false)) {
      await editableTarget.click();
      await page.keyboard.press("End");
    } else {
      await activeTextbox.click();
      await page.keyboard.press("End");
    }
  }
  await page.keyboard.type(` ${token}`);
}

async function focusPrimaryEditorText(page) {
  const activeTextbox = getActivePrimaryEditor(page);
  await expect(activeTextbox).toBeVisible();
  const textTarget = activeTextbox.locator("p, h1, h2, h3, h4, h5, h6").first();
  if (await textTarget.isVisible().catch(() => false)) {
    await textTarget.click();
    return activeTextbox;
  }
  await activeTextbox.click();
  return activeTextbox;
}

async function selectPrimaryEditorTextRange(page, startOffset, endOffset) {
  await focusPrimaryEditorText(page);
  const selected = await page.evaluate(
    ({ startOffset, endOffset }) => {
      const root = document.querySelector(
        '.mfe-editor-pane--primary .mfe-editor[contenteditable="true"], .mfe-editor-pane--primary [role="textbox"][contenteditable="true"], .mfe-editor-pane--primary [contenteditable="true"]',
      );
      if (!(root instanceof HTMLElement)) return false;

      const textNodes = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        textNodes.push(node);
        node = walker.nextNode();
      }
      if (!textNodes.length) return false;

      const totalLength = textNodes.reduce(
        (sum, textNode) => sum + String(textNode.textContent || "").length,
        0,
      );
      const start = Math.max(0, Math.min(totalLength, Number(startOffset || 0)));
      const end = Math.max(start, Math.min(totalLength, Number(endOffset || 0)));

      function locate(offset) {
        let consumed = 0;
        for (const textNode of textNodes) {
          const length = String(textNode.textContent || "").length;
          const nextConsumed = consumed + length;
          if (offset <= nextConsumed) {
            return {
              node: textNode,
              offset: Math.max(0, Math.min(length, offset - consumed)),
            };
          }
          consumed = nextConsumed;
        }
        const lastNode = textNodes[textNodes.length - 1];
        return {
          node: lastNode,
          offset: String(lastNode.textContent || "").length,
        };
      }

      const startPos = locate(start);
      const endPos = locate(end);
      const selection = window.getSelection();
      if (!selection) return false;
      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      selection.removeAllRanges();
      selection.addRange(range);
      root.focus();
      return selection.toString().length === end - start;
    },
    { startOffset, endOffset },
  );
  expect(selected).toBe(true);
}

async function replaceEntirePrimaryEditorText(page, nextText) {
  const currentText = String((await getActivePrimaryEditor(page).textContent()) || "");
  await selectPrimaryEditorTextRange(page, 0, currentText.length);
  await page.keyboard.type(String(nextText || ""));
}

async function replacePrimaryEditorBoundaryText(page, direction, charCount, nextText) {
  const currentText = String((await getActivePrimaryEditor(page).textContent()) || "");
  const safeCount = Math.max(0, Math.min(currentText.length, Number(charCount || 0)));
  if (direction === "start") {
    await selectPrimaryEditorTextRange(page, 0, safeCount);
  } else {
    await selectPrimaryEditorTextRange(
      page,
      Math.max(0, currentText.length - safeCount),
      currentText.length,
    );
  }
  await page.keyboard.type(String(nextText || ""));
}

async function insertTokenBeforePrimaryEditorNeedle(page, needle, token) {
  const currentText = String((await getActivePrimaryEditor(page).textContent()) || "");
  const index = currentText.indexOf(String(needle || ""));
  expect(index, `needle not found in primary editor: ${needle}`).toBeGreaterThanOrEqual(0);
  await selectPrimaryEditorTextRange(page, index, index);
  await page.keyboard.type(String(token || ""));
}

async function insertTokenAtPrimaryEditorNeedleOffset(page, needle, offset, token) {
  const currentText = String((await getActivePrimaryEditor(page).textContent()) || "");
  const anchor = currentText.indexOf(String(needle || ""));
  expect(anchor, `needle not found in primary editor: ${needle}`).toBeGreaterThanOrEqual(0);
  const position = Math.max(
    0,
    Math.min(currentText.length, anchor + Number(offset || 0)),
  );
  await selectPrimaryEditorTextRange(page, position, position);
  await page.keyboard.type(String(token || ""));
}

async function appendTokenAndAssertVisible(page, token, maxAttempts = 3) {
  let tokenVisible = false;
  for (let attempt = 0; attempt < Number(maxAttempts || 1); attempt += 1) {
    await appendTokenInOpenEditor(page, token);
    const activeTextbox = getActivePrimaryEditor(page);
    await expect
      .poll(async () => {
        const needle = String(token || "");
        const editorText = String((await activeTextbox.textContent()) || "");
        const markdownText = await page.evaluate(() => {
          const api = window.MarkdownFrontEditor;
          return api && typeof api.getMarkdown === "function"
            ? String(api.getMarkdown() || "")
            : "";
        });
        return editorText.includes(needle) || markdownText.includes(needle);
      })
      .toBe(true);
    const editorText = String((await activeTextbox.textContent()) || "");
    const markdownText = await page.evaluate(() => {
      const api = window.MarkdownFrontEditor;
      return api && typeof api.getMarkdown === "function"
        ? String(api.getMarkdown() || "")
        : "";
    });
    tokenVisible =
      editorText.includes(String(token || "")) ||
      markdownText.includes(String(token || ""));
    if (tokenVisible) break;
    await page.waitForTimeout(250);
  }
  expect(tokenVisible).toBe(true);
}

async function assertV2SavePathForScope(page, scopeKind) {
  const metrics = await page.evaluate((scopeKind) => {
    const logs = Array.isArray(window.__MFE_DOC_STATE_LOGS)
      ? window.__MFE_DOC_STATE_LOGS
      : [];
    const v2Matches = logs.filter(
      (entry) =>
        entry &&
        entry.type === "MFE_MUTATION_PLAN_V2_APPLIED" &&
        String(entry.scopeKind || "") === String(scopeKind || ""),
    );
    const pathMatches = logs.filter(
      (entry) =>
        entry &&
        entry.type === "SAVE_PATH_SELECTED" &&
        String(entry.scopeKind || "") === String(scopeKind || ""),
    );
    const lastPath = pathMatches[pathMatches.length - 1] || null;
    return {
      v2Count: v2Matches.length,
      saveMode: String(lastPath?.mode || ""),
    };
  }, scopeKind);
  expect(metrics.v2Count).toBeGreaterThan(0);
  if (metrics.saveMode) {
    expect(metrics.saveMode).toBe("structural-mutation-v2");
  }
}

async function waitForEditorTextContains(page, needle) {
  const editor = getActivePrimaryEditor(page);
  await expect(editor).toBeVisible();
  await expect
    .poll(
      async () => String((await editor.textContent()) || ""),
      { timeout: 10000 },
    )
    .toContain(String(needle || ""));
}

async function waitForSecondaryEditorTextContains(page, needle) {
  const editor = getActiveSecondaryEditor(page);
  await expect(editor).toBeVisible();
  await expect
    .poll(
      async () => String((await editor.textContent()) || ""),
      { timeout: 10000 },
    )
    .toContain(String(needle || ""));
}

async function clickBreadcrumbLink(page, labelMatcher) {
  const link = page.getByRole("link", { name: labelMatcher }).first();
  await expect(link).toBeVisible();
  await link.click();
}

async function getCurrentBreadcrumbLabel(page) {
  return page.evaluate(() => {
    const windows = Array.from(
      document.querySelectorAll('[data-mfe-window="true"]'),
    );
    const activeWindow = windows[windows.length - 1] || null;
    const current = activeWindow?.querySelector(".mfe-breadcrumb-current");
    return String(current?.textContent || "").trim();
  });
}

async function assertNoCriticalDocStateEvents(page, contextLabel) {
  const critical = await page.evaluate(() => {
    const logs = Array.isArray(window.__MFE_DOC_STATE_LOGS)
      ? window.__MFE_DOC_STATE_LOGS
      : [];
    const blockedTypes = [
      "STATE_SAVE_FAILED",
      "MFE_SAVE_SAFETY_BLOCKED",
      "MFE_SCOPE_SESSION_LOCK_CONFLICT",
      "MFE_DIRTY_DESYNC_RECONCILE_FAILED",
    ];
    return logs
      .filter((entry) => entry && blockedTypes.includes(String(entry.type || "")))
      .map((entry) => ({
        type: String(entry.type || ""),
        reason: String(entry.reason || ""),
        error: String(entry.error || ""),
        scopeKind: String(entry.scopeKind || ""),
        scopeKeyExpected: String(entry.scopeKeyExpected || ""),
        scopeKeyActual: String(entry.scopeKeyActual || ""),
      }));
  });
  expect(
    critical,
    `${contextLabel}: critical doc-state events detected`,
  ).toEqual([]);
}

function assertNoCriticalConsoleSince(consoleIssues, cursor, contextLabel) {
  const next = consoleIssues.slice(Math.max(0, Number(cursor || 0)));
  expect(next, `${contextLabel}: critical console diagnostics detected`).toEqual(
    [],
  );
}

async function assertNoMarkerTextLeakInEditor(page, contextLabel) {
  const leaked = await page.evaluate(() => {
    const editor = document.querySelector(
      '.mfe-editor-pane--primary [role="textbox"][contenteditable="true"], .mfe-editor-pane--primary [contenteditable="true"]',
    );
    if (!(editor instanceof HTMLElement)) {
      return { leaked: false, html: "", text: "" };
    }
    const html = String(editor.innerHTML || "");
    const text = String(editor.textContent || "");
    const escapedLeak =
      html.includes("&lt;!-- section:") ||
      html.includes("&lt;!-- sub:") ||
      html.includes("&lt;!-- mfe-gap:");
    const rawTextLeak =
      text.includes("<!-- section:") ||
      text.includes("<!-- sub:") ||
      text.includes("<!-- mfe-gap:");
    return {
      leaked: escapedLeak || rawTextLeak,
      html,
      text,
    };
  });

  expect(
    leaked.leaked,
    `${contextLabel}: marker comment text leaked into editable rendering`,
  ).toBe(false);
}

async function readStatusBadge(page) {
  return page.evaluate(() => {
    const status =
      document.querySelector(".editor-toolbar-status") ||
      document.querySelector(".mfe-status-text");
    if (!(status instanceof HTMLElement)) {
      return { text: "", visible: false, className: "" };
    }
    return {
      text: String(status.textContent || "").trim(),
      visible: status.classList.contains("is-visible"),
      className: String(status.className || ""),
    };
  });
}

async function expectStatusEmpty(page, contextLabel) {
  await expect
    .poll(async () => {
      const status = await readStatusBadge(page);
      return status.visible || status.text !== "";
    })
    .toBe(false);
}

async function expectStatusText(page, expectedText, contextLabel) {
  await expect
    .poll(async () => {
      const status = await readStatusBadge(page);
      return {
        text: status.text,
        visible: status.visible,
      };
    })
    .toEqual({
      text: String(expectedText || ""),
      visible: true,
    });
}

async function settleToNoChangesStatus(page) {
  await page.getByRole("button", { name: /Save changes/i }).click();
  await expect
    .poll(async () => {
      const status = await readStatusBadge(page);
      return status.text;
    })
    .toMatch(/^(Saved|No changes|Draft|)$/);
  await page.getByRole("button", { name: /Save changes/i }).click();
  await expectStatusText(page, "No changes", "status:no-changes");
}

async function waitForPersistedTokenOrThrow({
  page,
  token,
  contextLabel,
  consoleIssues,
  consoleCursor,
}) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if ((await readEn()).includes(String(token || ""))) {
      return;
    }
    const criticalSince = Array.isArray(consoleIssues)
      ? consoleIssues.slice(Math.max(0, Number(consoleCursor || 0)))
      : [];
    if (criticalSince.length > 0) {
      throw new Error(
        `${contextLabel}: critical console diagnostics: ${criticalSince.join(" | ")}`,
      );
    }
    const failedMessage = await page.evaluate(() => {
      const logs = Array.isArray(window.__MFE_DOC_STATE_LOGS)
        ? window.__MFE_DOC_STATE_LOGS
        : [];
      const failed = [...logs]
        .reverse()
        .find((event) => event && event.type === "STATE_SAVE_FAILED");
      if (failed?.error) {
        return `STATE_SAVE_FAILED:${String(failed.error || "")}`;
      }
      const reconcileFailed = [...logs]
        .reverse()
        .find(
          (event) => event && event.type === "MFE_DIRTY_DESYNC_RECONCILE_FAILED",
        );
      if (reconcileFailed?.error) {
        return `MFE_DIRTY_DESYNC_RECONCILE_FAILED:${String(
          reconcileFailed.error || "",
        )}`;
      }
      const safetyBlocked = [...logs]
        .reverse()
        .find((event) => event && event.type === "MFE_SAVE_SAFETY_BLOCKED");
      if (safetyBlocked) {
        return `MFE_SAVE_SAFETY_BLOCKED:${String(
          safetyBlocked.reason || "",
        )}:${String(safetyBlocked.scopeKeyExpected || "")}:${String(
          safetyBlocked.scopeKeyActual || "",
        )}`;
      }
      return "";
    });
    if (failedMessage) {
      throw new Error(`${contextLabel}: ${failedMessage}`);
    }
    await page.waitForTimeout(200);
  }
  const tail = await page.evaluate(() => {
    const logs = Array.isArray(window.__MFE_DOC_STATE_LOGS)
      ? window.__MFE_DOC_STATE_LOGS
      : [];
    return logs.slice(-20).map((entry) => ({
      type: String(entry?.type || ""),
      reason: String(entry?.reason || ""),
      scopeKind: String(entry?.scopeKind || ""),
      currentScope: String(entry?.currentScope || ""),
      mode: String(entry?.mode || ""),
      scopeKeyExpected: String(entry?.scopeKeyExpected || ""),
      scopeKeyActual: String(entry?.scopeKeyActual || ""),
      hashAfter: String(entry?.hashAfter || ""),
      error: String(entry?.error || ""),
    }));
  });
  throw new Error(
    `${contextLabel}: token not persisted after save; docStateTail=${JSON.stringify(tail)}`,
  );
}

test.describe("document save roundtrip", () => {
  test.describe.configure({ mode: "serial" });

  test("document split edit preserves marker+heading structure", async ({
    page,
  }) => {
    await normalizeHeroTitleToBaseline();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const runtimeAvailability = await page.evaluate(() => ({
      hasFullscreenApi:
        typeof window.MarkdownFrontEditor?.openForElement === "function",
      hasInlineApi:
        typeof window.MarkdownFrontEditorInline?.openForElement === "function",
      hostCount: document.querySelectorAll("[data-mfe]").length,
    }));
    expect(
      runtimeAvailability.hasFullscreenApi || runtimeAvailability.hasInlineApi,
      `frontend editor runtime unavailable (hosts=${runtimeAvailability.hostCount})`,
    ).toBe(true);

    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await navigateToDocumentScope(page);

    const splitButton = page.getByRole("button", { name: "View languages" });
    await expect(splitButton).toBeVisible();
    await splitButton.click();

    const languageSelect = page.getByRole("combobox").first();
    await expect(languageSelect).toBeVisible();
    await languageSelect.selectOption({ label: "Italian" }).catch(() => {});
    await languageSelect.selectOption({ label: "Spanish" });

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const editors = Array.from(
            document.querySelectorAll("[contenteditable='true']"),
          );
          return editors.map((editor) =>
            Number((editor?.innerText || "").trim().length || 0),
          );
        }),
      )
      .toEqual(expect.arrayContaining([expect.any(Number)]));

    await page.evaluate(() => {
      const editors = Array.from(
        document.querySelectorAll("[contenteditable='true']"),
      );
      const targetEditor = editors.find((editor) =>
        String(editor?.innerText || "").includes("The Urban") &&
        String(editor?.innerText || "").includes("Farm"),
      );
      if (!targetEditor) {
        const editorLengths = editors.map((editor) =>
          Number((editor?.innerText || "").trim().length || 0),
        );
        throw new Error(
          `english token not found in editable panes; lengths=${editorLengths.join(",")}`,
        );
      }

      const walker = document.createTreeWalker(targetEditor, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let replaced = false;
      while (node) {
        const value = String(node.nodeValue || "");
        if (value.includes("Farm")) {
          node.nodeValue = value.replace("Farm", "Farms");
          replaced = true;
          break;
        }
        node = walker.nextNode();
      }

      if (!replaced) {
        throw new Error("english title token not found");
      }

      targetEditor.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: "s" }),
      );
    });

    await page.getByRole("button", { name: /Save changes/i }).click();

    await expect
      .poll(async () => {
        const markdown = await readEn();
        return HERO_BLOCK_REGEX_EN.test(markdown);
      })
      .toBe(true);
  });

  test("split save persists selected secondary language content", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await navigateToDocumentScope(page);

    const splitButton = page.getByRole("button", { name: "View languages" });
    await expect(splitButton).toBeVisible();
    await splitButton.click();

    const languageSelect = page.getByRole("combobox").first();
    await expect(languageSelect).toBeVisible();
    await languageSelect.selectOption({ label: "Spanish" });

    const secondaryEditor = getActiveSecondaryEditor(page);
    await expect(secondaryEditor).toBeVisible();

    const token = `SPLIT_SECONDARY_TOKEN_${Date.now()}`;
    await secondaryEditor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(` ${token}`);

    await page.getByRole("button", { name: /Save changes/i }).click();

    await expect
      .poll(async () => (await readEs()).includes(token), { timeout: 20000 })
      .toBe(true);
    await expect
      .poll(async () => (await readEn()).includes(token), { timeout: 5000 })
      .toBe(false);
  });

  test("document save preserves frontmatter spacing and boundary separator", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await navigateToDocumentScope(page);

    const token = `FM_PRESERVE_${Date.now()}`;
    await appendTokenAndAssertVisible(page, token);
    await page.getByRole("button", { name: /Save changes/i }).click();

    await expect
      .poll(async () => (await readEn()).includes(token), { timeout: 20000 })
      .toBe(true);

    const saved = await readEn();
    const lines = String(saved || "").split(/\r?\n/);
    const nameLine = lines.find((line) => line.startsWith("name:"));

    expect(nameLine).toBe("name: ");
    expect(saved).toMatch(/---\r?\n\r?\n<!-- section:hero -->/);
  });

  test("document save preserves intentional multi-blankline spacing around markers", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const baseline = await readEn();
    const normalizedBaseline = String(baseline || "").replace(/\r\n/g, "\n");
    const withIntentionalSpacing = normalizedBaseline
      .replace(
        /---\n\n<!-- section:hero -->/,
        "---\n\n\n<!-- section:hero -->",
      )
      .replace(
        /(tech collide\.)\n\n<!-- section:columns -->/,
        "$1\n\n\n\n<!-- section:columns -->",
      );
    await fs.writeFile(EN_FILE, withIntentionalSpacing, "utf8");

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    await openScopeFromCanonical(page, {
      scope: "document",
      name: "document",
      readyContains: "The Urban",
    });

    const token = `BLANKLINE_KEEP_${Date.now()}`;
    await appendTokenAndAssertVisible(page, token);
    await page.getByRole("button", { name: /Save changes/i }).click();

    await expect
      .poll(async () => (await readEn()).includes(token), { timeout: 20000 })
      .toBe(true);

    const saved = String(await readEn() || "").replace(/\r\n/g, "\n");
    expect(saved).toContain("---\n\n\n<!-- section:hero -->");
    expect(saved).toContain("tech collide.\n\n\n\n<!-- section:columns -->");
  });

  test("document save preserves emphasis delimiter choices", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await navigateToDocumentScope(page);

    const token = `EM_DELIM_${Date.now()}`;
    await appendTokenAndAssertVisible(page, token);
    await page.getByRole("button", { name: /Save changes/i }).click();

    await expect
      .poll(async () => (await readEn()).includes(token), { timeout: 20000 })
      .toBe(true);

    const saved = await readEn();
    expect(saved).toContain(
      "__bold__ **bold** *italic* _italic_ ~~strike~~ `inline code`",
    );
    expect(saved).not.toContain(
      "**bold** **bold** _italic_ _italic_ ~~strike~~ `inline code`",
    );
  });

  test("first breadcrumb switch to document scope hydrates full content", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await navigateToDocumentScope(page);
    await ensureDocumentScopeHydrated(page);
  });

  test("mismatched stamped key does not drop field breadcrumb for field scope", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const markdown = await readEn();
    const opened = await page.evaluate((nextMarkdown) => {
      const api = window.MarkdownFrontEditor;
      if (!api || typeof api.openForElementFromCanonical !== "function") {
        return { ok: false, reason: "api-unavailable" };
      }
      const cfg = (window.MarkdownFrontEditorConfig =
        window.MarkdownFrontEditorConfig || {});
      const pageId = String(
        cfg.pageId ||
          document.body?.getAttribute?.("data-page") ||
          document.documentElement?.getAttribute?.("data-page") ||
          "1",
      );
      const virtual = document.createElement("div");
      virtual.setAttribute("data-page", pageId);
      virtual.setAttribute("data-field-type", "heading");
      virtual.setAttribute("data-mfe-scope", "field");
      virtual.setAttribute("data-mfe-name", "title");
      virtual.setAttribute("data-mfe-section", "hero");
      virtual.setAttribute("data-mfe-subsection", "");
      // Intentional mismatch: stamped key points to subsection identity.
      virtual.setAttribute("data-mfe-key", "subsection:hero:title");
      virtual.setAttribute("data-mfe-markdown-kind", "canonical");
      const encoded = btoa(unescape(encodeURIComponent(String(nextMarkdown || ""))));
      virtual.setAttribute("data-markdown-b64", encoded);
      try {
        api.openForElementFromCanonical(virtual, {
          markdown: String(nextMarkdown || ""),
          applied: [],
        });
        return { ok: true, reason: "opened" };
      } catch (error) {
        return {
          ok: false,
          reason: String(error?.message || error || "open-failed"),
        };
      }
    }, markdown);
    expect(opened.ok, opened.reason).toBe(true);
    await expect(getSaveButton(page)).toBeVisible();

    await expect
      .poll(() => getCurrentBreadcrumbLabel(page), { timeout: 10000 })
      .toBe("Field: title");
  });

  test("field breadcrumb stays visible after breadcrumb switch to section", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const markdown = await readEn();
    const opened = await page.evaluate((nextMarkdown) => {
      const api = window.MarkdownFrontEditor;
      if (!api || typeof api.openForElementFromCanonical !== "function") {
        return { ok: false, reason: "api-unavailable" };
      }
      const cfg = (window.MarkdownFrontEditorConfig =
        window.MarkdownFrontEditorConfig || {});
      const pageId = String(
        cfg.pageId ||
          document.body?.getAttribute?.("data-page") ||
          document.documentElement?.getAttribute?.("data-page") ||
          "1",
      );
      const virtual = document.createElement("div");
      virtual.setAttribute("data-page", pageId);
      virtual.setAttribute("data-field-type", "heading");
      virtual.setAttribute("data-mfe-scope", "field");
      virtual.setAttribute("data-mfe-name", "title");
      virtual.setAttribute("data-mfe-section", "hero");
      virtual.setAttribute("data-mfe-subsection", "");
      virtual.setAttribute("data-mfe-key", "subsection:hero:title");
      virtual.setAttribute("data-mfe-markdown-kind", "canonical");
      const encoded = btoa(unescape(encodeURIComponent(String(nextMarkdown || ""))));
      virtual.setAttribute("data-markdown-b64", encoded);
      try {
        api.openForElementFromCanonical(virtual, {
          markdown: String(nextMarkdown || ""),
          applied: [],
        });
        return { ok: true, reason: "opened" };
      } catch (error) {
        return {
          ok: false,
          reason: String(error?.message || error || "open-failed"),
        };
      }
    }, markdown);
    expect(opened.ok, opened.reason).toBe(true);

    await clickBreadcrumbLink(page, /^Section:\s*hero$/i);
    await expect
      .poll(() => getCurrentBreadcrumbLabel(page), { timeout: 10000 })
      .toBe("Section: hero");
    await expect(page.getByRole("link", { name: /^Field:\s*title$/i }).first()).toBeVisible();
  });

  test("outline toggle keeps current scope and shows markers in single view", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await openScopeFromCanonical(page, {
      scope: "field",
      name: "title",
      section: "hero",
      subsection: "",
      readyContains: "The Urban",
    });

    const scopeBefore = await getCurrentBreadcrumbLabel(page);
    expect(scopeBefore).toBeTruthy();

    const outlineBtn = page.getByRole("button", { name: /View outline/i }).first();
    await expect(outlineBtn).toBeVisible();
    await outlineBtn.click();

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const inDocumentMode = document.body.classList.contains(
              "mfe-state-document-mode",
            );
            const markerCount = document.querySelectorAll(".mfe-doc-marker").length;
            const activeRailCount =
              document.querySelectorAll(".mfe-doc-segment--active").length;
            return inDocumentMode && markerCount > 0 && activeRailCount > 0;
          }),
        { timeout: 10000 },
      )
      .toBe(true);

    const scopeAfterEnable = await getCurrentBreadcrumbLabel(page);
    expect(scopeAfterEnable).toBe(scopeBefore);

    await outlineBtn.click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => !document.body.classList.contains("mfe-state-document-mode"),
          ),
        { timeout: 10000 },
      )
      .toBe(true);

    const scopeAfterDisable = await getCurrentBreadcrumbLabel(page);
    expect(scopeAfterDisable).toBe(scopeBefore);
  });

  test("outline markers render before matched section content in synthetic marker mode", async ({
    page,
  }) => {
    await resetHomesFromFixtures();
    await appendOutlineOrderingFixture();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    await openScopeFromCanonical(page, {
      scope: "document",
      name: "document",
      readyContains: "The Urban",
    });

    const outlineBtn = page.getByRole("button", { name: /View outline/i }).first();
    await expect(outlineBtn).toBeVisible();
    await outlineBtn.click();

    const order = await page.evaluate(() => {
      const root = document.querySelector(".mfe-editor-pane--primary .ProseMirror");
      if (!(root instanceof HTMLElement)) return [];
      return Array.from(root.children).map((element) => {
        const marker = String(
          element.getAttribute?.("data-mfe-marker") ||
            element.getAttribute?.("data-mfe-doc-label") ||
            "",
        );
        const docLabel = String(element.getAttribute?.("data-mfe-doc-label") || "");
        const text = String(element.textContent || "").trim();
        return {
          tag: String(element.tagName || "").toLowerCase(),
          marker,
          docLabel,
          text,
        };
      });
    });

    const findIndex = (matcher) => order.findIndex((entry) => matcher(entry));
    const sectionHeroMarkerIndex = findIndex(
      (entry) => entry.marker === "section:hero",
    );
    const fieldHeroTitleMarkerIndex = findIndex(
      (entry) => entry.marker === "title" && /field:hero\/title/.test(entry.docLabel),
    );
    const heroHeadingIndex = findIndex(
      (entry) => entry.tag === "h1" && entry.text.includes("The Urban"),
    );
    const fieldHeroIntroMarkerIndex = findIndex(
      (entry) =>
        entry.marker === "intro..." && /field:hero\/intro\.\.\./.test(entry.docLabel),
    );
    const heroIntroParagraphIndex = findIndex(
      (entry) =>
        entry.tag === "p" &&
        entry.text.includes("We grow food and ideas in the city"),
    );
    const sectionColumnsMarkerIndex = findIndex(
      (entry) => entry.marker === "section:columns",
    );
    const sectionBodyMarkerIndex = findIndex(
      (entry) => entry.marker === "section:body",
    );
    const sectionBodyHeadingIndex = findIndex(
      (entry) =>
        entry.tag === "h2" &&
        entry.text.includes("Forget"),
    );
    const sectionAboutMarkerIndex = findIndex(
      (entry) => entry.marker === "section:about",
    );
    const fieldAboutTitleMarkerIndex = findIndex(
      (entry) => entry.marker === "title" && /field:about\/title/.test(entry.docLabel),
    );
    const sectionAboutHeadingIndex = findIndex(
      (entry) => entry.tag === "h2" && entry.text === "Chi sono",
    );

    expect(sectionHeroMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(fieldHeroTitleMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(heroHeadingIndex).toBeGreaterThanOrEqual(0);
    expect(fieldHeroIntroMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(heroIntroParagraphIndex).toBeGreaterThanOrEqual(0);
    expect(sectionColumnsMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(sectionHeroMarkerIndex).toBeLessThan(fieldHeroTitleMarkerIndex);
    expect(fieldHeroTitleMarkerIndex).toBeLessThan(heroHeadingIndex);
    expect(heroHeadingIndex).toBeLessThan(fieldHeroIntroMarkerIndex);
    expect(fieldHeroIntroMarkerIndex).toBeLessThan(heroIntroParagraphIndex);
    expect(heroIntroParagraphIndex).toBeLessThan(sectionColumnsMarkerIndex);
    expect(sectionBodyMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(sectionBodyHeadingIndex).toBeGreaterThanOrEqual(0);
    expect(sectionAboutMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(sectionAboutHeadingIndex).toBeGreaterThanOrEqual(0);
    expect(sectionBodyMarkerIndex).toBeLessThan(sectionBodyHeadingIndex);
    expect(sectionAboutMarkerIndex).toBeGreaterThan(sectionBodyHeadingIndex);
    expect(Math.abs(sectionAboutMarkerIndex - sectionAboutHeadingIndex)).toBeLessThanOrEqual(4);
    if (fieldAboutTitleMarkerIndex >= 0) {
      expect(Math.abs(fieldAboutTitleMarkerIndex - sectionAboutHeadingIndex)).toBeLessThanOrEqual(3);
    }
  });

  test("outline markers keep body/predictable/about order on long mixed document", async ({
    page,
  }) => {
    await resetHomeFromFixture(EN_LONG_OUTLINE_BASELINE_FILE);

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    await openScopeFromCanonical(page, {
      scope: "document",
      name: "document",
      readyContains: "The Urban",
    });

    const outlineBtn = page.getByRole("button", { name: /View outline/i }).first();
    await expect(outlineBtn).toBeVisible();
    await outlineBtn.click();

    const order = await page.evaluate(() => {
      const root = document.querySelector(".mfe-editor-pane--primary .ProseMirror");
      if (!(root instanceof HTMLElement)) return [];
      return Array.from(root.children).map((element) => ({
        tag: String(element.tagName || "").toLowerCase(),
        marker: String(element.getAttribute?.("data-mfe-marker") || ""),
        docLabel: String(element.getAttribute?.("data-mfe-doc-label") || ""),
        text: String(element.textContent || "").trim(),
      }));
    });

    const findIndex = (matcher) => order.findIndex((entry) => matcher(entry));
    const sectionBodyMarkerIndex = findIndex(
      (entry) => entry.marker === "section:body",
    );
    const sectionBodyHeadingIndex = findIndex(
      (entry) => entry.tag === "h2" && entry.text.includes("Forget"),
    );
    const predictableMarkerIndex = findIndex(
      (entry) =>
        entry.marker === "predictable" &&
        /field:body\/predictable/.test(entry.docLabel),
    );
    const predictableParagraphIndex = findIndex(
      (entry) =>
        entry.tag === "p" &&
        entry.text.includes("Every plot starts small"),
    );
    const sectionAboutMarkerIndex = findIndex(
      (entry) => entry.marker === "section:about",
    );
    const aboutHeadingIndex = findIndex(
      (entry) => entry.tag === "h2" && entry.text === "Chi sono",
    );

    expect(sectionBodyMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(sectionBodyHeadingIndex).toBeGreaterThanOrEqual(0);
    expect(predictableMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(predictableParagraphIndex).toBeGreaterThanOrEqual(0);
    expect(sectionAboutMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(aboutHeadingIndex).toBeGreaterThanOrEqual(0);

    expect(sectionBodyMarkerIndex).toBeLessThan(sectionBodyHeadingIndex);
    expect(predictableMarkerIndex).toBeLessThan(predictableParagraphIndex);
    expect(predictableMarkerIndex).toBeLessThan(sectionAboutMarkerIndex);
    expect(sectionAboutMarkerIndex).toBeLessThan(aboutHeadingIndex);
  });

  test("outline toggle keeps current scope and applies markers in split secondary editor", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await openScopeFromCanonical(page, {
      scope: "field",
      name: "title",
      section: "hero",
      subsection: "",
      readyContains: "The Urban",
    });

    const scopeBefore = await getCurrentBreadcrumbLabel(page);
    expect(scopeBefore).toBeTruthy();

    await ensureSplitLanguageSelected(page, "Spanish");

    const outlineBtn = page.getByRole("button", { name: /View outline/i }).first();
    await expect(outlineBtn).toBeVisible();
    await outlineBtn.click();

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const inDocumentMode = document.body.classList.contains(
              "mfe-state-document-mode",
            );
            const primaryPane = document.querySelector(
              ".mfe-editor-pane--primary .ProseMirror",
            );
            const secondaryPane = document.querySelector(
              ".mfe-editor-pane--secondary .ProseMirror",
            );
            const count = (root, selector) =>
              root ? root.querySelectorAll(selector).length : 0;
            const primaryMarkerCount = count(primaryPane, ".mfe-doc-marker");
            const secondaryMarkerCount = count(secondaryPane, ".mfe-doc-marker");
            const secondaryActiveRailCount = count(
              secondaryPane,
              ".mfe-doc-segment--active",
            );
            return (
              inDocumentMode &&
              primaryMarkerCount > 0 &&
              secondaryMarkerCount > 0 &&
              secondaryActiveRailCount > 0
            );
          }),
        { timeout: 10000 },
      )
      .toBe(true);

    const scopeAfterEnable = await getCurrentBreadcrumbLabel(page);
    expect(scopeAfterEnable).toBe(scopeBefore);
  });

  test("document lens keeps unsaved changes across scopes before save", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await navigateToDocumentScope(page);

    const token = `LENS_DOC_SCOPE_TOKEN_${Date.now()}`;
    await appendTokenAndAssertVisible(page, token);

    await clickBreadcrumbLink(page, /Section:/i);
    await waitForEditorTextContains(page, token);

    const explicitFieldTitle = page
      .getByRole("link", { name: /Field:\s*title/i })
      .first();
    if (await explicitFieldTitle.isVisible({ timeout: 1500 }).catch(() => false)) {
      await explicitFieldTitle.click();
      await waitForEditorTextContains(page, token);
    } else {
      const genericTitleLink = page.getByRole("link", { name: /title/i }).first();
      if (await genericTitleLink.isVisible({ timeout: 1500 }).catch(() => false)) {
        await genericTitleLink.click();
        await waitForEditorTextContains(page, token);
      }
    }

    await clickBreadcrumbLink(page, /^Document$/i);
    await waitForEditorTextContains(page, token);

    await page.getByRole("button", { name: /Save changes/i }).click();
    await expect
      .poll(async () => (await readEn()).includes(token), { timeout: 20000 })
      .toBe(true);
    await assertNoCriticalDocStateEvents(
      page,
      "document-lens-persists-unsaved-single-language",
    );
  });

  test("status lifecycle works in single editor mode", async ({ page }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await expectStatusEmpty(page, "single:open-empty");
    await settleToNoChangesStatus(page);

    const token = `STATUS_SINGLE_${Date.now()}`;
    await appendTokenAndAssertVisible(page, token);
    await expectStatusText(page, "Draft", "single:draft");

    await page.getByRole("button", { name: /Save changes/i }).click();
    await expectStatusText(page, "Saved", "single:saved");
    await expect
      .poll(async () => (await readEn()).includes(token), { timeout: 20000 })
      .toBe(true);
  });

  test("field lens edit is immediately visible in section lens before save", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    const token = `LENS_FIELD_TO_SECTION_${Date.now()}`;
    await appendTokenAndAssertVisible(page, token);
    await expectStatusText(page, "Draft", "field-section:draft");

    await clickBreadcrumbLink(page, /Section:/i);
    await waitForEditorTextContains(page, token);

    const explicitFieldTitle = page
      .getByRole("link", { name: /Field:\s*title/i })
      .first();
    if (await explicitFieldTitle.isVisible({ timeout: 1500 }).catch(() => false)) {
      await explicitFieldTitle.click();
      await waitForEditorTextContains(page, token);
    } else {
      const genericTitleLink = page.getByRole("link", { name: /title/i }).first();
      if (await genericTitleLink.isVisible({ timeout: 1500 }).catch(() => false)) {
        await genericTitleLink.click();
        await waitForEditorTextContains(page, token);
      }
    }

    await page.getByRole("button", { name: /Save changes/i }).click();
    await expectStatusText(page, "Saved", "field-section:saved");
    await expect
      .poll(async () => (await readEn()).includes(token), { timeout: 20000 })
      .toBe(true);
    await assertNoCriticalDocStateEvents(
      page,
      "field-lens-unsaved-visible-in-section-before-save",
    );
  });

  test("document split lens keeps unsaved edits across scopes and languages", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await navigateToDocumentScope(page);

    const splitButton = page.getByRole("button", { name: "View languages" });
    await expect(splitButton).toBeVisible();
    await splitButton.click();

    const languageSelect = page.getByRole("combobox").first();
    await expect(languageSelect).toBeVisible();
    await languageSelect.selectOption({ label: "Spanish" });

    const enToken = `LENS_MULTI_EN_${Date.now()}`;
    const esToken = `LENS_MULTI_ES_${Date.now()}`;

    await appendTokenAndAssertVisible(page, enToken);
    await appendTokenInSecondaryEditor(page, esToken);
    await waitForSecondaryEditorTextContains(page, esToken);

    await clickBreadcrumbLink(page, /Section:/i);
    await waitForEditorTextContains(page, enToken);
    await waitForSecondaryEditorTextContains(page, esToken);

    const fieldTitle = page.getByRole("link", { name: /Field:\s*title/i }).first();
    if (await fieldTitle.isVisible({ timeout: 1500 }).catch(() => false)) {
      await fieldTitle.click();
    } else {
      const genericTitleLink = page.getByRole("link", { name: /title/i }).first();
      if (await genericTitleLink.isVisible({ timeout: 1500 }).catch(() => false)) {
        await genericTitleLink.click();
      }
    }
    await waitForEditorTextContains(page, enToken);
    await waitForSecondaryEditorTextContains(page, esToken);

    await languageSelect.selectOption({ label: "Italian" }).catch(() => {});
    await languageSelect.selectOption({ label: "Spanish" });
    await waitForSecondaryEditorTextContains(page, esToken);

    await clickBreadcrumbLink(page, /^Document$/i);
    await waitForEditorTextContains(page, enToken);
    await waitForSecondaryEditorTextContains(page, esToken);

    await page.getByRole("button", { name: /Save changes/i }).click();

    await expect
      .poll(async () => (await readEn()).includes(enToken), { timeout: 20000 })
      .toBe(true);
    await expect
      .poll(async () => (await readEs()).includes(esToken), { timeout: 20000 })
      .toBe(true);
    await expect
      .poll(async () => (await readEn()).includes(esToken), { timeout: 5000 })
      .toBe(false);
    await assertNoCriticalDocStateEvents(
      page,
      "document-lens-persists-unsaved-multi-language",
    );
  });

  test("status lifecycle works in split multi-language mode", async ({ page }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await navigateToDocumentScope(page);
    await expectStatusEmpty(page, "split:open-empty");
    await settleToNoChangesStatus(page);

    const splitButton = page.getByRole("button", { name: "View languages" });
    await expect(splitButton).toBeVisible();
    await splitButton.click();

    const languageSelect = page.getByRole("combobox").first();
    await expect(languageSelect).toBeVisible();
    await languageSelect.selectOption({ label: "Spanish" });

    const token = `STATUS_SPLIT_ES_${Date.now()}`;
    await appendTokenInSecondaryEditor(page, token);
    await waitForSecondaryEditorTextContains(page, token);
    await expectStatusText(page, "Draft", "split:draft");

    await page.getByRole("button", { name: /Save changes/i }).click();
    await expectStatusText(page, "Saved", "split:saved");
    await expect
      .poll(async () => (await readEs()).includes(token), { timeout: 20000 })
      .toBe(true);
  });

  test("status lifecycle is correct on every scope in single mode", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await expectStatusEmpty(page, "status-scope-single:open-empty");

    for (const entry of STATUS_SCOPE_MATRIX) {
      await openScopeFromCanonical(page, entry);

      await settleToNoChangesStatus(page);

      const token = `STATUS_SCOPE_SINGLE_${entry.scopeKind.toUpperCase()}_${Date.now()}`;
      await appendTokenAndAssertVisible(page, token);
      await expectStatusText(
        page,
        "Draft",
        `status-scope-single:${entry.scopeKind}:draft`,
      );

      await page.getByRole("button", { name: /Save changes/i }).click();
      await expectStatusText(
        page,
        "Saved",
        `status-scope-single:${entry.scopeKind}:saved`,
      );
      await expect
        .poll(async () => (await readEn()).includes(token), { timeout: 20000 })
        .toBe(true);
      await assertV2SavePathForScope(page, entry.scopeKind);
    }
  });

  test("status lifecycle is correct on every scope in split mode", async ({
    page,
  }) => {
    await resetHomesFromFixtures();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await expectStatusEmpty(page, "status-scope-split:open-empty");

    for (const entry of STATUS_SCOPE_MATRIX) {
      await openScopeFromCanonical(page, entry);
      await ensureSplitLanguageSelected(page, "Spanish");

      await settleToNoChangesStatus(page);

      const tokenEn = `STATUS_SCOPE_SPLIT_EN_${entry.scopeKind.toUpperCase()}_${Date.now()}`;
      const tokenEs = `STATUS_SCOPE_SPLIT_ES_${entry.scopeKind.toUpperCase()}_${Date.now()}`;

      await appendTokenAndAssertVisible(page, tokenEn);
      await appendTokenInSecondaryEditor(page, tokenEs);
      await waitForSecondaryEditorTextContains(page, tokenEs);
      await expectStatusText(
        page,
        "Draft",
        `status-scope-split:${entry.scopeKind}:draft`,
      );

      await page.getByRole("button", { name: /Save changes/i }).click();
      await expectStatusText(
        page,
        "Saved",
        `status-scope-split:${entry.scopeKind}:saved`,
      );
      await expect
        .poll(async () => (await readEn()).includes(tokenEn), { timeout: 20000 })
        .toBe(true);
      await expect
        .poll(async () => (await readEs()).includes(tokenEs), { timeout: 20000 })
        .toBe(true);
      await assertV2SavePathForScope(page, entry.scopeKind);
    }
  });

  test("v2 sequential save matrix uses one pipeline for field/subsection/section/document", async ({
    page,
  }) => {
    await normalizeV2MatrixBaseline();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");

    const runtimeAvailability = await page.evaluate(() => ({
      hasFullscreenApi:
        typeof window.MarkdownFrontEditor?.openForElement === "function",
      hasInlineApi:
        typeof window.MarkdownFrontEditorInline?.openForElement === "function",
      hostCount: document.querySelectorAll("[data-mfe]").length,
    }));
    expect(
      runtimeAvailability.hasFullscreenApi || runtimeAvailability.hasInlineApi,
      `frontend editor runtime unavailable (hosts=${runtimeAvailability.hostCount})`,
    ).toBe(true);

    const matrix = [
      {
        scope: "field",
        name: "title",
        section: "hero",
        subsection: "",
        token: "V2_FIELD_SCOPE_TOKEN",
        expectToken: "V2_FIELD_SCOPE_TOKEN",
        scopeKind: "field",
        readyContains: "The Urban",
      },
      {
        scope: "subsection",
        name: "right",
        section: "columns",
        subsection: "right",
        token: "V2_SUBSECTION_SCOPE_TOKEN",
        expectToken: "V2_SUBSECTION_SCOPE_TOKEN",
        scopeKind: "subsection",
        readyContains: "How we work",
      },
      {
        scope: "section",
        name: "hero",
        section: "hero",
        subsection: "",
        token: "V2_SECTION_SCOPE_TOKEN",
        expectToken: "V2_SECTION_SCOPE_TOKEN",
        scopeKind: "section",
        readyContains: "The Urban",
      },
      {
        scope: "document",
        name: "document",
        section: "",
        subsection: "",
        token: "V2_DOCUMENT_SCOPE_TOKEN",
        expectToken: "V2_DOCUMENT_SCOPE_TOKEN",
        scopeKind: "document",
        readyContains: "The Urban",
      },
    ];

    for (const entry of matrix) {
      await openScopeFromCanonical(page, entry);
      let tokenStableInEditor = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await appendTokenInOpenEditor(page, entry.token);
        await expect
          .poll(() =>
            page.evaluate((nextToken) => {
              const editor = document.querySelector(
                '[role="textbox"][contenteditable="true"]',
              );
              const editorText = String(editor?.textContent || "");
              const markdownText = String(
                window.MarkdownFrontEditor &&
                  typeof window.MarkdownFrontEditor.getMarkdown === "function"
                  ? window.MarkdownFrontEditor.getMarkdown()
                  : "",
              );
              const needle = String(nextToken || "");
              return (
                editorText.includes(needle) ||
                markdownText.includes(needle)
              );
            }, entry.token),
          )
          .toBe(true);
        await page.waitForTimeout(350);
        tokenStableInEditor = await page.evaluate((nextToken) => {
          const editor = document.querySelector(
            '[role="textbox"][contenteditable="true"]',
          );
          const editorText = String(editor?.textContent || "");
          const markdownText = String(
            window.MarkdownFrontEditor &&
              typeof window.MarkdownFrontEditor.getMarkdown === "function"
              ? window.MarkdownFrontEditor.getMarkdown()
              : "",
          );
          const needle = String(nextToken || "");
          return editorText.includes(needle) || markdownText.includes(needle);
        }, entry.token);
        if (tokenStableInEditor) break;
      }
      expect(tokenStableInEditor).toBe(true);
      await page.waitForTimeout(200);
      await page.getByRole("button", { name: /Save changes/i }).click();
      if (entry.scopeKind !== "document") {
        await expect
          .poll(async () => {
            if ((await readEn()).includes(entry.expectToken)) {
              return true;
            }
            const failedMessage = await page.evaluate(() => {
              const logs = Array.isArray(window.__MFE_DOC_STATE_LOGS)
                ? window.__MFE_DOC_STATE_LOGS
                : [];
              const failed = [...logs]
                .reverse()
                .find((event) => event && event.type === "STATE_SAVE_FAILED");
              if (failed?.error) {
                return `STATE_SAVE_FAILED:${String(failed.error || "")}`;
              }
              const reconcileFailed = [...logs]
                .reverse()
                .find(
                  (event) =>
                    event &&
                    event.type === "MFE_DIRTY_DESYNC_RECONCILE_FAILED",
                );
              if (reconcileFailed?.error) {
                return `MFE_DIRTY_DESYNC_RECONCILE_FAILED:${String(
                  reconcileFailed.error || "",
                )}`;
              }
              const safetyBlocked = [...logs]
                .reverse()
                .find(
                  (event) =>
                    event && event.type === "MFE_SAVE_SAFETY_BLOCKED",
                );
              if (safetyBlocked) {
                return `save-safety-blocked:${String(
                  safetyBlocked.reason || "",
                )}:${String(safetyBlocked.scopeKeyExpected || "")}:${String(
                  safetyBlocked.scopeKeyActual || "",
                )}`;
              }
              const statusText = String(
                (
                  document.querySelector(".editor-toolbar-status") ||
                  document.querySelector(".mfe-status-text")
                )?.textContent || "",
              ).trim();
              return statusText.startsWith("Save failed")
                ? statusText
                : "";
            });
            if (failedMessage) {
              throw new Error(failedMessage);
            }
            return false;
          })
          .toBe(true);
      }
      await assertV2SavePathForScope(page, entry.scopeKind);
    }
  });

  test("ui workflow field->section->document->subsection->field saves cleanly", async ({
    page,
  }) => {
    await normalizeV2MatrixBaseline();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    await page.goto("/");

    const runtimeAvailability = await page.evaluate(() => ({
      hasFullscreenApi:
        typeof window.MarkdownFrontEditor?.openForElement === "function",
      hasInlineApi:
        typeof window.MarkdownFrontEditorInline?.openForElement === "function",
      hostCount: document.querySelectorAll("[data-mfe]").length,
    }));
    expect(
      runtimeAvailability.hasFullscreenApi || runtimeAvailability.hasInlineApi,
      `frontend editor runtime unavailable (hosts=${runtimeAvailability.hostCount})`,
    ).toBe(true);

    const criticalConsoleIssues = [];
    page.on("console", (msg) => {
      const text = String(msg.text() || "");
      if (
        /(MFE_SAVE_LOOP_ERROR|Save promise error|MFE_SAVE_SAFETY_BLOCKED|scope-session-v2:lock-conflict|mutation-plan-v2: protected spans changed)/.test(
          text,
        )
      ) {
        criticalConsoleIssues.push(`${msg.type()}: ${text}`);
      }
    });

    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    await page.evaluate(() => {
      if (Array.isArray(window.__MFE_DOC_STATE_LOGS)) {
        window.__MFE_DOC_STATE_LOGS.length = 0;
      } else {
        window.__MFE_DOC_STATE_LOGS = [];
      }
    });

    const steps = [
      {
        label: "field-initial",
        scopeKind: "field",
        token: "V2_CLI_FLOW_FIELD",
        readyContains: "The Urban",
        navigate: async () => {},
      },
      {
        label: "section-hero",
        scopeKind: "section",
        token: "V2_CLI_FLOW_SECTION",
        readyContains: "The Urban",
        navigate: async () => {
          await clickBreadcrumbLink(page, /^Section:\s*hero$/i);
        },
      },
      {
        label: "document",
        scopeKind: "document",
        token: "V2_CLI_FLOW_DOCUMENT",
        readyContains: "How we work",
        navigate: async () => {
          await clickBreadcrumbLink(page, /^Document$/i);
        },
      },
      {
        label: "field-from-document",
        scopeKind: "field",
        token: "V2_CLI_FLOW_FIELD_FROM_DOCUMENT",
        readyContains: "The Urban",
        navigate: async () => {
          const fieldLink = page
            .getByRole("link", { name: /^Field:\s*title$/i })
            .first();
          if (await fieldLink.isVisible({ timeout: 1200 }).catch(() => false)) {
            await fieldLink.click();
            return;
          }
          await openScopeFromCanonical(page, {
            scope: "field",
            name: "title",
            section: "hero",
            subsection: "",
            readyContains: "The Urban",
          });
        },
      },
      {
        label: "subsection-right",
        scopeKind: "subsection",
        token: "V2_CLI_FLOW_SUBSECTION",
        readyContains: "How we work",
        navigate: async () => {
          await openScopeFromCanonical(page, {
            scope: "subsection",
            name: "right",
            section: "columns",
            subsection: "right",
            readyContains: "How we work",
          });
        },
      },
    ];

    for (const step of steps) {
      const consoleCursor = criticalConsoleIssues.length;
      await step.navigate();
      await waitForEditorTextContains(page, step.readyContains);
      await assertNoMarkerTextLeakInEditor(page, `${step.label}:before-edit`);
      await appendTokenAndAssertVisible(page, step.token);
      await page.getByRole("button", { name: /Save changes/i }).click();
      await waitForPersistedTokenOrThrow({
        page,
        token: step.token,
        contextLabel: step.label,
        consoleIssues: criticalConsoleIssues,
        consoleCursor,
      });
      await assertV2SavePathForScope(page, step.scopeKind);
      await assertNoCriticalDocStateEvents(page, step.label);
      assertNoCriticalConsoleSince(
        criticalConsoleIssues,
        consoleCursor,
        step.label,
      );
      await assertNoMarkerTextLeakInEditor(page, `${step.label}:after-save`);
    }
  });

  test("plain tag field boundary edits save without scope leaks", async ({
    page,
  }) => {
    await resetHomesFromFixtures();
    await appendPlainTagFieldFixture();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    const criticalConsoleIssues = [];
    const criticalPageErrors = [];
    page.on("console", (msg) => {
      const text = String(msg.text() || "");
      if (
        /apply scope leak|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED|Save promise error/i.test(
          text,
        )
      ) {
        criticalConsoleIssues.push(`${msg.type()}: ${text}`);
      }
    });
    page.on("pageerror", (error) => {
      const text = String(error?.message || error || "");
      if (/apply scope leak|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED/i.test(text)) {
        criticalPageErrors.push(text);
      }
    });

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    const cases = [
      {
        label: "replace-all",
        apply: async () => {
          await replaceEntirePrimaryEditorText(page, "Omega field replacement");
        },
        expected: "Omega field replacement",
      },
      {
        label: "replace-start",
        apply: async () => {
          await replacePrimaryEditorBoundaryText(page, "start", 5, "Omega");
        },
        expected: "Omega beta gamma",
      },
      {
        label: "replace-end",
        apply: async () => {
          await replacePrimaryEditorBoundaryText(page, "end", 5, "delta");
        },
        expected: "Alpha beta delta",
      },
    ];

    for (const entry of cases) {
      await resetHomesFromFixtures();
      await appendPlainTagFieldFixture();
      await page.reload({ waitUntil: "domcontentloaded" });
      await openScopeFromCanonical(page, {
        scope: "field",
        name: "plain",
        section: "edgecases",
        subsection: "",
        readyContains: "Alpha beta gamma",
      });

      const consoleCursor = criticalConsoleIssues.length;
      const pageErrorCursor = criticalPageErrors.length;
      await entry.apply();
      await expect
        .poll(async () => String((await getActivePrimaryEditor(page).textContent()) || ""))
        .toContain(entry.expected);
      await page.getByRole("button", { name: /Save changes/i }).click();
      await expect
        .poll(async () => String(await readEn()))
        .toContain(`<!-- plain -->\n${entry.expected}\n\n<!-- after -->`);
      await expect
        .poll(async () => String(await readEn()))
        .toContain("<!-- after -->\nAfter marker stays untouched.");
      await assertNoCriticalDocStateEvents(page, entry.label);
      assertNoCriticalConsoleSince(
        criticalConsoleIssues,
        consoleCursor,
        entry.label,
      );
      expect(
        criticalPageErrors.slice(pageErrorCursor),
        `${entry.label}: critical page errors detected`,
      ).toEqual([]);
    }
  });

  test("field, section, and subsection boundary edits save cleanly at start and end", async ({
    page,
  }) => {
    await normalizeV2MatrixBaseline();
    await appendPlainTagFieldFixture();

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    const criticalConsoleIssues = [];
    const criticalPageErrors = [];
    page.on("console", (msg) => {
      const text = String(msg.text() || "");
      if (
        /marker boundary violation|protected spans changed|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED|Save promise error/i.test(
          text,
        )
      ) {
        criticalConsoleIssues.push(`${msg.type()}: ${text}`);
      }
    });
    page.on("pageerror", (error) => {
      const text = String(error?.message || error || "");
      if (
        /marker boundary violation|protected spans changed|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED/i.test(
          text,
        )
      ) {
        criticalPageErrors.push(text);
      }
    });

    await page.goto("/");
    const opened = await openFullscreenEditor(page);
    expect(opened, "frontend editor window could not be opened in this runtime").toBe(true);

    const cases = [
      {
        label: "field-start",
        scopeKind: "field",
        open: {
          scope: "field",
          name: "plain",
          section: "edgecases",
          subsection: "",
          readyContains: "Alpha beta gamma",
        },
        apply: async () => {
          await replacePrimaryEditorBoundaryText(page, "start", 5, "Omega");
        },
        token: "Omega beta gamma",
      },
      {
        label: "field-end",
        scopeKind: "field",
        open: {
          scope: "field",
          name: "plain",
          section: "edgecases",
          subsection: "",
          readyContains: "Alpha beta gamma",
        },
        apply: async () => {
          await replacePrimaryEditorBoundaryText(page, "end", 5, "delta");
        },
        token: "Alpha beta delta",
      },
      {
        label: "section-start",
        scopeKind: "section",
        open: {
          scope: "section",
          name: "hero",
          section: "hero",
          subsection: "",
          readyContains: "The Urban",
        },
        apply: async () => {
          await replacePrimaryEditorBoundaryText(page, "start", 3, "Metro");
        },
        token: "Metro",
      },
      {
        label: "section-end",
        scopeKind: "section",
        open: {
          scope: "section",
          name: "hero",
          section: "hero",
          subsection: "",
          readyContains: "The Urban",
        },
        apply: async () => {
          await replacePrimaryEditorBoundaryText(page, "end", 5, "SAFELY");
        },
        token: "SAFELY",
      },
      {
        label: "subsection-start",
        scopeKind: "subsection",
        open: {
          scope: "subsection",
          name: "right",
          section: "columns",
          subsection: "right",
          readyContains: "How we work",
        },
        apply: async () => {
          await replacePrimaryEditorBoundaryText(page, "start", 3, "Why");
        },
        token: "Why",
      },
      {
        label: "subsection-end",
        scopeKind: "subsection",
        open: {
          scope: "subsection",
          name: "right",
          section: "columns",
          subsection: "right",
          readyContains: "How we work",
        },
        apply: async () => {
          await replacePrimaryEditorBoundaryText(page, "end", 6, "steady");
        },
        token: "steady",
      },
    ];

    for (const entry of cases) {
      await normalizeV2MatrixBaseline();
      await appendPlainTagFieldFixture();
      await page.reload({ waitUntil: "domcontentloaded" });
      await openScopeFromCanonical(page, entry.open);

      const consoleCursor = criticalConsoleIssues.length;
      const pageErrorCursor = criticalPageErrors.length;

      await entry.apply();
      await waitForEditorTextContains(page, entry.token);
      await page.getByRole("button", { name: /Save changes/i }).click();

      await waitForPersistedTokenOrThrow({
        page,
        token: entry.token,
        contextLabel: entry.label,
        consoleIssues: criticalConsoleIssues,
        consoleCursor,
      });
      await assertV2SavePathForScope(page, entry.scopeKind);
      await assertNoCriticalDocStateEvents(page, entry.label);
      assertNoCriticalConsoleSince(
        criticalConsoleIssues,
        consoleCursor,
        entry.label,
      );
      expect(
        criticalPageErrors.slice(pageErrorCursor),
        `${entry.label}: critical page errors detected`,
      ).toEqual([]);
    }
  });

  test("section to document rebound keeps document edits saveable on complex content", async ({
    page,
  }) => {
    await resetHomeFromFixture(EN_COMPLEX_DOCUMENT_FIXTURE);

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    const criticalConsoleIssues = [];
    const criticalPageErrors = [];
    page.on("console", (msg) => {
      const text = String(msg.text() || "");
      if (
        /document marker boundary violation|marker boundary violation|protected spans changed|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED|Save promise error/i.test(
          text,
        )
      ) {
        criticalConsoleIssues.push(`${msg.type()}: ${text}`);
      }
    });
    page.on("pageerror", (error) => {
      const text = String(error?.message || error || "");
      if (
        /document marker boundary violation|marker boundary violation|protected spans changed|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED/i.test(
          text,
        )
      ) {
        criticalPageErrors.push(text);
      }
    });

    await page.goto("/");
    await openScopeFromCanonical(page, {
      scope: "section",
      name: "body",
      section: "body",
      subsection: "",
      readyContains: "Forget",
    });

    await clickBreadcrumbLink(page, /^Document$/i);
    await waitForEditorTextContains(page, "tiefen Leidens");

    const consoleCursor = criticalConsoleIssues.length;
    const pageErrorCursor = criticalPageErrors.length;
    await insertTokenBeforePrimaryEditorNeedle(page, "tiefen Leidens", "steady ");
    await waitForEditorTextContains(page, "steady tiefen Leidens");
    await page.getByRole("button", { name: /Save changes/i }).click();

    await waitForPersistedTokenOrThrow({
      page,
      token: "steady tiefen Leidens",
      contextLabel: "section-document-complex",
      consoleIssues: criticalConsoleIssues,
      consoleCursor,
    });
    await assertV2SavePathForScope(page, "document");
    await assertNoCriticalDocStateEvents(page, "section-document-complex");
    assertNoCriticalConsoleSince(
      criticalConsoleIssues,
      consoleCursor,
      "section-document-complex",
    );
    expect(
      criticalPageErrors.slice(pageErrorCursor),
      "section-document-complex: critical page errors detected",
    ).toEqual([]);
  });

  test("complex scope transition matrix keeps edits saveable across rebounds", async ({
    page,
  }) => {
    await resetHomeFromFixture(EN_COMPLEX_DOCUMENT_FIXTURE);

    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    const criticalConsoleIssues = [];
    const criticalPageErrors = [];
    page.on("console", (msg) => {
      const text = String(msg.text() || "");
      if (
        /document marker boundary violation|marker boundary violation|protected spans changed|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED|Save promise error/i.test(
          text,
        )
      ) {
        criticalConsoleIssues.push(`${msg.type()}: ${text}`);
      }
    });
    page.on("pageerror", (error) => {
      const text = String(error?.message || error || "");
      if (
        /document marker boundary violation|marker boundary violation|protected spans changed|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED/i.test(
          text,
        )
      ) {
        criticalPageErrors.push(text);
      }
    });

    await page.goto("/");
    await openScopeFromCanonical(page, {
      scope: "field",
      name: "title",
      section: "hero",
      subsection: "",
      readyContains: "The Urban",
    });

    const transitions = [
      {
        label: "field-section",
        scopeKind: "section",
        navigate: async () => {
          await clickBreadcrumbLink(page, /^Section:\s*hero$/i);
        },
        waitFor: "The Urban",
        needle: "The Urban",
        offset: 0,
        token: "R",
        persisted: "RThe Urban",
      },
      {
        label: "section-document",
        scopeKind: "document",
        navigate: async () => {
          await clickBreadcrumbLink(page, /^Document$/i);
        },
        waitFor: "tiefen Leidens",
        needle: "tiefen Leidens",
        offset: 0,
        token: "S",
        persisted: "Stiefen Leidens",
      },
      {
        label: "document-subsection",
        scopeKind: "subsection",
        navigate: async () => {
          await openScopeFromCanonical(page, {
            scope: "subsection",
            name: "right",
            section: "content",
            subsection: "right",
            readyContains: "Wie es funktioniert",
          });
        },
        waitFor: "Wie es funktioniert",
        needle: "Wie es funktioniert",
        offset: 0,
        token: "T",
        persisted: "TWie es funktioniert",
      },
      {
        label: "subsection-document",
        scopeKind: "document",
        navigate: async () => {
          await clickBreadcrumbLink(page, /^Document$/i);
        },
        waitFor: "groesserer Klarheit",
        needle: "groesserer Klarheit",
        offset: 0,
        token: "U",
        persisted: "Ugroesserer Klarheit",
      },
    ];

    for (const entry of transitions) {
      const consoleCursor = criticalConsoleIssues.length;
      const pageErrorCursor = criticalPageErrors.length;

      await entry.navigate();
      await waitForEditorTextContains(page, entry.waitFor);
      await insertTokenAtPrimaryEditorNeedleOffset(
        page,
        entry.needle,
        entry.offset,
        entry.token,
      );
      await waitForEditorTextContains(page, entry.persisted);
      await page.getByRole("button", { name: /Save changes/i }).click();

      await waitForPersistedTokenOrThrow({
        page,
        token: entry.persisted,
        contextLabel: entry.label,
        consoleIssues: criticalConsoleIssues,
        consoleCursor,
      });
      await assertV2SavePathForScope(page, entry.scopeKind);
      await assertNoCriticalDocStateEvents(page, entry.label);
      assertNoCriticalConsoleSince(
        criticalConsoleIssues,
        consoleCursor,
        entry.label,
      );
      expect(
        criticalPageErrors.slice(pageErrorCursor),
        `${entry.label}: critical page errors detected`,
      ).toEqual([]);
    }
  });

  test("complex fixture offset sweeps stay saveable for document section and subsection scopes", async ({
    page,
  }) => {
    const authenticated = await ensureAuthenticated(page);
    expect(authenticated, "admin login unavailable in this runtime").toBe(true);

    const criticalConsoleIssues = [];
    const criticalPageErrors = [];
    page.on("console", (msg) => {
      const text = String(msg.text() || "");
      if (
        /document marker boundary violation|marker boundary violation|protected spans changed|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED|Save promise error/i.test(
          text,
        )
      ) {
        criticalConsoleIssues.push(`${msg.type()}: ${text}`);
      }
    });
    page.on("pageerror", (error) => {
      const text = String(error?.message || error || "");
      if (
        /document marker boundary violation|marker boundary violation|protected spans changed|STATE_SAVE_FAILED|MFE_SAVE_SAFETY_BLOCKED/i.test(
          text,
        )
      ) {
        criticalPageErrors.push(text);
      }
    });

    const cases = [
      {
        label: "document-start",
        scopeKind: "document",
        open: {
          scope: "document",
          name: "document",
          section: "",
          subsection: "",
          readyContains: "The Urban",
        },
        needle: "The Urban <br>Farm",
        offset: 0,
        token: "DOC_A_",
      },
      {
        label: "document-middle",
        scopeKind: "document",
        open: {
          scope: "document",
          name: "document",
          section: "",
          subsection: "",
          readyContains: "tiefen Leidens",
        },
        needle: "tiefen Leidens",
        offset: 0,
        token: "DOC_B_",
      },
      {
        label: "document-endish",
        scopeKind: "document",
        open: {
          scope: "document",
          name: "document",
          section: "",
          subsection: "",
          readyContains: "wie Sitzungen ablaufen",
        },
        needle: "wie Sitzungen ablaufen",
        offset: 4,
        token: "DOC_C_",
      },
      {
        label: "section-body-start",
        scopeKind: "section",
        open: {
          scope: "section",
          name: "body",
          section: "body",
          subsection: "",
          readyContains: "Forget",
        },
        needle: "Forget industrial farms and rigid layouts.",
        offset: 0,
        token: "SEC_A_",
      },
      {
        label: "section-body-endish",
        scopeKind: "section",
        open: {
          scope: "section",
          name: "body",
          section: "body",
          subsection: "",
          readyContains: "without chaos",
        },
        needle: "without chaos",
        offset: "without ".length,
        token: "SEC_B_",
      },
      {
        label: "subsection-content-right-start",
        scopeKind: "subsection",
        open: {
          scope: "subsection",
          name: "right",
          section: "content",
          subsection: "right",
          readyContains: "Wie es funktioniert",
        },
        needle: "Wie es funktioniert",
        offset: 0,
        token: "SUB_A_",
      },
      {
        label: "subsection-content-right-middle",
        scopeKind: "subsection",
        open: {
          scope: "subsection",
          name: "right",
          section: "content",
          subsection: "right",
          readyContains: "tiefen Leidens",
        },
        needle: "tiefen Leidens",
        offset: 0,
        token: "SUB_B_",
      },
    ];

    await page.goto("/");
    for (const entry of cases) {
      await resetHomeFromFixture(EN_COMPLEX_DOCUMENT_FIXTURE);
      await page.reload({ waitUntil: "domcontentloaded" });
      await openScopeFromCanonical(page, entry.open);

      const consoleCursor = criticalConsoleIssues.length;
      const pageErrorCursor = criticalPageErrors.length;
      await insertTokenAtPrimaryEditorNeedleOffset(
        page,
        entry.needle,
        entry.offset,
        entry.token,
      );
      await waitForEditorTextContains(page, entry.token);
      await page.getByRole("button", { name: /Save changes/i }).click();

      await waitForPersistedTokenOrThrow({
        page,
        token: entry.token,
        contextLabel: entry.label,
        consoleIssues: criticalConsoleIssues,
        consoleCursor,
      });
      await assertV2SavePathForScope(page, entry.scopeKind);
      await assertNoCriticalDocStateEvents(page, entry.label);
      assertNoCriticalConsoleSince(
        criticalConsoleIssues,
        consoleCursor,
        entry.label,
      );
      expect(
        criticalPageErrors.slice(pageErrorCursor),
        `${entry.label}: critical page errors detected`,
      ).toEqual([]);
    }
  });
});
