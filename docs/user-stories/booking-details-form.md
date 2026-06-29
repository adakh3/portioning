# Shared booking-details form (Quote + Event editors)

## User story
As a sales user, I want the customer/venue/event-type fields to look and behave
the same whether I'm editing a **quote** or an **event**, so the two screens feel
like one product and there's only one place for that UI to drift or break.

## Background
Quotes and events share a booking *core* but stay separate records (a quote is a
pre-sale doc; an event is operational). The two editors hand-rendered the same
booking-detail fields in **three** places (quote create, quote edit, event edit)
with two different state shapes. Those are now one controlled component,
`frontend/components/BookingDetailsForm.tsx`.

The form owns only the unambiguously shared fields — **customer** (+ B2B
business), **venue**, **event type / meal type / service style**, **booking
date**, and (optionally) **notes**. It deliberately does **not** own the totals
inputs (price-per-head, guest count, tax) or the menu — those stay in each parent
— which guarantees this refactor cannot change totals math.

## Acceptance criteria
- [ ] Quote create, quote edit, and event edit all render the shared fields via `BookingDetailsForm` (no duplicated JSX).
- [ ] Editing any shared field on a **quote** still saves through `buildQuoteSavePayload` (quote keeps its `guest_count`, `valid_until`, etc.).
- [ ] Editing any shared field on an **event** still saves through `handleSaveAll`, and the event's **gents/ladies split** and **big_eaters** are untouched (they never pass through the form).
- [ ] The B2B toggle shows/hides the business select; venue offers the customer-address prefill.
- [ ] Totals are unchanged by editing these fields (no change to `backend/bookings/services/totals.py`, `frontend/lib/quoteTotals.ts`, or `docs/calculation-golden-cases.json`).

## Manual test cases

### TC1 — Quote round-trip
**Steps:** Quotes → open a quote → Edit → change customer, venue, event type, meal type, service style, booking date → Save → reopen.
**Expected:** All values persisted; the quote **total is unchanged** by these edits.

### TC2 — Event round-trip (counts preserved)
**Steps:** Events → open an event → Edit → change the same fields → Save → reopen.
**Expected:** Values persisted; **gents/ladies and big_eaters still correct**; event **total unchanged**.

### TC3 — B2B toggle
**Steps:** On either editor, toggle "Business booking (B2B)".
**Expected:** The Business select appears when on and is required; clearing B2B drops it.

### TC4 — New quote
**Steps:** Quotes → New Quote → fill the shared fields + Event Date + guest count → Save.
**Expected:** Quote created with the entered details; Event Date remains required.

## Automated coverage
- Frontend: `components/BookingDetailsForm.test.tsx` (renders shared fields; field→patch onChange; `contact` mapping; B2B gating; `showNotes`; `eventDateSlot`).
- Regression: the full Vitest suite (quote/event editors) stays green — the extraction is behavior-preserving.
