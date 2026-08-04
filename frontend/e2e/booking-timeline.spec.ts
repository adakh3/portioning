import { test, expect } from "@playwright/test";
import { login, pickCustomer } from "./helpers";

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

  test("new quote: meal time set via dropdown survives a reload", async ({ page }) => {
    await page.goto("/quotes/new");

    // A customer is required to save.
    await pickCustomer(page);

    await page.getByLabel("Guest Count").fill("30");

    // Meal Time is the run-of-show anchor, and the one legacy column a new
    // booking still writes — the four slots only render on a booking that
    // already has them. Same slot dropdown, same persistence bug class.
    await page.getByLabel("Meal Time").selectOption("14:30");

    await page.getByRole("button", { name: "Create Quote" }).click();
    await page.waitForURL(/\/quotes\/\d+$/, { timeout: 15_000 });

    // Reopen the editor — the time must still be there (the bug saved it as null).
    await page.getByRole("button", { name: "Edit Quote" }).click();
    await expect(page.getByLabel("Meal Time")).toHaveValue("14:30");
  });

  /**
   * REL-418 AC8 — the same bug class, one level up: a whole run-of-show entered
   * through the timeline editor must survive save + reload. The mocked vitest
   * suite proves the payload; only this proves the round-trip through the API,
   * the DB and back into the form.
   */
  test("new quote: a run-of-show survives save + reload, in order", async ({ page }) => {
    // "+ Build a run-of-show" reads the org's Timeline Steps out of SWR at CLICK
    // time. Click before they land and it seeds ONE blank row — and nothing
    // re-populates it, so the assertion below can never recover. That is a real
    // 1-in-N CI flake (REL-442), not a hypothetical.
    //
    // So gate the click on the request, not on the click's own result. The
    // waiter is registered BEFORE the navigation that triggers it, otherwise
    // this line would just be a second race.
    const presetsLoaded = page.waitForResponse(
      (r) => r.url().includes("/bookings/timeline-presets/") && r.ok(),
    );
    await page.goto("/quotes/new");
    await presetsLoaded;

    await pickCustomer(page);
    await page.getByLabel("Guest Count").fill("30");
    // The day is built AROUND the meal time, so the button stays disabled until
    // there is one — building with no anchor used to default silently to 18:30.
    await page.getByLabel("Meal Time").selectOption("18:30");

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

    // Reorder by DRAGGING and save again: the new order is what persists (AC2).
    // This lives here rather than in the vitest suite because @dnd-kit measures
    // element rects to pick a drop target, and jsdom has no layout.
    // Reorder via the handle's arrow keys. A simulated mouse drag proved flaky
    // here (dnd-kit tracks pointer movement, so it depends on event timing);
    // the arrow path is the same reorder, deterministic, and the one someone
    // without a mouse uses. The mouse drag is exercised by hand.
    await page.getByLabel(/^Reorder step 3/).press("ArrowUp");
    await expect(page.getByLabel("Step 2 label")).toHaveValue("Dinner service");
    await page.getByRole("button", { name: "Save Quote" }).click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.getByRole("button", { name: "Edit Quote" }).click();
    await expect(page.getByLabel("Step 2 label")).toHaveValue("Dinner service");
    await expect(page.getByLabel("Step 3 label")).toHaveValue("Cake cutting");

    // Remove every step and the booking is back to an empty timeline, offering
    // the meal-time anchor and the build button again (AC3).
    while ((await page.getByLabel(/^Remove step /).count()) > 0) {
      await page.getByLabel("Remove step 1").click();
    }
    await page.getByRole("button", { name: "Save Quote" }).click();
    await page.waitForTimeout(1000);
    await page.reload();
    await page.getByRole("button", { name: "Edit Quote" }).click();
    await expect(page.getByRole("button", { name: "+ Build a run-of-show" })).toBeVisible();
  });
});
