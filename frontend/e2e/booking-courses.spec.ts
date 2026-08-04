import { test, expect, type Page } from "@playwright/test";
import { login, pickCustomer } from "./helpers";

/**
 * Courses on the one Menu card (REL-417, reworked by REL-451 AC13). A booking's menu
 * is grouped into ordered courses and each dish sits inside one. The mocked suite
 * proves the wiring; only a real round-trip proves the course title input and the
 * course-scoped picker fire, and that the course AND its dish survive save + reload.
 *
 * There is no move affordance (owner call, 2026-08-03): a dish is placed by adding it
 * from the course's own "+ dish", which is exactly what this drives.
 */
test.describe("Courses survive save + reload end-to-end", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  /** Add the first addable dish from `course`'s picker; returns its name. */
  async function addDishTo(page: Page, course: string, nth = 0): Promise<string> {
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

  test("a course + a dish assignment persist across reload", async ({ page }) => {
    await page.goto("/events/new");
    await page.waitForLoadState("networkidle");
    await pickCustomer(page);
    await page.getByLabel("Guest Count").fill("50");

    // Outline first, fill after: a course can be named on an empty menu, and its own
    // "+ dish" is the only way a dish gets into it.
    await page.getByRole("button", { name: "+ Add course" }).click();
    await page.getByLabel("Course 1 name").fill("Starter");
    const dish = await addDishTo(page, "Starter");
    await expect(page.getByLabel(`Remove ${dish}`)).toBeVisible();

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // Hard reload, view mode: the course and its dish came back from the database.
    await page.reload();
    const card = page.getByTestId("menu-structure");
    await expect(card).toContainText("Starter", { timeout: 15_000 });
    await expect(card).toContainText(dish);
    // It is IN the course, not stranded in the unassigned section.
    await expect(card).not.toContainText("On the table");
  });
});
