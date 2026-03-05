import fs from "node:fs";
import path from "node:path";

const DEFAULTS = Object.freeze({
  baseUrl: "https://markdowntest.ddev.site/",
  adminUser: "ddevadmin",
  adminPass: "ddevadmin",
  contentRoot: path.resolve(
    process.cwd(),
    "../MarkdownTest/public/site/content",
  ),
});

function readLocalConfig() {
  const fromEnv = process.env.MFE_E2E_CONFIG || "";
  const configPath = fromEnv
    ? path.resolve(fromEnv)
    : path.resolve(process.cwd(), "tests/e2e/.mfe-e2e.local.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function fromString(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function loadE2EConfig() {
  const local = readLocalConfig();
  return {
    baseUrl: fromString(
      process.env.MFE_BASE_URL,
      fromString(local.baseUrl, DEFAULTS.baseUrl),
    ),
    adminUser: fromString(
      process.env.MFE_ADMIN_USER,
      fromString(local.adminUser, DEFAULTS.adminUser),
    ),
    adminPass: fromString(
      process.env.MFE_ADMIN_PASS,
      fromString(local.adminPass, DEFAULTS.adminPass),
    ),
    contentRoot: fromString(
      process.env.MFE_CONTENT_ROOT,
      fromString(local.contentRoot, DEFAULTS.contentRoot),
    ),
  };
}
