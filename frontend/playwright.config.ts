import { defineConfig, devices } from "@playwright/test";

/**
 * Pre-push smoke tests. These drive the REAL running dev app in a real browser
 * (localhost:3000 → Django :8000 → sqlite) with NOTHING mocked — the "did it
 * actually work in a browser" check the mocked vitest suite can't give.
 *
 * They are NOT in the pre-commit hook, so run them by hand before a push:
 *
 *     npm run e2e
 *
 * They ARE a required check on every PR — the `e2e` job in ci.yml boots its own
 * stack. Note there are deliberately no retries: a spec that only passes on a
 * re-run is a bug to fix, not to paper over (see REL-442).
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
  // list for live console output; html so CI has a real report to upload as an
  // artifact on failure (open: never — don't auto-launch a browser locally).
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
