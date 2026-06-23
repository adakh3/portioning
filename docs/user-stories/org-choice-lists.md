# Org choice-lists in app Settings

## User story
As an **org owner/manager**, I want to manage my org's **dropdown option lists** —
event types, lead sources, service styles, meal types, and lost reasons — from the
in-app **Settings** page, so that I'm not dependent on Django admin (which org users
can't access) to configure the app.

## Background
These five lists are org-scoped `ChoiceOption` rows that were previously editable
only in Django admin. This exposes them in Settings using a single reusable
component (`ChoiceOptionsSettings`) backed by generic management endpoints
(`/bookings/settings/<type>/`, manager/owner only). Same pattern as lead statuses,
minus colour/semantic flags. Renaming keeps the underlying `value` stable so existing
records aren't orphaned; the dropdowns elsewhere refresh after edits.

## Acceptance criteria
- [ ] Settings shows sections for Event Types, Lead Sources, Service Styles, Meal Types, Lost Reasons.
- [ ] Owner/manager can add, rename, drag-reorder, deactivate (Hidden), and delete options in each.
- [ ] Adding generates a stable key from the label; renaming the label keeps the key (no orphaned records).
- [ ] Edits immediately refresh the corresponding dropdowns across the app.
- [ ] A salesperson cannot create/edit/delete (server rejects with 401/403).

## Manual test cases

### TC1 — Each list renders
**Steps:** Open Settings and scroll past Lead Statuses.
**Expected:** Cards for Event Types, Lead Sources, Service Styles, Meal Types, Lost Reasons, each listing the current options.

### TC2 — Add an option
**Steps:** In Lead Sources, type "Instagram" → **+ Add**.
**Expected:** "Instagram" appears; it persists on reload; it now shows in the Source dropdown when editing a lead.

### TC3 — Rename keeps records
**Steps:** Rename a source that some leads use (e.g. "Referral" → "Word of mouth"), click away.
**Expected:** Label updates everywhere; leads previously on that source stay on it (not orphaned).

### TC4 — Reorder
**Steps:** Drag an option by its grip handle to a new position.
**Expected:** Order updates; the dropdown elsewhere reflects the new order.

### TC5 — Hide vs delete
**Steps:** Toggle an option to **Hidden**; separately delete an unused one (✕).
**Expected:** Hidden options drop out of the pickers (existing records keep their value); delete removes it.

### TC6 — Permissions
**Steps:** As a salesperson, attempt to add/edit (or hit the endpoint).
**Expected:** Not permitted (401/403); the section is for owners/managers.

## Automated coverage
- Backend: `bookings/test_choice_management.py` (create-generates-value for all five types, rename-keeps-value + delete, salesperson blocked).
- Frontend: `components/ChoiceOptionsSettings.test.tsx` (list, add via base endpoint, rename by id).
