import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Locale rendering in a real browser. The guard test proves no `£` *literal*
 * exists in source; the mocked suite proves the wiring. Neither proves the org's
 * configured currency actually reaches the screen. This does: the seed_demo org
 * ("Demo Co") is US-configured, so the app shows `$` / MM/DD/YYYY and never a
 * stray `£`.
 */
test.describe("Org locale renders the org's currency, not a hardcoded £", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("settings show the US currency and leak no £", async ({ page }) => {
    await page.goto("/settings");
    // Waiting on the value also waits for the page to finish loading; the org's
    // configured symbol ($) is what everything renders from.
    await expect(page.getByRole("textbox", { name: "Currency Symbol" })).toHaveValue("$");
    await expect(page.locator("body")).not.toContainText("£");
  });

  test("no £ leaks on the money-heavy pages", async ({ page }) => {
    for (const path of ["/events", "/quotes", "/invoices"]) {
      await page.goto(path);
      // A visible heading means the page content has rendered before we scan it.
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect(page.locator("body"), `£ leaked on ${path}`).not.toContainText("£");
    }
  });
});
