# Quotes list — table view

## User story
As a sales user, I want the Quotes list as a **sortable table keyed by customer**
(not a stack of cards keyed by quote number), so I can scan and compare quotes quickly
and find them by the person they're for.

## Background
The list was card-based with "Quote #N vV" as the headline — the numeric quote id isn't
a useful primary identifier. Replaced with a Leads-style table; the quote number moves to
a secondary muted column. Quotes are loaded in full, so search/sort are client-side.

## Acceptance criteria
- [ ] Quotes render in a table with columns: **Customer**, **Salesperson** (who created it), Event Date, Guests, Total, Created, Status (tinted pill), and a muted **Quote** (#id · vN) reference.
- [ ] Clicking a row opens that quote. The table is read-only (no inline editing).
- [ ] Column headers (Customer, Salesperson, Event Date, Guests, Total, Created) sort the list; clicking again toggles direction; default is newest-created first.
- [ ] Filters mirror the Leads page (where applicable): status chips, search (customer/venue/salesperson/#), and **Salesperson / Product / Event Type** dropdowns + an **event-date range**. Styling matches the Leads table.

## Manual test cases

### TC1 — Table view
**Steps:** Open Quotes.
**Expected:** A table (not cards); each row shows the customer name first, with the quote number as a small grey reference.

### TC2 — Row opens the quote
**Steps:** Click a row.
**Expected:** Navigates to that quote's page.

### TC3 — Sort
**Steps:** Click **Customer**, then **Total**, then **Event Date**; click a header twice.
**Expected:** Rows reorder by that column; a second click flips ascending/descending (arrow shown).

### TC4 — Filter + search
**Steps:** Click a status chip (e.g. Draft); type a customer name / venue / quote number in search.
**Expected:** The table narrows accordingly.

## Automated coverage
- Frontend: `app/quotes/page.test.tsx` (renders by customer; row-click navigation; sort-by-customer).
