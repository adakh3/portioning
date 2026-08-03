import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Courses on the one Menu card (REL-417, reworked by REL-451 AC13). A booking's menu
 * is grouped into ordered courses and each dish sits inside one. The mocked suite
 * proves the wiring; only a real round-trip proves the course title input and the
 * move affordances fire, and that the courses AND the dish→course assignment survive
 * a save + reload.
 */
test.describe("Courses survive save + reload end-to-end", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  /** Every dish row's ✕ — excludes the course ✕ and the choice chip. */
  const dishRows = (page: import("@playwright/test").Page) =>
    page.getByLabel(/^Remove (?!course )(?!.*as a guest choice$)/);

  test("a course + a dish assignment persist across reload", async ({ page }) => {
    await page.goto("/events/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("50");

    // Populate the menu from a template so there are dishes to place.
    const tpl = page.getByLabel("Load from template");
    await tpl.waitFor({ state: "visible" });
    await tpl.selectOption({ index: 1 });
    await expect(dishRows(page).first()).toBeVisible({ timeout: 10_000 });

    // Seeded templates carry no courses, so the booking lands course-less — a flat
    // list, whose quiet affordance creates the first course (AC8).
    const firstDish = (await dishRows(page).first().getAttribute("aria-label"))!
      .replace("Remove ", "");
    await page.getByRole("button", { name: "+ Add course" }).click();
    await page.getByLabel("Course 1 name").fill("Starter");

    // Every dish is unassigned, so it sits under "On the table"; stepping the first
    // one up hops it into the course above (AC2's keyboard/touch path).
    await expect(page.getByText("On the table")).toBeVisible();
    await page.getByLabel(`Move ${firstDish} to another course — drag, or use the arrow keys`).press("ArrowUp");

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // Hard reload, view mode: the course and its dish came back from the database.
    await page.reload();
    const card = page.getByTestId("menu-structure");
    await expect(card).toContainText("Starter", { timeout: 15_000 });
    await expect(card).toContainText(firstDish);
  });
});
