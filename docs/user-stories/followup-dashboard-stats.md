# Follow-up workload on the dashboard (to review / due / sent)

**As a** salesperson,
**I want to** see at a glance how many AI follow-ups are waiting for me and how
many I've sent recently,
**and as a** manager/admin/owner,
**I want** the same numbers for the whole team with a per-person split,
**so that** nobody discovers a backed-up follow-up queue by accident.

## The three numbers
- **Follow-ups to review** — generated drafts sitting in the review queue
  (status `pending`). A live count; ignores the time window.
- **Leads due a follow-up** — leads the cadence logic (`find_stale_leads`)
  would draft for right now, but where nobody has pressed Generate yet.
  Live count; ignores the time window.
- **Follow-ups sent** — AI drafts actually sent (Twilio approve **or**
  WhatsApp-shortcut "Mark sent") **within the selected window**. AI follow-ups
  only — completed reminders and quote shares don't count.

## How it works
- **Backend**: `GET /api/bookings/followup-drafts/stats/` with the dashboard's
  window params (`period=all|today|week|month|custom` + `date_from`/`date_to`),
  sharing the dashboard's window parser. Role scope mirrors the review queue:
  salespeople get their own numbers only; everyone else gets team totals plus a
  `breakdown` array per person. Attribution: *to review* and *due* go to the
  lead's assignee ("Unassigned" bucket otherwise); *sent* goes to whoever
  pressed send (`reviewed_by`).
- **Dashboard (manager)**: three tiles under the KPI row obeying the existing
  period picker, plus a "Follow-ups by person" card listing each rep as
  "X to review · Y due · Z sent" (all-zero rows hidden) with a link to the
  follow-ups page.
- **Dashboard (salesperson)**: the same three tiles in the "My pipeline"
  section; no per-person card. Reps have no period picker, so their "sent"
  uses a fixed last-30-days window (labelled).

## Acceptance criteria
- [ ] A salesperson's numbers cover exactly their own leads (assigned or
      created); a manager's cover the whole org; orgs never mix.
- [ ] "To review" + "due" don't move when the period changes; "sent" does.
- [ ] A draft sent via the WhatsApp shortcut counts in "sent" the same as a
      Twilio-approved one.
- [ ] The per-person card appears only for manager/admin/owner, attributing
      sends to the person who sent them.
- [ ] A lead with a pending draft appears in "to review", not "due".

## Manual test cases

> Setup: seeded demo org, AI follow-ups enabled, a few stale leads
> (`seed_demo` then backdate, or reuse the follow-ups e2e setup).

### TC1 — Rep view
Sign in as rep@demo.test → dashboard. Expected: three follow-up tiles with the
rep's own numbers; "sent" labelled "last 30 days"; no per-person card.

### TC2 — Manager view + window
Sign in as owner → dashboard. Expected: team totals; switching All Time →
Today changes "sent" but not "to review"/"due"; per-person card lists only
reps with non-zero numbers.

### TC3 — Sending moves the numbers
Mark a pending draft sent (shortcut flow). Expected: "to review" −1,
"sent" +1 under the sender's name, and the lead drops out of "due" until its
next gap elapses.

## Automated coverage
- Backend: `bookings.test_followups.FollowUpStatsTests` — counts, window
  bounds, role scoping, breakdown gating, org isolation.
- Frontend: `app/page.followup-stats.test.tsx` — manager tiles + breakdown +
  period wiring; rep tiles without breakdown.
