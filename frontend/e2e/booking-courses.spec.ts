import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Courses & service styles (REL-417). A booking's menu can be grouped into ordered
 * courses (Starter/Entrée/Dessert), each with a service style, and each dish assigned
 * to a course. Mocked tests prove the wiring; only a real round-trip proves the native
 * course inputs / service-style + assignment <select>s fire and that the courses AND
 * the dish→course assignment survive a save + reload (AC8).
 */
test.describe("Courses survive save + reload end-to-end", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("a course + a dish assignment persist across reload", async ({ page }) => {
    await page.goto("/events/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("50");

    // Populate the menu from a template so there are dishes to assign.
    const tpl = page.getByLabel("Load from template");
    await tpl.waitFor({ state: "visible" });
    await tpl.selectOption({ index: 1 });
    await expect(page.getByText(/Menu \(\d+ dishes\)/)).toBeVisible({ timeout: 10_000 });

    // Add a course, name it, assign the first dish to it.
    await page.getByRole("button", { name: "+ Add course" }).click();
    await page.getByLabel("Course 1 name").fill("Starter");
    const firstAssign = page.getByLabel(/^Course for/).first();
    await firstAssign.selectOption("0");

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // View mode after a hard reload — the course + its assigned dish persisted.
    // The Courses section renders the course with its dish ("Starter: <dish>").
    await page.reload();
    await expect(page.getByText(/Starter:\s*\S/)).toBeVisible(); // course + at least one assigned dish
  });
});
