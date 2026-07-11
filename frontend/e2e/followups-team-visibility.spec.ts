import { test, expect, Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Follow-ups team visibility (docs/user-stories/follow-ups-team-visibility.md):
 * a reminder added by the OWNER on a rep's lead must land in the REP's list
 * (assigned to the lead owner, not the clicker), while the owner sees the whole
 * team on /follow-ups with a person filter. Salespeople get neither the filter
 * nor anyone else's reminders.
 */
test.describe("Follow-ups team visibility", () => {
  test("owner adds a reminder on a rep's lead → team view shows it, rep owns it", async ({
    page,
    browser,
  }) => {
    const note = `e2e follow-up ${Date.now()}`;

    // Owner: add a reminder on a lead assigned to rep@demo.test ("Demo Rep").
    await login(page);
    await page.goto("/leads");
    await page.getByText("Demo Lead 1", { exact: true }).first().click();
    await page.getByRole("button", { name: "Add Reminder" }).click();
    await page.getByPlaceholder("e.g. Follow up on pricing").fill(note);
    await page.getByRole("button", { name: "Create Reminder" }).click();
    await expect(page.getByText(note)).toBeVisible();

    // Owner's /follow-ups: team view — person filter present, reminder shown
    // and attributed to the lead's owner (Demo Rep), not the owner who clicked.
    await page.goto("/follow-ups");
    const personFilter = page.getByLabel("Filter follow-ups by person");
    await expect(personFilter).toBeVisible();
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.getByText("· Demo Rep").first()).toBeVisible();

    // Narrowing to the rep keeps it; narrowing to "Me" (the owner) hides it.
    await personFilter.selectOption({ label: "Demo Rep" });
    await expect(page.getByText(note)).toBeVisible();
    await personFilter.selectOption({ label: "Me" });
    await expect(page.getByText(note)).toHaveCount(0);

    // Rep: sees the reminder in their own list, with no person filter offered.
    const repContext = await browser.newContext();
    const repPage = await repContext.newPage();
    await loginAs(repPage, "rep@demo.test", "Sales123!");
    await repPage.goto("/follow-ups");
    await expect(repPage.getByText(note)).toBeVisible();
    await expect(repPage.getByLabel("Filter follow-ups by person")).toHaveCount(0);
    await repContext.close();
  });
});

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}
