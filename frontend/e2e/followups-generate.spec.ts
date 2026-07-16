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
    await page.getByRole("button", { name: /AI Drafts/ }).click();
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
