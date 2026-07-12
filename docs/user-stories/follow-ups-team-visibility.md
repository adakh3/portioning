# Follow-ups — team visibility & lead-owner assignment

## User story
As an **admin or owner**, I want to see my whole team's pending follow-ups (and
filter to one person), so that nothing a salesperson owes a lead falls through
the cracks. And as anyone adding a follow-up on a lead, I want it to land in the
**responsible salesperson's** list — not mine — so the right person is reminded.

## Background / the bug this fixes
Previously every follow-up (`Reminder`) was assigned to *whoever clicked "Add
reminder"*, and the follow-ups list only ever showed *your own*. So:
- An admin who never personally added a reminder saw an empty list.
- A follow-up an admin/manager scheduled on a rep's lead landed in the admin's
  list, and the rep who owned the lead never saw it.

## What changed
- **Assignment on creation:** a new follow-up is assigned to the lead's
  `assigned_to` (the rep working it), falling back to the lead's `created_by`,
  then to whoever added it if the lead has neither. `created_by` on the reminder
  still records who actually added it.
- **List scope (role-aware, mirrors leads/quotes/events):**
  - **Salesperson** → sees only follow-ups assigned to them.
  - **Admin / owner** → sees the whole team by default; can filter by person
    (`?user=<id>` or `?user=me`) via a dropdown.
- **Badge counts** (`/reminders/counts/`) use the same scope, so the sidebar
  count matches the default list view for each role.
- **Team view** shows the assignee's name on each follow-up card.

## Acceptance criteria
1. A salesperson's follow-ups list shows only reminders assigned to them; no
   person-filter dropdown is shown.
2. An admin/owner's follow-ups list defaults to the whole team, with a person
   filter (All / Me / each user).
3. Adding a follow-up on a lead assigns it to the lead's rep, regardless of who
   adds it.
4. The sidebar overdue/due-today badge reflects the same scope as the list.

## Manual test cases

1. **Admin sees the team**
   - Log in as an admin/owner. Open **Follow-ups**.
   - Expect: reminders for the whole org, subtitle "…across the team", each card
     shows the assignee's name, and a person-filter dropdown is present.

2. **Filter by person**
   - As the admin, pick a salesperson in the dropdown.
   - Expect: only that person's pending follow-ups. Pick **Me** → only your own
     (likely empty for an admin). Pick **All (team)** → back to everyone.

3. **Salesperson is scoped to self**
   - Log in as a salesperson. Open **Follow-ups**.
   - Expect: only your own follow-ups, subtitle "Your pending follow-up
     reminders", and **no** person-filter dropdown.

4. **New follow-up goes to the lead's rep, not the creator**
   - As an admin, open a lead assigned to salesperson S and add a follow-up.
   - Log in as S → Follow-ups. Expect: the new follow-up appears in S's list.
   - As the admin, with no filter you also see it (team view); with **Me** you
     do not.

5. **Unassigned lead falls back to the creator**
   - Add a follow-up on a lead with no assignee but created by rep S.
   - Expect: the follow-up is assigned to S.

6. **Badge matches the list**
   - Confirm the sidebar overdue/due-today badge for an admin counts the team's
     pending items, and for a salesperson counts only their own.
