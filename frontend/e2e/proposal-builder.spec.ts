import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * REL-413 — the AI Proposal Builder end-to-end: from a lead, "Draft Proposal"
 * opens the smart form, answering it drafts a quote, and the quote shows the AI
 * proposal panel. This is the only check that proves the real interrupt/resume
 * round-trip through a live model + the DB (the vitest suite mocks the API).
 *
 * The flow needs the org to have the proposal agent CONFIGURED (toggle on + a
 * proposal LLM model + provider key). CI has no LLM key, so the "Draft Proposal"
 * button is absent there and this test skips itself rather than failing — it runs
 * for real on an environment where the agent is configured.
 */
test.describe("AI Proposal Builder", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("lead → draft proposal → drafted quote shows the AI proposal", async ({ page }) => {
    // Navigate straight to a real lead-detail URL (avoid /leads/kanban etc.).
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    const leadHref = hrefs.find((h) => h && /^\/leads\/\d+$/.test(h));
    test.skip(!leadHref, "No lead detail in the demo pipeline to draft from.");
    await page.goto(leadHref as string);

    // The button only renders when the org has a CONFIGURED proposal agent
    // (toggle + LLM key). CI has no key, so it's absent → skip; runs for real
    // where the agent is configured.
    const draftBtn = page.getByRole("button", { name: "Draft Proposal" });
    await page.waitForLoadState("networkidle");
    test.skip((await draftBtn.count()) === 0, "Proposal agent not configured (no LLM key) — button absent.");

    await draftBtn.click();
    // The smart form appears with the agent's questions.
    await expect(page.getByRole("heading", { name: /draft a proposal/i })).toBeVisible({ timeout: 20_000 });

    // Submit the pre-filled answers and wait for the drafted quote.
    await page.getByRole("button", { name: /^draft proposal$/i }).click();
    await page.waitForURL(/\/quotes\/\d+$/, { timeout: 60_000 });

    // The quote renders the AI proposal panel.
    await expect(page.getByRole("heading", { name: "AI proposal" })).toBeVisible();
  });
});
