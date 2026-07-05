import { defineConfig, devices } from "@playwright/test";

/**
 * Pre-push smoke tests. These drive the REAL running dev app in a real browser
 * (localhost:3000 → Django :8000 → sqlite) with NOTHING mocked — the "did it
 * actually work in a browser" check the mocked vitest suite can't give. They are
 * NOT part of the pre-commit hook or CI; run them by hand before a push:
 *
 *     npm run e2e
 *
 * Requires the dev servers running (npm run dev + manage.py runserver) with
 * seed_demo data. Override the login via E2E_EMAIL / E2E_PASSWORD, or the target
 * via E2E_BASE_URL.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
