import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * On-demand follow-up generation (docs/user-stories/followup-generate-on-demand.md):
 * the preview must list the seeded stale leads pre-ticked, deselection must update
 * the count, and Cancel must create nothing. Generation itself is NOT run here —
 * it would spend real LLM calls — it's covered by backend + integration tests.
 *
 * The second test covers sending an EMAIL follow-up (REL-501) against the real
 * stack. Drafting is still skipped — the draft row is planted directly — but the
 * send is real all the way to the mailbox transport, which is what the mocked
 * suite cannot prove: that the card offers Email, that the edited subject
 * survives the round trip, and that the ledger row is actually written.
 */

// Playwright runs from frontend/; the backend and (possibly shared) venv sit above.
const REPO = path.resolve(process.cwd(), "..");
const BACKEND = path.join(REPO, "backend");
const PYTHON =
  [
    path.join(REPO, "venv/bin/python"),
    // Worktrees under .claude/worktrees/<name>/ borrow the main checkout's venv.
    path.resolve(REPO, "../../../venv/bin/python"),
  ].find(existsSync) ?? "python3";

// Make the demo org's pipeline leads stale and enable AI follow-ups, so the
// preview has something real to show. Idempotent — safe to re-run.
const SETUP = `
from datetime import timedelta
from django.utils import timezone
from users.models import Organisation
from bookings.models import Lead, OrgSettings

org = Organisation.objects.get(name="Demo Co")
s = OrgSettings.for_org(org)
s.ai_followups_enabled = True
s.save()
Lead.objects.filter(organisation=org, contact_name__contains=" Lead ").update(
    updated_at=timezone.now() - timedelta(days=30)
)
print("stale setup ok")
`;

test.describe("On-demand follow-up generation", () => {
  test.beforeAll(() => {
    execSync(`"${PYTHON}" manage.py shell`, { cwd: BACKEND, input: SETUP });
  });

  test("preview lists stale leads pre-ticked; deselect updates; cancel creates nothing", async ({
    page,
  }) => {
    await login(page); // owner sees the whole org
    await page.goto("/follow-ups");
    await page.getByRole("button", { name: /AI Follow-ups/ }).click();
    await page.getByRole("button", { name: "Generate follow-ups" }).click();

    // Seeded stale leads appear, all pre-ticked.
    await expect(page.getByText("Demo Lead 1")).toBeVisible();
    const boxes = page.getByRole("checkbox");
    const total = await boxes.count();
    expect(total).toBeGreaterThan(1);
    for (const box of await boxes.all()) {
      await expect(box).toBeChecked();
    }
    await expect(
      page.getByRole("button", { name: `Create ${total} drafts` }),
    ).toBeVisible();

    // Deselecting one lead updates the count.
    await page.getByLabel("Draft a follow-up for Demo Lead 1").uncheck();
    await expect(
      page.getByRole("button", {
        name: `Create ${total - 1} draft${total - 1 === 1 ? "" : "s"}`,
      }),
    ).toBeVisible();

    // Cancel: back to the idle button, and no drafts were generated.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Generate follow-ups" })).toBeVisible();
    await expect(page.getByText(/drafts? created/)).toHaveCount(0);
  });
});

// ── Sending an email follow-up, end to end (REL-501) ─────────────────────────

// Connect a mailbox and plant ONE pending email draft on a lead that has an
// address. Everything is marked E2E-… so the teardown can find it again — this
// suite is run repeatedly against a live dev database.
const EMAIL_SETUP = `
from datetime import timedelta
from django.utils import timezone
from users.models import Organisation
from bookings.models import ConnectedMailbox, FollowUpDraft, Lead, OrgSettings

org = Organisation.objects.get(name="Demo Co")
s = OrgSettings.for_org(org)
s.ai_followups_enabled = True
s.save()

ConnectedMailbox.objects.filter(organisation=org).delete()
mailbox = ConnectedMailbox(
    organisation=org, provider=ConnectedMailbox.GOOGLE,
    email_address="e2e-owner@example.com",
    status=ConnectedMailbox.CONNECTED,
    access_token_expires_at=timezone.now() + timedelta(hours=1),
)
mailbox.refresh_token = "e2e-refresh"
mailbox.access_token = "e2e-access"
mailbox.save()

lead, _ = Lead.objects.get_or_create(
    organisation=org, contact_name="E2E Email Lead",
    defaults={"contact_email": "e2e-client@example.com", "status": "contacted"},
)
Lead.objects.filter(pk=lead.pk).update(contact_email="e2e-client@example.com")
FollowUpDraft.objects.filter(lead=lead).delete()
FollowUpDraft.objects.create(
    organisation=org, lead=lead, channel="email",
    subject="E2E drafted subject", body="Hello, checking in about your event.",
    status="pending",
)
print("email setup ok")
`;

const EMAIL_TEARDOWN = `
from users.models import Organisation
from bookings.models import ConnectedMailbox, FollowUpDraft, Lead, WhatsAppMessage

org = Organisation.objects.get(name="Demo Co")
leads = Lead.objects.filter(organisation=org, contact_name="E2E Email Lead")
FollowUpDraft.objects.filter(lead__in=leads).delete()
WhatsAppMessage.objects.filter(lead__in=leads).delete()
leads.delete()
ConnectedMailbox.objects.filter(
    organisation=org, email_address="e2e-owner@example.com",
).delete()
print("email teardown ok")
`;

// What actually reached the mailbox transport, read back out of the ledger the
// backend wrote — the point of the test is that this row exists at all.
const ASSERT_SENT = `
from users.models import Organisation
from bookings.models import FollowUpDraft, Lead, WhatsAppMessage

org = Organisation.objects.get(name="Demo Co")
lead = Lead.objects.get(organisation=org, contact_name="E2E Email Lead")
draft = FollowUpDraft.objects.get(lead=lead)
msg = WhatsAppMessage.objects.get(lead=lead, channel="email")
print("RESULT", draft.status, "|", msg.to_email, "|", msg.status, "|", msg.subject)
`;

test.describe("Sending an email follow-up", () => {
  test.beforeAll(() => {
    execSync(`"${PYTHON}" manage.py shell`, { cwd: BACKEND, input: EMAIL_SETUP });
  });

  test.afterAll(() => {
    execSync(`"${PYTHON}" manage.py shell`, { cwd: BACKEND, input: EMAIL_TEARDOWN });
  });

  test("the card offers Email, and sending it writes the ledger row", async ({ page }) => {
    await login(page);
    await page.goto("/follow-ups");
    await page.getByRole("button", { name: /AI Follow-ups/ }).click();

    // Narrow to our draft's card — the demo org may have others pending.
    const card = page
      .getByTestId("followup-draft")
      .filter({ has: page.getByRole("link", { name: "E2E Email Lead" }) });

    // exact, or it also matches the "Send via Email" button below it.
    await expect(
      card.getByRole("button", { name: "Email", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    const subject = card.getByLabel("Subject");
    await expect(subject).toHaveValue("E2E drafted subject");
    await subject.fill("E2E edited subject");

    await card.getByRole("button", { name: /Send via Email/ }).click();

    // The card leaves the pending queue once it has actually gone.
    await expect(page.getByRole("link", { name: "E2E Email Lead" })).toHaveCount(0);

    const out = execSync(`"${PYTHON}" manage.py shell`, {
      cwd: BACKEND, input: ASSERT_SENT,
    }).toString();
    const result = out.split("\n").find((l) => l.startsWith("RESULT")) ?? "";
    expect(result).toContain("sent");
    expect(result).toContain("e2e-client@example.com");
    // The subject the rep approved is the one that went — not the drafted one.
    expect(result).toContain("E2E edited subject");
  });
});
