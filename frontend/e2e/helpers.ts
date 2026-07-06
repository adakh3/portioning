import { Page, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL || "owner@demo.test";
const PASSWORD = process.env.E2E_PASSWORD || "Owner123!";

/** Log in through the real login form and wait until we've left /login. */
export async function login(page: Page) {
  await page.goto("/login");
  await page.locator("input[type=email]").fill(EMAIL);
  await page.locator("input[type=password]").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  // Sanity: a logged-in shell renders a nav, not the sign-in button.
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
}
