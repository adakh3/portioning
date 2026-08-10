import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Journey: connect the caterer's own mailbox in Settings → Integrations (REL-460).
 *
 * Why this needs a real browser rather than the mocked vitest suite: the whole
 * flow *is* browser behaviour. Connecting leaves our origin, comes back on a
 * top-level GET, and only completes if the httpOnly `mailbox_oauth_nonce`
 * cookie — SameSite=Lax — survives that round trip. jsdom can't prove any of it,
 * and a mock asserting "we called the endpoint" would stay green even if the
 * cookie policy silently broke every real connection.
 *
 * Neither CI nor a dev laptop has a Google/Microsoft OAuth app, so the backend
 * runs its fake transport (AC9): connect short-circuits to our own callback and
 * the rest of the flow — state, nonce, storage, redirect — is exactly the real one.
 */
test.beforeEach(async ({ page }) => {
  await login(page);
});

test("connect a mailbox, see it persist, then disconnect", async ({ page }) => {
  await page.goto("/settings?tab=integrations");

  // REL-445 folded this into the "Client communications" card as its Email row,
  // so the journey now scopes to that row. The flow it proves is unchanged.
  const card = page.getByTestId("settings-email-row");
  await expect(card.getByText("Not connected")).toBeVisible();

  // Leaves the app, bounces through the callback, lands back on Settings.
  await card.getByRole("button", { name: "Connect Google" }).click();
  await page.waitForURL(/\/settings\?.*email=connected/, { timeout: 15_000 });

  await expect(card.getByText("Connected", { exact: true })).toBeVisible();
  await expect(card.getByText("owner@demo.test")).toBeVisible();
  await expect(card.getByText("Your email is connected.")).toBeVisible();

  // The point of the round trip: it's stored server-side, not just in React state.
  await page.goto("/settings?tab=integrations");
  await expect(card.getByText("owner@demo.test")).toBeVisible();
  await expect(card.getByRole("button", { name: "Connect Google" })).toHaveCount(0);

  // And disconnecting really removes it — again, across a reload.
  await card.getByRole("button", { name: "Disconnect" }).click();
  await expect(card.getByText("Not connected")).toBeVisible();

  await page.goto("/settings?tab=integrations");
  await expect(card.getByRole("button", { name: "Connect Google" })).toBeVisible();
});
