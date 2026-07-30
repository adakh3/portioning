import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Journey: the portioning calculator produces per-person portions for a guest
 * count + a selected dish. Exercises the calculate page end-to-end (guest count →
 * dish selection → engine recommendation) through the real browser — coverage the
 * mocked suite can't give.
 *
 * Uses "Grilled Chicken Breast" from seed_demo's US starter catalog (the demo org
 * owns that catalog; the old "Chicken Curry" lived in a different org the demo
 * login can't see — see REL-420).
 */
test.beforeEach(async ({ page }) => {
  await login(page);
});

test("calculator produces portions for a guest count and dish", async ({ page }) => {
  await page.goto("/calculate");

  // Enter a guest count (the label isn't associated with the input, so target
  // the placeholder).
  await page.getByPlaceholder("Enter total guests").fill("100");

  // Narrow the dish list and select a known seeded dish.
  await page.getByPlaceholder("Search dishes...").fill("Grilled Chicken Breast");
  await page.getByRole("button", { name: "Grilled Chicken Breast", exact: true }).click();

  // The portions view renders with the engine's per-person food total.
  await expect(page.getByText("Food per Person")).toBeVisible();
});
