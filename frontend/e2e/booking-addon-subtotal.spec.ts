import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * The prefetch-cache regression: create a quote, then EDIT it to add an add-on.
 * The item saved fine but the stored subtotal (what view mode + the PDF show) was
 * computed against a stale prefetch cache, so the add-on silently vanished from
 * the total — a food-only figure reached the customer. This drives that exact
 * flow in a real browser and asserts the saved subtotal includes the add-on.
 *
 * Requires the demo org to have a featured catalog add-on ("Buffet Station").
 */
test.describe("Add-ons stay in the saved subtotal after an edit", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("edit a quote to add a catalog add-on → subtotal includes it after save", async ({ page }) => {
    // 1) create a bare quote (no add-ons yet — this is what poisons the cache).
    await page.goto("/quotes/new");
    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("100");
    await page.getByRole("button", { name: "Create Quote" }).click();
    await page.waitForURL(/\/quotes\/\d+$/, { timeout: 15_000 });

    // 2) edit → tick the featured catalog add-on (Buffet Station = 10,000).
    await page.getByRole("button", { name: "Edit Quote" }).click();
    await page.getByText("Buffet Station", { exact: true }).click();
    await page.getByRole("button", { name: "Save Quote" }).click();

    // 3) back in view mode we read the STORED subtotal — it must include the add-on.
    await expect(page.getByText(/Subtotal:\s*\$10,000\.00/)).toBeVisible({ timeout: 10_000 });

    // 4) and it survives a hard reload (truly persisted, not just in-memory).
    await page.reload();
    await expect(page.getByText(/Subtotal:\s*\$10,000\.00/)).toBeVisible({ timeout: 10_000 });
  });
});
