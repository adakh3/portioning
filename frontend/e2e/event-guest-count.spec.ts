import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Guest count is the primary number on an event. seed_demo's "Demo Co" is a US
 * org (Adults/Kids/Vendors segments), so per REL-404 it uses a single guest count
 * and the legacy gents/ladies split is NOT offered. Mocked tests prove the payload
 * wiring; only a real browser round-trip proves the native number input fires
 * onChange, the save reaches sqlite, and the count survives a reload.
 *
 * The gents/ladies split itself (open/adjust/clear) is a Gents+Ladies-org feature
 * — no demo org uses it anymore, so it is covered by GuestCountField's mocked
 * unit tests (components/GuestCountField.test.tsx) rather than here.
 */
test.describe("Event single guest count persists end-to-end (US org)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("count persists through a reload, and the gents/ladies split is not offered", async ({ page }) => {
    await page.goto("/events/new");

    await page.getByLabel("Customer", { exact: false }).selectOption({ label: "Aisha Khan" });
    await page.getByLabel("Guest Count").fill("150");
    // US org: no split control at all.
    await expect(page.getByRole("checkbox", { name: /gents \/ ladies split/i })).toHaveCount(0);

    await page.getByRole("button", { name: "Create Event" }).click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });

    await expect(page.getByText("150")).toBeVisible();
    await expect(page.getByText("Split: not specified")).toHaveCount(0); // no split concept for this org

    // Reopen the editor after a hard reload — the count persisted, still no split UI.
    await page.reload();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Guest Count")).toHaveValue("150");
    await expect(page.getByRole("checkbox", { name: /gents \/ ladies split/i })).toHaveCount(0);
  });
});
