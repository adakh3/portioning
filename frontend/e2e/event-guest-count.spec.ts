import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Guest breakdown (REL-415). seed_demo's "Demo Co" is a US org
 * (Adults[default]/Kids/Vendors segments), so the field is count-first: a
 * canonical guest count, an optional in-count breakdown where Kids is an explicit
 * input and Adults is the derived read-only remainder, and Vendors as an
 * additional cover. Mocked unit/integration tests prove the payload wiring; only a
 * real browser round-trip proves the native number inputs fire onChange, the save
 * reaches sqlite, and the breakdown survives a reload (AC15).
 */
test.describe("Event guest breakdown persists end-to-end (US org)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("count + kids + vendor covers survive a reload; Adults is the derived remainder", async ({ page }) => {
    await page.goto("/events/new");

    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("150");
    // No legacy gents/ladies split control for this org.
    await expect(page.getByRole("checkbox", { name: /gents \/ ladies split/i })).toHaveCount(0);

    // Enter a breakdown: 12 kids → Adults derives to 138; 8 vendor covers.
    await page.getByLabel("Kids", { exact: true }).fill("12");
    await page.getByLabel("Vendors", { exact: true }).fill("8");
    await expect(page.getByLabel("Adults (derived)")).toHaveText(/138/);

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // Reopen the editor after a hard reload — the breakdown persisted.
    await page.reload();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Guest Count")).toHaveValue("150");
    await expect(page.getByLabel("Kids", { exact: true })).toHaveValue("12");
    await expect(page.getByLabel("Vendors", { exact: true })).toHaveValue("8");
    await expect(page.getByLabel("Adults (derived)")).toHaveText(/138/);
  });
});
