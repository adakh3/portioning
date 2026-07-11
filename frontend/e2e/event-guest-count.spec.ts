import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Guest count is the primary number on an event; the gents/ladies split is
 * optional. Mocked tests prove the payload wiring — only a real browser
 * round-trip proves the native number inputs fire onChange, the save reaches
 * sqlite, and the values survive a reload.
 */
test.describe("Event guest count + optional split persist end-to-end", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("count-only event survives a reload with the split unspecified", async ({ page }) => {
    await page.goto("/events/new");

    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("150");

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    await expect(page.getByText("150")).toBeVisible();
    await expect(page.getByText("Split: not specified")).toHaveCount(0); // view mode, no split rows

    // Reopen the editor — count persisted, split still unspecified.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Guest Count")).toHaveValue("150");
    await expect(page.getByRole("checkbox", { name: /gents \/ ladies split/i })).not.toBeChecked();
  });

  test("an entered split survives, and changing the count clears it", async ({ page }) => {
    await page.goto("/events/new");

    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("100");
    await page.getByRole("checkbox", { name: /gents \/ ladies split/i }).check();
    await page.getByLabel("Gents").fill("60"); // ladies auto-compensates to 40
    await expect(page.getByText("adds up to 100")).toBeVisible();

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // The split survived the round-trip.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Gents")).toHaveValue("60");
    await expect(page.getByLabel("Ladies")).toHaveValue("40");

    // Changing the count clears the split (ask again, never scale).
    await page.getByLabel("Guest Count").fill("120");
    await expect(page.getByRole("checkbox", { name: /gents \/ ladies split/i })).not.toBeChecked();
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.reload();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Guest Count")).toHaveValue("120");
    await expect(page.getByRole("checkbox", { name: /gents \/ ladies split/i })).not.toBeChecked();
  });
});
