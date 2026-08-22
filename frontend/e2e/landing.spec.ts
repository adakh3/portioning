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
  await expect(page.getByRole("heading", { name: /AI sales agent/ })).toBeVisible();
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

/**
 * AC8 end to end, through the real endpoint.
 *
 * The mocked suite stubs `api.createDemoRequest`, so it never exercises
 * `fetchApi` — which is how a 201 with an empty body shipped green while every
 * real submission that hit it showed "Something went wrong". Only a request
 * that actually reaches Django can catch that class.
 *
 * One submission per run, deliberately: the endpoint allows 10/hour per IP, and
 * a spec that burns the budget would start failing on a developer's fifth
 * consecutive local run. Restart the backend to reset the counter if you hit it.
 */
test("the demo form submits through the real API (AC8)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Book a Demo" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Book a demo" });
  await dialog.getByLabel("Your name").fill("E2E Caterer");
  await dialog.getByLabel("Work email").fill(`e2e-${Date.now()}@kitchen.test`);
  await dialog.getByLabel("Events per month").fill("12");
  await dialog.getByRole("button", { name: "Request Demo" }).click();

  await expect(dialog.getByText(/Request received/)).toBeVisible();
});

test("landing stacks on a phone viewport without horizontal scroll (AC16)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /AI sales agent/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
