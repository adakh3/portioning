import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Entrée choices + the finals lifecycle (REL-419). The mocked suite proves the
 * wiring; only a real round-trip proves the native checkbox / number / date inputs
 * fire and that BOTH halves survive a save + reload (AC11):
 *   - the offered-choice flags, marked at proposal time;
 *   - the final guarantee + per-entrée tallies, recorded weeks later in the panel.
 * It also proves the derived pill flips to green off real persisted data (AC6) and
 * that the sum validation blocks a bad save (AC7).
 */
test.describe("Entrée choices and final numbers survive save + reload", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("offered choices persist, then the finals panel records tallies", async ({ page }) => {
    // --- Proposal: a plated event with two dishes offered as an entrée choice ---
    await page.goto("/events/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("50");

    // Plated is what turns the entrée-choice checkboxes on (AC1). Confirmed at
    // creation because an existing event's status is read-only on this page — and
    // the finals panel only applies to a confirmed booking.
    await page.getByLabel("Service Style").selectOption("plated");
    await page.getByLabel("Status").selectOption("confirmed");

    const tpl = page.getByLabel("Load from template");
    await tpl.waitFor({ state: "visible" });
    await tpl.selectOption({ index: 1 });
    await expect(page.getByText(/Menu \(\d+ dishes\)/)).toBeVisible({ timeout: 10_000 });

    const choiceBoxes = page.getByLabel(/^Offer .* as a choice$/);
    await expect(choiceBoxes.first()).toBeVisible();
    await choiceBoxes.nth(0).check();
    await choiceBoxes.nth(1).check();

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // Reload: the flags came back from the database, not from React state (AC11).
    await page.reload();
    await expect(page.getByText(/Entrée choices:|\(choice\)/).first()).toBeVisible();

    // --- Finals: record the numbers on the confirmed booking (AC6) ---
    await expect(page.getByRole("button", { name: "Record final numbers" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Record final numbers" }).click();
    await page.getByLabel("Final guarantee").fill("50");

    const tallies = page.getByLabel(/^Tally for /);
    await expect(tallies).toHaveCount(2);

    // A breakdown that doesn't add up is blocked, here and only here (AC7).
    await tallies.nth(0).fill("30");
    await tallies.nth(1).fill("15");
    await expect(page.getByText(/must add up to the final guarantee \(50\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save final numbers" })).toBeDisabled();

    // Correct it → one save writes the guarantee and both tallies together.
    await tallies.nth(1).fill("20");
    await page.getByRole("button", { name: "Save final numbers" }).click();

    // The derived pill flips to green off persisted data, and stays green on reload.
    await expect(page.getByTestId("finals-pill").first()).toHaveText(/Finals recorded/, { timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("finals-pill").first()).toHaveText(/Finals recorded/);
    await expect(page.getByText("30")).toBeVisible();
    await expect(page.getByText("20")).toBeVisible();
  });
});
