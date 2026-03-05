import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { loadE2EConfig } from "./runtime-config.js";

const AUTH_STATE_PATH = path.resolve(
  process.cwd(),
  "tests/e2e/.auth/storage-state.json",
);

function parseThrottleWaitMs(text) {
  const source = String(text || "");
  const match = source.match(/wait at least\s+(\d+)\s+seconds/i);
  const seconds = Number(match?.[1] || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return (seconds + 1) * 1000;
}

async function ensureAdminAuth(page, cfg) {
  const maxAttempts = 6;
  let lastSubmitAt = 0;
  const minIntervalMs = 6500;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await page.goto("/adm", { waitUntil: "domcontentloaded" });
    const userInput = page.locator('input[name="login_name"]');
    const passInput = page.locator('input[name="login_pass"]');
    const needsLogin =
      (await userInput.count()) > 0 && (await passInput.count()) > 0;
    if (!needsLogin) return true;

    const bodyTextBefore = await page.locator("body").innerText().catch(() => "");
    const preThrottleMs = parseThrottleWaitMs(bodyTextBefore);
    if (preThrottleMs > 0) {
      if (attempt < maxAttempts) {
        await page.waitForTimeout(preThrottleMs);
        continue;
      }
      return false;
    }

    const elapsed = Date.now() - lastSubmitAt;
    if (elapsed < minIntervalMs) {
      await page.waitForTimeout(minIntervalMs - elapsed);
    }

    await userInput.first().fill(cfg.adminUser);
    await passInput.first().fill(cfg.adminPass);
    const submitButton = page.locator(
      'button[type="submit"], input[type="submit"]',
    );
    lastSubmitAt = Date.now();
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
    if (!loginStillVisible) return true;

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!/SessionLoginThrottle/i.test(bodyText)) return false;
    if (attempt < maxAttempts) {
      const throttleMs = parseThrottleWaitMs(bodyText);
      await page.waitForTimeout(throttleMs > 0 ? throttleMs : minIntervalMs);
    }
  }
  return false;
}

export default async function globalSetup() {
  const cfg = loadE2EConfig();
  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: cfg.baseUrl,
  });
  const page = await context.newPage();
  const ok = await ensureAdminAuth(page, cfg);
  if (!ok) {
    await browser.close();
    throw new Error("[e2e] global auth setup failed for /adm");
  }
  await context.storageState({ path: AUTH_STATE_PATH });
  await browser.close();
}

