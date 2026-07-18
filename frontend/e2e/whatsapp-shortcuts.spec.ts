import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * WhatsApp shortcuts (docs/user-stories/whatsapp-shortcuts.md): with NO Twilio
 * configured (the genuine local state), a pending AI draft must offer
 * "Send via WhatsApp" that opens wa.me with the lead's E.164 number and the
 * draft body prefilled, and "Mark sent" must flip the draft to sent so the
 * scheduler ledger stays truthful. This is exactly the class the mocked vitest
 * suite can't prove: real settings endpoint, real draft row, real popup.
 */

const REPO = path.resolve(process.cwd(), "..");
const BACKEND = path.join(REPO, "backend");
const PYTHON =
  [
    path.join(REPO, "venv/bin/python"),
    path.resolve(REPO, "../../../venv/bin/python"),
  ].find(existsSync) ?? "python3";

const BODY = "Hello Ms Shortcut, following up on your enquiry.";

// Idempotent: enable shortcuts, plant one lead with a valid E.164 phone and one
// pending draft with a known body. Prints the wa.me digits for the assertion.
const SETUP = `
from users.models import Organisation
from bookings.models import Lead, OrgSettings, WhatsAppMessage
from bookings.models.followups import FollowUpDraft

org = Organisation.objects.get(name="Demo Co")
s = OrgSettings.for_org(org)
s.ai_followups_enabled = True
s.whatsapp_shortcuts_enabled = True
s.save()

lead, _ = Lead.objects.update_or_create(
    organisation=org, contact_first_name="E2E", contact_last_name="Shortcut",
    defaults={"contact_phone": "+14155550123", "status": "new"},
)
FollowUpDraft.objects.filter(organisation=org, lead=lead).delete()
WhatsAppMessage.objects.filter(organisation=org, lead=lead).delete()
FollowUpDraft.objects.create(
    organisation=org, lead=lead, body=${JSON.stringify(BODY)},
    reasoning="e2e", status="pending", model_used="e2e:none",
)
print("shortcut setup ok", lead.contact_phone)
`;

test.describe("WhatsApp shortcuts (no Twilio)", () => {
  test.beforeAll(() => {
    execSync(`"${PYTHON}" manage.py shell`, { cwd: BACKEND, input: SETUP });
  });

  test("draft card opens wa.me with number + body, Mark sent flips the draft", async ({
    page,
    context,
  }) => {
    // wa.me is external — serve an empty page so the popup keeps its URL
    // without the test ever touching the real site.
    await context.route("https://wa.me/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "" }),
    );

    await login(page);
    await page.goto("/follow-ups");
    await page.getByRole("button", { name: /AI Follow-ups/ }).click();

    const card = page
      .locator("div")
      .filter({ hasText: BODY })
      .getByRole("button", { name: /Send via WhatsApp/ })
      .first();
    await expect(card).toBeVisible();
    // Shortcuts mode replaces the Twilio bulk button entirely.
    await expect(
      page.getByRole("button", { name: /Approve & send all/ }),
    ).toHaveCount(0);

    const [popup] = await Promise.all([page.waitForEvent("popup"), card.click()]);
    expect(popup.url()).toBe(
      `https://wa.me/14155550123?text=${encodeURIComponent(BODY)}`,
    );
    await popup.close();

    // Honor-system confirm: Mark sent → draft leaves the pending queue.
    await page.getByRole("button", { name: "Mark sent" }).click();
    await expect(page.getByText(BODY)).toHaveCount(0);

    // Ledger truth: the draft is now 'sent' with a manual outbound message.
    const check = execSync(`"${PYTHON}" manage.py shell`, {
      cwd: BACKEND,
      input: `
from users.models import Organisation
from bookings.models import Lead, WhatsAppMessage
from bookings.models.followups import FollowUpDraft
org = Organisation.objects.get(name="Demo Co")
lead = Lead.objects.get(organisation=org, contact_first_name="E2E", contact_last_name="Shortcut")
d = FollowUpDraft.objects.filter(organisation=org, lead=lead).latest("created_at")
m = WhatsAppMessage.objects.filter(organisation=org, lead=lead, from_phone="manual").count()
print("VERDICT", d.status, m)
`,
    }).toString();
    expect(check).toContain("VERDICT sent 1");
  });
});
