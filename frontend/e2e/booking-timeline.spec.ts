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

    await page.getByLabel("Total Guests").fill("30");

    // The timeline field: reveal, then pick hour + minute.
    await page.getByLabel("Set Setup Time").click();
    await page.getByLabel("Setup Time hour").selectOption("14");
    await page.getByLabel("Setup Time minute").selectOption("30");

    await page.getByRole("button", { name: "Create Quote" }).click();
    await page.waitForURL(/\/quotes\/\d+$/, { timeout: 15_000 });

    // Reopen the editor — the time must still be there (the bug saved it as null).
    await page.getByRole("button", { name: "Edit Quote" }).click();
    await expect(page.getByLabel("Setup Time hour")).toHaveValue("14");
    await expect(page.getByLabel("Setup Time minute")).toHaveValue("30");
  });
});
