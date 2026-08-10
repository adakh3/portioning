import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * REL-482 — public landing page at "/" for logged-out visitors.
 *
 * These are the real-browser criteria the mocked vitest suite can't prove:
 * the auth gate's redirect behaviour (AC1/AC3) and the sign-in journey
 * ending on the dashboard (AC12).
 */

test("logged-out visitor sees the landing at / and is not redirected (AC1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /You cook\. Let AI do the/ })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});

test("landing Sign in link leads to the styled login page (AC4)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("protected routes still bounce to login with returnTo (AC3)", async ({ page }) => {
  await page.goto("/quotes");
  await page.waitForURL(/\/login\?returnTo=%2Fquotes/);
});

test("signing in lands on the dashboard (AC2/AC12)", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("landing stacks on a phone viewport without horizontal scroll (AC16)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /You cook\. Let AI do the/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
