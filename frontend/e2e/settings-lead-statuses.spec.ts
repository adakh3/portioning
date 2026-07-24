import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Journey: customise the lead pipeline in Settings — add a new stage in-app.
 * Covers the org-customizable lead statuses feature (Settings → Lead Pipeline).
 *
 * Salvaged from the retired `automated-testing` branch and re-wired onto main's
 * harness (real login via helpers, seed_demo data). The CI DB is fresh each run,
 * so the added status needs no cleanup.
 */
test.beforeEach(async ({ page }) => {
  await login(page);
});

test("add a lead-pipeline status in Settings", async ({ page }) => {
  await page.goto("/settings");

  // Settings is tabbed; the lead statuses live under "Lead Pipeline".
  await page.getByRole("button", { name: "Lead Pipeline" }).click();
  await expect(page.getByText("Lead Statuses")).toBeVisible();

  // Add a new stage.
  const name = "E2E Review Stage";
  await page.getByPlaceholder(/New status name/).fill(name);
  await page.getByRole("button", { name: /Add status/ }).click();

  // The new stage shows up as an editable label input carrying its name.
  await expect(page.locator(`input[value="${name}"]`)).toBeVisible();
});
