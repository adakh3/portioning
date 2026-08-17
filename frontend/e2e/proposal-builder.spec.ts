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
    // Open the first lead in the pipeline.
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");

    // Find any lead detail link; if the pipeline is empty, skip.
    const leadLink = page.locator('a[href^="/leads/"]').first();
    if ((await leadLink.count()) === 0) {
      test.skip(true, "No leads in the demo pipeline to draft from.");
    }
    await leadLink.click();
    await page.waitForURL(/\/leads\/\d+$/, { timeout: 15_000 });

    const draftBtn = page.getByRole("button", { name: "Draft Proposal" });
    if ((await draftBtn.count()) === 0) {
      test.skip(true, "Proposal agent not configured for this org (no LLM key) — button absent.");
    }

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
