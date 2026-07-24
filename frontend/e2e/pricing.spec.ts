import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * REL-404: a US org's quote must show a service charge (default 20%) in the
 * totals, computed on the subtotal and surviving a save + reload. The mocked
 * suite proves the wiring; only a real browser proves the org's snapshot default
 * reaches the screen and the stored amount persists. (seed_demo's "Demo Co" is a
 * US org defaulting to a 20% service charge.)
 */
test.describe("Service charge on a US quote", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("a US quote shows a 20% service charge that persists", async ({ page }) => {
    // Create a bare quote, then add a catalog add-on so there's a subtotal.
    await page.goto("/quotes/new");
    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("100");
    await page.getByRole("button", { name: "Create Quote" }).click();
    await page.waitForURL(/\/quotes\/\d+$/, { timeout: 15_000 });

    await page.getByRole("button", { name: "Edit Quote" }).click();
    await page.getByText("Buffet Station", { exact: true }).click();
    await page.getByRole("button", { name: "Save Quote" }).click();

    // View mode: the 20% service charge row + its amount (20% of $10,000).
    await expect(page.getByText(/Service charge \(20%\)/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("$2,000.00")).toBeVisible();

    // Persisted — survives a hard reload (stored amount, not just in-memory).
    await page.reload();
    await expect(page.getByText(/Service charge \(20%\)/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("$2,000.00")).toBeVisible();
  });
});
