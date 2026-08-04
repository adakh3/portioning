import { test, expect, type Page } from "@playwright/test";
import { login, pickCustomer } from "./helpers";

/** 90 days out, as YYYY-MM-DD. */
function futureDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

/**
 * Menu choices + the finals lifecycle (REL-419), driven through the one Menu card
 * (REL-451 AC13). The mocked suite proves the wiring; only a real round-trip proves
 * the chips / number / date inputs fire and that BOTH halves survive a save + reload:
 *   - the offered-choice flags, marked at proposal time on a row inside its course;
 *   - the final guarantee + per-dish tallies, recorded weeks later in the panel.
 * It also proves the derived pill flips to green off real persisted data (REL-419 AC6)
 * and that the PER-COURSE sum validation blocks a bad save (REL-419 AC7).
 */
test.describe("Menu choices and final numbers survive save + reload", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  /** Add the first addable dish from `course`'s picker; returns its name. `nth` is
   * which "+ dish" trigger to use, i.e. which course section. */
  async function addDishTo(page: Page, course: string, nth: number): Promise<string> {
    await page.getByRole("button", { name: "+ dish" }).nth(nth).click();
    const picker = page.getByRole("group", { name: `Add a dish to ${course}` });
    const row = picker.getByRole("button", { name: new RegExp(`add to ${course}$`) }).first();
    const name = (await row.getAttribute("aria-label"))!.split(" — ")[0];
    await row.click();
    // The picker stays open after an add, and its trigger then reads "Done" — which
    // shifts the "+ dish" indices for the next call. Esc closes it (AC8b).
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    return name;
  }

  test("offered choices persist, then the finals panel records tallies per course", async ({ page }) => {
    // --- Proposal: a plated event offering a choice in TWO courses ---
    await page.goto("/events/new");
    await page.waitForLoadState("networkidle");
    await pickCustomer(page);
    await page.getByLabel("Guest Count").fill("50");
    // A future date: a confirmed event auto-advances to in_progress on its event
    // day, and chasing only applies while the booking is still ahead.
    await page.getByLabel("Event date").fill(futureDate());

    // Plated is what surfaces the choice affordances at all (AC8). Confirmed at
    // creation because an existing event's status is read-only on this page — and
    // the finals panel only applies to a confirmed booking.
    await page.getByLabel("Service Style").selectOption("plated");
    await page.getByLabel("Status").selectOption("confirmed");

    // Three courses: two that offer a choice (so finals validate per course), and a
    // throwaway third whose deletion is how a dish ends up unassigned — there is no
    // move affordance, and AC13 wants an "On the table" dish in the round trip.
    for (const [i, name] of [[1, "Entrée"], [2, "Dessert"], [3, "Extras"]] as const) {
      await page.getByRole("button", { name: "+ Add course" }).click();
      await page.getByLabel(`Course ${i} name`).fill(name);
    }

    const [a, b] = [await addDishTo(page, "Entrée", 0), await addDishTo(page, "Entrée", 0)];
    const [c, d] = [await addDishTo(page, "Dessert", 1), await addDishTo(page, "Dessert", 1)];
    await addDishTo(page, "Extras", 2);

    // Deleting the course drops its dish into "On the table" rather than a neighbour.
    await page.getByLabel("Remove course Extras").click();
    await expect(page.getByText("On the table")).toBeVisible();

    // Mark both options in each course. The chip is the whole interaction — no
    // separate card, no second assignment step.
    for (const dish of [a, b, c, d]) {
      await page.getByLabel(`Mark ${dish} as a guest choice`).click();
    }
    // Two options per course read as one either/or, so there are exactly two *or*s.
    await expect(page.getByText("or", { exact: true })).toHaveCount(2);

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // Reload: the structure came back from the database, not from React state.
    await page.reload();
    const card = page.getByTestId("menu-structure");
    await expect(card).toContainText("Entrée", { timeout: 15_000 });
    await expect(card).toContainText("Dessert");
    await expect(card).toContainText("On the table");

    // The flags themselves: reopen the form after the hard reload and all four chips
    // are back. This is form state rebuilt FROM the reloaded event, so it proves the
    // round trip reached the database — nothing survived in memory across the reload.
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByTestId("menu-structure").getByText("guests choose")).toHaveCount(4);
    // Two options per course still read as one either/or.
    await expect(page.getByText("or", { exact: true })).toHaveCount(2);
    // Back to view mode so the finals panel (hidden while editing) is reachable. Its
    // tally count below is the SERVER's own read of the same flags, through
    // choice_groups() — the backend agreeing with what the card just showed.
    await page.reload();

    // --- Finals: record the numbers on the confirmed booking (REL-419 AC6) ---
    await expect(page.getByRole("button", { name: "Record final numbers" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Record final numbers" }).click();
    await page.getByLabel("Final guarantee").fill("50");

    const panel = page.getByTestId("finals-panel");
    const tallies = panel.getByLabel(/^Tally for /);
    await expect(tallies).toHaveCount(4);

    // Fill the first course correctly and leave the second blank: only the SECOND
    // course complains, and a blank group still blocks the save (REL-419 AC7).
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
