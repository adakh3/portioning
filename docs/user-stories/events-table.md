# Events list — table view

## User story
As a sales/ops user, I want the Events list to look and filter like the **Quotes and Leads**
lists — a sortable table with the same filter bar — so the app feels consistent and I can
scan, sort and narrow events the same way everywhere.

## Background
The Events list was a stack of cards with only a free-text search and underline status tabs —
visually unlike Quotes/Leads. Replaced with the shared table-in-a-card pattern, the same filter
bar (search + Salesperson / Product / Event Type dropdowns + event-date range), status filter
chips, and tinted status pills. Events are loaded by status, so the rest of the search/sort is
client-side (same as Quotes).

## Acceptance criteria
- [ ] Events render in a table with columns: **Event** (name), **Customer**, **Salesperson** (assigned), Event Date, Guests, Total, Created, Status (tinted pill).
- [ ] Clicking a row opens that event. The table is read-only (no inline editing).
- [ ] Column headers (Event, Customer, Salesperson, Event Date, Guests, Total, Created) sort the list; clicking again toggles direction; default is event date, newest first.
- [ ] Filters mirror Quotes/Leads: status chips, search (event/customer/venue/salesperson), and **Salesperson / Product / Event Type** dropdowns + an **event-date range**.
- [ ] Status pills use the shared tinted style (tentative=amber, confirmed=blue, in_progress=indigo, completed=green, cancelled=gray).

## Manual test cases

### TC1 — Table view
**Steps:** Open Events.
**Expected:** A table (not cards), matching the Quotes/Leads look, with a tinted status pill per row.

### TC2 — Row opens the event
**Steps:** Click a row.
**Expected:** Navigates to that event's page.

### TC3 — Sort
**Steps:** Click **Event**, then **Total**, then **Event Date**; click a header twice.
**Expected:** Rows reorder by that column; a second click flips ascending/descending (arrow shown).

### TC4 — Filter + search
**Steps:** Click a status chip (e.g. Confirmed); pick a Salesperson; type a customer/venue in search; set an event-date range.
**Expected:** The table narrows accordingly.

## Automated coverage
- Frontend: `app/events/page.test.tsx` (renders as a table; tinted pill; row-click navigation; search filter; sort-by-name).
