import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Additional-meal audience (REL-426). seed_demo's "Demo Co" is a US org
 * (Adults[default]/Kids/Vendors). A meal picks WHO it serves and derives its guest
 * count from the booking's segments. Mocked tests prove the payload wiring; only a
 * real round-trip proves the native <select> fires, the derived count is dual-written
 * to sqlite, and — the point of AC6 — that changing the booking's guest count then
 * reloading reflows every audience-scoped meal.
 */
test.describe("Additional-meal audience derives + reflows end-to-end (US org)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("an 'Everyone' meal derives its count and follows a guest-count change across reload", async ({ page }) => {
    await page.goto("/events/new");

    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("150");
    await page.getByLabel("Vendors", { exact: true }).fill("8"); // 150 guests + 8 covers = 158

    // Add a meal that serves Everyone → its count derives to 158, read-only.
    await page.getByRole("button", { name: "+ Add Meal" }).click();
    await page.getByPlaceholder("Meal label").fill("Dinner");
    await page.getByLabel("Serves").selectOption("everyone");
    await expect(page.getByText("158 — from Everyone")).toBeVisible();

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // View mode after a hard reload: the meal shows its derived 158 covers.
    await page.reload();
    await expect(page.getByText(/158/).first()).toBeVisible();

    // Change the booking's guests to 200 (Adults remainder → 192; +8 vendors = 208).
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Guest Count").fill("200");
    await expect(page.getByText("208 — from Everyone")).toBeVisible(); // live reflow
    await page.getByRole("button", { name: /Save/ }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    // Survives the save + reload: the audience meal now serves 208.
    await page.reload();
    await expect(page.getByText(/208/).first()).toBeVisible();
  });
});
