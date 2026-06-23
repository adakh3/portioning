# Org-customizable lead statuses

## User story
As an **org owner/manager**, I want to **define my own lead pipeline stages** —
adding, renaming, recoloring, reordering, and retiring them — and **control which
stages appear on the kanban board**, so that the CRM matches my actual sales process
instead of a fixed, hardcoded set.

## Background / how it works
- Lead statuses live per-org in `LeadStatusOption` (the same rows edited in Django admin).
- Each status has a **colour**, a stable internal **value** (auto-generated from the
  first label, never changed afterwards so existing leads aren't orphaned), and three
  semantic flags: **Default** (new leads start here), **Won** (converts to an event),
  **Lost** (asks for a lost reason).
- The kanban columns, status dropdowns, and table pills are all driven by these rows.

## Acceptance criteria
- [ ] Owner/manager can add, rename, recolor, reorder (drag), deactivate, and delete statuses in **Settings → Lead Statuses**.
- [ ] Exactly one Default, one Won, and one Lost stage per org (setting one clears the previous).
- [ ] Renaming a status keeps existing leads in it (value is stable).
- [ ] A status that is **in use** by leads, or is the **Default**, cannot be deleted (clear error).
- [ ] New leads start in the **Default** stage.
- [ ] Marking **Won** (drag or button) triggers convert-to-event; marking **Lost** requires a reason — both keyed off the flag, so they still work after renaming.
- [ ] Kanban columns reflect the org's statuses in the configured order, with their colours.
- [ ] A **Columns** control lets the user show/hide which status columns appear; the choice persists per browser.
- [ ] **Load more** pagination works in every column, including newly added statuses.
- [ ] Edits in Settings and Django admin stay in sync (same data).
- [ ] Existing orgs keep their current statuses after upgrade (colours/flags backfilled, nothing wiped).
- [ ] A non-manager (salesperson) cannot edit statuses.

## Manual test cases

### TC1 — View and the default seed
**Steps:** Open **Settings → Lead Statuses**.
**Expected:** Your existing stages are listed in order, each with a colour swatch row, a
label field, Default/Won/Lost toggles, and Active/Hidden. "New" is Default, "Won" is Won,
"Lost" is Lost.

### TC2 — Add a status
**Steps:** Type "Site Visit" in *New status name…* → **+ Add status**.
**Expected:** A new "Site Visit" row appears at the bottom. Reopen the page (or check
Django admin → Lead status options) and it's persisted.

### TC3 — Rename keeps leads
**Steps:** Note a status that has leads in it (e.g. "Qualified"). Change its label to
"Hot Lead" and click away (blur).
**Expected:** Label updates everywhere (kanban, dropdowns). The leads that were
"Qualified" are still in that same column — none are lost.

### TC4 — Recolor
**Steps:** Click a different colour swatch on a status row.
**Expected:** The selected swatch shows a ring; the kanban column header and the table
status pill for that status switch to the new colour.

### TC5 — Reorder by drag
**Steps:** Drag a status row by its **grip handle** (⠿) to a new position.
**Expected:** The row moves; on the Leads kanban the columns appear in the new order.

### TC6 — Single Default / Won / Lost
**Steps:** Click **Default** on a status that isn't currently the default.
**Expected:** That status becomes Default and the previously-default one is no longer
Default. (Repeat for Won and Lost.)

### TC7 — New lead uses Default
**Steps:** Make "Contacted" the Default. Create a new lead via **Quick Add** without
choosing a status.
**Expected:** The new lead's status is "Contacted".

### TC8 — Won converts, even renamed
**Steps:** Rename "Won" to "Closed Won" (keeps the Won flag). On the Leads board, drag a
lead into the "Closed Won" column.
**Expected:** The mark-won / create-event flow triggers (not a silent move).

### TC9 — Lost requires a reason
**Steps:** Drag a lead into the Lost-flagged column (or use the table action).
**Expected:** The "lost reason" dialog appears; the transition is blocked until a reason
is chosen.

### TC10 — Deactivate (hide) vs delete
**Steps:** (a) Toggle a status to **Hidden**. (b) Try to **delete (✕)** a status that has
leads in it. (c) Try to delete the **Default** status. (d) Delete a brand-new unused status.
**Expected:** (a) Hidden statuses drop out of the pickers/board but their leads remain.
(b) and (c) are blocked with a clear message ("deactivate it instead" / "set another
default first"). (d) deletes successfully.

### TC11 — Kanban show/hide columns
**Steps:** On **Leads** (kanban view), click **Columns (n/N)** → untick some statuses.
**Expected:** Those columns disappear from the board. Reload the page — your selection
persists. Tick them back to restore.

### TC12 — Load more in a custom column
**Steps:** Ensure a status (incl. a newly added one) has > 20 leads. Open the board.
**Expected:** The column shows a count and the first 20 leads with a **Load more** button;
clicking it appends the next 20, repeating until all are shown.

### TC13 — Django admin parity
**Steps:** Edit a status' colour/flags in Django admin (`/api/admin/` → Lead status
options), then reload Settings → Lead Statuses (and vice-versa).
**Expected:** Changes made in one place show in the other — it's the same data.

### TC14 — Existing-org upgrade (data safety)
**Steps:** On an org that existed before this feature, open Settings → Lead Statuses.
**Expected:** All previous stages are present (same labels/order), now with sensible
colours and the Default/Won/Lost flags set. No stage or lead was wiped or reset.

### TC15 — Permissions
**Steps:** Log in as a **salesperson** and try to reach the lead-status management.
**Expected:** Cannot add/edit/delete statuses (the management API rejects them); they can
still see statuses on leads.

## Automated coverage (for reference)
- Backend: `bookings/test_lead_statuses.py` (seed, CRUD, single-flag enforcement,
  delete guards, dynamic kanban, flag-driven won/lost, permissions).
- Frontend: `components/LeadStatusesSettings.test.tsx`, `lib/statusColors.test.ts`.
