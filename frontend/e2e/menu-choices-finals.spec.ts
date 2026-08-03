import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/** 90 days out, as YYYY-MM-DD. */
function futureDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

/**
 * Menu choices + the finals lifecycle (REL-419). The mocked suite proves the wiring;
 * only a real round-trip proves the native checkbox / number / date inputs fire and
 * that BOTH halves survive a save + reload (AC11):
 *   - the offered-choice flags, marked at proposal time;
 *   - the final guarantee + per-dish tallies, recorded weeks later in the panel.
 * It also proves the derived pill flips to green off real persisted data (AC6) and
 * that the PER-COURSE sum validation blocks a bad save (AC7).
 */
test.describe("Menu choices and final numbers survive save + reload", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("offered choices persist, then the finals panel records tallies per course", async ({ page }) => {
    // --- Proposal: a plated event offering a choice in TWO courses ---
    await page.goto("/events/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("50");
    // A future date: a confirmed event auto-advances to in_progress on its event
    // day, and chasing only applies while the booking is still ahead.
    await page.getByLabel("Event date").fill(futureDate());

    // Plated is what surfaces the Menu Choices card at all (AC1). Confirmed at
    // creation because an existing event's status is read-only on this page — and
    // the finals panel only applies to a confirmed booking.
    await page.getByLabel("Service Style").selectOption("plated");
    await page.getByLabel("Status").selectOption("confirmed");

    const tpl = page.getByLabel("Load from template");
    await tpl.waitFor({ state: "visible" });
    await tpl.selectOption({ index: 1 });
    await expect(page.getByText(/Menu \(\d+ dishes\)/)).toBeVisible({ timeout: 10_000 });

    // Two courses, so the choices group — and so finals validate per course.
    await page.getByRole("button", { name: "+ Add course" }).click();
    await page.getByLabel("Course 1 name").fill("Entrée");
    await page.getByRole("button", { name: "+ Add course" }).click();
    await page.getByLabel("Course 2 name").fill("Dessert");

    const assigns = page.getByLabel(/^Course for /);
    expect(await assigns.count()).toBeGreaterThanOrEqual(4);
    // First two dishes → Entrée, next two → Dessert.
    await assigns.nth(0).selectOption("0");
    await assigns.nth(1).selectOption("0");
    await assigns.nth(2).selectOption("1");
    await assigns.nth(3).selectOption("1");

    // The card is its own thing, below Courses, and explains itself up front.
    const card = page.getByTestId("menu-choices");
    await expect(card).toBeVisible();
    await expect(card).toContainText("the guest picks from what you offer");

    // Tick both dishes in each course.
    const boxes = card.getByLabel(/^Offer .* as a choice$/);
    const firstName = ((await boxes.nth(0).getAttribute("aria-label")) || "")
      .replace(/^Offer | as a choice$/g, "");
    for (let i = 0; i < 4; i++) await boxes.nth(i).check();

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // Reload: the flags came back from the database, not from React state (AC11).
    await page.reload();
    await expect(page.getByTestId("menu-choices")).toContainText(firstName);

    // --- Finals: record the numbers on the confirmed booking (AC6) ---
    await expect(page.getByRole("button", { name: "Record final numbers" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Record final numbers" }).click();
    await page.getByLabel("Final guarantee").fill("50");

    const panel = page.getByTestId("finals-panel");
    const tallies = panel.getByLabel(/^Tally for /);
    await expect(tallies).toHaveCount(4);

    // Fill the first course correctly and leave the second blank: only the SECOND
    // course complains, and a blank group still blocks the save (AC7).
    await tallies.nth(0).fill("30");
    await tallies.nth(1).fill("20");
    await expect(panel.getByRole("alert")).toHaveCount(1);
    await expect(panel.getByRole("alert")).toContainText(/must add up to the final guarantee \(50\)/);
    await expect(page.getByRole("button", { name: "Save final numbers" })).toBeDisabled();

    // 100 tallies against a 50 guarantee is CORRECT here — one pick per course.
    await tallies.nth(2).fill("35");
    await tallies.nth(3).fill("15");
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Save final numbers" }).click();

    // The derived pill flips to green off persisted data, and stays green on reload.
    await expect(page.getByTestId("finals-pill").first()).toHaveText(/Finals recorded/, { timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("finals-pill").first()).toHaveText(/Finals recorded/);
    const recorded = page.getByTestId("finals-panel").getByRole("definition");
    await expect(recorded.filter({ hasText: /^50$/ })).toBeVisible();  // the guarantee
    await expect(recorded.filter({ hasText: /^30$/ })).toBeVisible();  // entrée A
    await expect(recorded.filter({ hasText: /^35$/ })).toBeVisible();  // dessert A
  });
});
