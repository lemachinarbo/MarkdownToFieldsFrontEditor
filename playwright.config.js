import { defineConfig } from "@playwright/test";
import { loadE2EConfig } from "./tests/e2e/runtime-config.js";

const e2e = loadE2EConfig();

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.js",
  outputDir: "./tests/test-results",
  timeout: 60_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: e2e.baseUrl,
    storageState: "./tests/e2e/.auth/storage-state.json",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
});
