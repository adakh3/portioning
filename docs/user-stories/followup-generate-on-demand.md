# On-demand follow-up generation (preview → select → generate)

**As a** salesperson (for my own leads) or manager/admin/owner (for the whole team),
**I want to** press a button that shows me which stale leads would get an AI follow-up
draft — and untick any I want left alone — before the drafts are generated,
**so that** I control exactly who gets chased, instead of a scheduled job deciding for me.

## How it works (v1 scope)
- On **Follow-ups → AI Drafts**, a **"Generate follow-ups"** button opens a preview:
  every eligible stale lead as a row, **all pre-ticked**, sorted most-stale first,
  with a select-all/none toggle.
- Each row shows: lead name (linked), **days since last touch**, assigned salesperson
  (avatar + name), pipeline status chip, event date, and budget.
- **Eligibility** (same rules as the agent — single source of truth in
  `followup_agent.find_stale_leads`): active lead (not won/lost), has a phone,
  event date not passed, no pending draft, fewer than
  `followup_max_drafts_per_lead` follow-ups **sent** (dismissed don't count),
  and the escalating cadence gates (first/second/final gap days, counting
  record edits, our sends, and the lead's replies alike).
- **Role scoping:** salespeople see and generate for their own leads only
  (assigned to them or created by them); managers/admins/owners see the whole org.
- Confirming generates drafts **one lead at a time with live progress**
  ("12 of 30 drafted…"); each draft appears in the queue as it's created, so leaving
  the page mid-run keeps whatever finished.
- The AI keeps its judgment: a selected lead can still be **skipped** (e.g. they asked
  for space). The end-of-run summary shows "X drafts created, Y skipped" with the
  AI's one-line reasoning per skip.
- The server **re-validates eligibility per lead at generation time** — a lead touched
  (or drafted by a colleague) between preview and confirm is skipped safely, never
  double-drafted.
- **No cron is scheduled.** The button is the only trigger for now;
  `manage.py run_followup_agent` stays for testing and as a future option.
- Empty state: "No stale leads right now" mentioning the org's stale threshold.

### Out of scope (v1)
- Scheduling / automatic generation.
- Editing draft text in the preview (editing stays in the review queue).
- Filtering the preview by salesperson.
- Per-lead or per-run model choice (model comes from `LLM_FOLLOWUP_DRAFTER`).

## Acceptance criteria
- [ ] The AI Drafts tab shows a "Generate follow-ups" button for every signed-in role.
- [ ] The preview lists exactly the leads the agent would draft for (eligibility rules
      above), pre-ticked, most-stale first, with the six row fields.
- [ ] A salesperson's preview contains only their own leads; a manager's contains the
      whole org's. One org never sees another org's leads.
- [ ] Deselected leads are not drafted; selected ones are, one at a time, with visible
      progress and drafts appearing in the queue as they land.
- [ ] The summary reports created vs skipped counts, with the AI's reasoning per skip.
- [ ] A lead that became ineligible between preview and confirm (touched, won/lost,
      or a pending draft appeared) is reported as skipped, not drafted twice.
- [ ] With no eligible leads, the preview shows the empty state and generation is
      not possible.
- [ ] Everything is org-scoped; generating for another org's lead ID is rejected.

## Manual test cases

> Setup: seeded demo org (`seed_demo`), AI Follow-ups enabled in Settings, and the
> key for the provider named in `LLM_FOLLOWUP_DRAFTER` set in `backend/.env`.
> Make 2–3 leads stale (set the org's stale threshold low, or backdate `updated_at`).

### TC1 — Preview shows the right leads
**Steps:** As owner, open Follow-ups → AI Drafts → "Generate follow-ups".
**Expected:** Every stale lead with a phone and no pending draft appears, pre-ticked,
most-stale first, showing name / days stale / assignee / status / event date / budget.
A lead without a phone number, a won/lost lead, and a fresh lead do NOT appear.

### TC2 — Deselect and generate
**Steps:** Untick one lead, confirm.
**Expected:** Progress counts up one at a time; drafts appear in the queue as they
finish; the unticked lead gets no draft. Summary shows created/skipped counts and a
reasoning line for any AI-skipped lead.

### TC3 — Salesperson scoping
**Steps:** Sign in as rep@demo.test with stale leads belonging to both reps; open the
preview.
**Expected:** Only rep's own leads are listed. Generating drafts only their own.

### TC4 — Race safety
**Steps:** Open the preview, then (in another window) log an activity on one listed
lead. Confirm generation for all.
**Expected:** The touched lead is reported as skipped (no longer stale), not drafted.

### TC5 — Empty state
**Steps:** With no stale leads (raise the threshold), open the preview.
**Expected:** "No stale leads right now" with the threshold mentioned; nothing to
confirm.

## Automated coverage
- Backend: preview eligibility + role scoping + org isolation; generate happy path,
  AI-skip path, and re-validation (ineligible-at-generate) — `bookings.test_followups`.
- Frontend: page-level integration test driving the real AI Drafts tab — open preview,
  deselect, confirm, assert one generate call per selected lead and the summary —
  `app/follow-ups/page.test.tsx`.
- E2E (Playwright): preview renders seeded stale leads with selection working
  (generation itself needs a real LLM key, so it stays out of e2e).
