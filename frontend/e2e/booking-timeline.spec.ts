import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * The regression this exists for: a timeline time entered in the form saved as
 * null (Safari didn't fire onChange for the native <input type="time">). A mocked
 * test can't catch that — only a real browser round-trip can. This creates a
 * quote, sets a Setup Time via the hour/minute dropdowns, saves, reloads, and
 * asserts the value survived the trip to the backend and back.
 */
test.describe("Booking timeline persists end-to-end", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("new quote: setup time set via dropdowns survives a reload", async ({ page }) => {
    await page.goto("/quotes/new");

    // A customer is required to save.
    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });

    await page.getByLabel("Guest Count").fill("30");

    // The timeline field is a single 30-min-slot dropdown.
    await page.getByLabel("Setup Time").selectOption("14:30");

    await page.getByRole("button", { name: "Create Quote" }).click();
    await page.waitForURL(/\/quotes\/\d+$/, { timeout: 15_000 });

    // Reopen the editor — the time must still be there (the bug saved it as null).
    await page.getByRole("button", { name: "Edit Quote" }).click();
    await expect(page.getByLabel("Setup Time")).toHaveValue("14:30");
  });

  /**
   * REL-418 AC8 — the same bug class, one level up: a whole run-of-show entered
   * through the timeline editor must survive save + reload. The mocked vitest
   * suite proves the payload; only this proves the round-trip through the API,
   * the DB and back into the form.
   */
  test("new quote: a run-of-show survives save + reload, in order", async ({ page }) => {
    await page.goto("/quotes/new");

    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("30");

    // One click prefills the standard day from the org's Timeline Steps; then we
    // cut it down to three steps and set them deliberately out of clock order,
    // so the assertion proves the SAVED order is the one on screen, not a
    // re-sort by time. Labels are a closed dropdown of the org's presets.
    await page.getByRole("button", { name: "+ Build a run-of-show" }).click();
    await expect(page.getByLabel("Step 1 label")).toHaveValue("Staff arrive");

    // Delete down to three rows.
    while ((await page.getByLabel(/^Remove step /).count()) > 3) {
      await page.getByLabel("Remove step 4").click();
    }

    await page.getByLabel("Step 1 time").selectOption("17:00");
    await page.getByLabel("Step 1 label").selectOption("Cocktail hour");
    await page.getByLabel("Step 2 time").selectOption("21:00");
    await page.getByLabel("Step 2 label").selectOption("Cake cutting");
    await page.getByLabel("Step 3 time").selectOption("18:30");
    await page.getByLabel("Step 3 label").selectOption("Dinner service");

    await page.getByRole("button", { name: "Create Quote" }).click();
    await page.waitForURL(/\/quotes\/\d+$/, { timeout: 15_000 });

    // Hard reload: nothing may survive in client state.
    await page.reload();
    await page.getByRole("button", { name: "Edit Quote" }).click();

    await expect(page.getByLabel("Step 1 label")).toHaveValue("Cocktail hour");
    await expect(page.getByLabel("Step 1 time")).toHaveValue("17:00");
    await expect(page.getByLabel("Step 2 label")).toHaveValue("Cake cutting");
    await expect(page.getByLabel("Step 2 time")).toHaveValue("21:00");
    await expect(page.getByLabel("Step 3 label")).toHaveValue("Dinner service");
    await expect(page.getByLabel("Step 3 time")).toHaveValue("18:30");

    // With entries present, the four legacy slots are gone (AC4).
    await expect(page.getByLabel("Setup Time")).toHaveCount(0);

    // Reorder + save again: the new order is what persists (AC2).
    await page.getByLabel("Move step 3 up").click();
    await page.getByRole("button", { name: "Save Quote" }).click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.getByRole("button", { name: "Edit Quote" }).click();
    await expect(page.getByLabel("Step 2 label")).toHaveValue("Dinner service");
    await expect(page.getByLabel("Step 3 label")).toHaveValue("Cake cutting");

    // Remove every step and the booking falls back to the legacy slots (AC3).
    while ((await page.getByLabel(/^Remove step /).count()) > 0) {
      await page.getByLabel("Remove step 1").click();
    }
    await page.getByRole("button", { name: "Save Quote" }).click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.getByRole("button", { name: "Edit Quote" }).click();
    await expect(page.getByLabel("Setup Time")).toBeVisible();
  });
});
