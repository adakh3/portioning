# AI Follow-up Drafts

## User story
As a salesperson, I want the app to draft WhatsApp follow-ups for leads that have
gone quiet, so that I can nudge them in one click instead of writing each message
from scratch — while still reviewing every message before it's sent.

## How it works (v1 scope)
- A scheduled agent (`manage.py run_followup_agent`, run by cron) finds **stale**
  leads (not won/lost, untouched for `followup_stale_hours`, has a phone number,
  no existing pending draft).
- For each, an LLM reads the lead's details + recent activity + recent WhatsApp
  thread and either **drafts** a short follow-up or **skips** the lead. The model
  is supplier-agnostic: `LLM_FOLLOWUP_DRAFTER` env var as `provider:model`
  (default `openai:gpt-5.4-nano`; e.g. `anthropic:claude-haiku-4-5` to switch) —
  see `backend/portioning/llm.py`.
- Drafts land in a review queue as `pending`. **Nothing is auto-sent.**
- A human approves (optionally editing the text) → the message goes out via the
  existing WhatsApp/Twilio path; or dismisses it.

### Platform vs. org configuration
- **LLM provider keys** (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — only the provider
  in use needs one), the **drafting model** (`LLM_FOLLOWUP_DRAFTER`), and the
  **Twilio account** are platform-level (env vars) — not per-org.
- Each org only: toggles **AI Follow-ups** on/off, sets the **stale threshold** and
  **max drafts per lead**, and (for delivery) has a WhatsApp sender number.
- **Drafting is decoupled from Twilio**: drafts generate with just the org opt-in +
  the configured provider's key. Sending requires WhatsApp configured; if it isn't, approve
  fails with a clear message and the draft stays pending.

## Acceptance criteria
- [ ] With AI Follow-ups enabled + the configured provider's key, running the agent
      creates a pending draft for a stale lead.
- [ ] Switching `LLM_FOLLOWUP_DRAFTER` between `openai:*` and `anthropic:*` changes
      which supplier drafts (visible in the draft's `model_used`) with no code change.
- [ ] The agent skips leads it judges shouldn't be contacted (no draft created).
- [ ] The agent never exceeds `followup_max_drafts_per_lead` for one lead, and never
      stacks a second pending draft on a lead that already has one.
- [ ] Leads with no phone number are skipped.
- [ ] A pending draft appears both on the lead-detail page ("Suggested Follow-up"
      card) and in the **Follow-ups → AI Drafts** queue.
- [ ] Approving sends the message (edited text if changed), marks the draft `sent`,
      and the sent message appears in the lead's WhatsApp thread.
- [ ] Dismissing marks the draft `dismissed` and removes it from the queue.
- [ ] Bulk "Approve all" sends every pending draft; failures are reported.
- [ ] The nav "Follow-ups" link and the "AI Drafts" tab show the pending count.
- [ ] Approving when WhatsApp isn't configured shows a clear error and leaves the
      draft pending.
- [ ] Drafts are org-scoped — one org never sees or acts on another's drafts.

## Manual test cases

> Setup: in `backend/.env` set the key for the provider named in `LLM_FOLLOWUP_DRAFTER`
> (default `openai:gpt-5.4-nano` → `OPENAI_API_KEY`; set `LLM_FOLLOWUP_DRAFTER=anthropic:claude-haiku-4-5`
> + `ANTHROPIC_API_KEY` to test the Claude path). For send tests also set
> `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` (Twilio WhatsApp Sandbox is fine) and, in
> Settings → Integrations, an org WhatsApp number. Enable **AI Follow-ups** in Settings.

### TC1 — Agent drafts for a stale lead
**Steps:**
1. Create a lead with a phone number, status `contacted`; make it stale (set the
   stale threshold low, or leave it untouched past the threshold).
2. Run `python manage.py run_followup_agent --dry-run` — note it reports it *would*
   draft, without writing or calling Claude.
3. Run `python manage.py run_followup_agent`.
**Expected:** A pending draft is created. Its text references the lead by name; the
reasoning is populated; `model_used` records the configured `provider:model`.

### TC2 — Review on the lead page
**Steps:**
1. Open the lead's detail page.
2. Find the "Suggested Follow-up" card, edit the wording, click **Approve & Send**.
**Expected:** The card clears, the message appears in the WhatsApp thread with the
*edited* text, and the pending count drops.

### TC3 — The AI Drafts queue + bulk approve
**Steps:**
1. Generate drafts for 2–3 leads.
2. Go to **Follow-ups → AI Drafts**. Confirm the tab shows the count.
3. Click **Approve all (N)**.
**Expected:** All drafts send; the queue empties; any failures are reported inline.

### TC4 — Dismiss
**Steps:** On a pending draft (card or queue), click **Dismiss**.
**Expected:** The draft leaves the queue and does not send; status becomes `dismissed`.

### TC5 — Agent skips / caps
**Steps:**
1. On a lead that just received a reply, run the agent.
2. On a lead already at `max drafts per lead`, run the agent.
**Expected:** No new draft in either case.

### TC6 — Drafting without Twilio, and approve failure
**Steps:**
1. Unset the Twilio env vars (keep the LLM provider key). Run the agent on a stale lead.
2. Try to **Approve & Send** the resulting draft.
**Expected:** The draft is still created (drafting is decoupled). Approve returns a
clear "WhatsApp is not configured" error and the draft stays pending.

### TC7 — Org isolation
**Steps:** As a user in org A, attempt to view/approve a draft belonging to org B
(e.g. via the API with B's draft id).
**Expected:** 404 — the draft is invisible and cannot be acted on.
