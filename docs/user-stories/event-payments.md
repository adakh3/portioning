# Event client payments (advances / part / full)

> Record client payments against a **booking (event)** and track paid-vs-owed.
> This is operational settlement tracking — money the client has already paid
> (cash, bank transfer, etc.). It is **not** the SaaS subscription billing
> (`payments` app — the org paying the platform), and **not** a formal
> accounting/invoicing ledger (see `bookings.finance` Invoice/Payment).

## User story
As a **catering team member**, I want to record the advance and balance payments
a client makes against their event, and see how much is still owed, so we know a
booking is secured without needing a separate accounting system.

## Acceptance criteria
- [ ] Each event tracks its **payments** (a new `events.EventPayment` model FK'd to
      the event). Recording one logs **amount, payment date, method** (cash / bank
      transfer / card / cheque / other), **received by** (any org user), and an
      optional **reference** + **notes**.
- [ ] The event exposes read-only **`amount_paid`** (Σ payments), **`balance_due`**
      (`total − amount_paid`), and **`payment_status`** (`unpaid` / `partial` /
      `paid`). These do NOT change the event's price (no `recalculate_totals`).
- [ ] Payments are **org-scoped via the event** — you cannot record against or list
      another org's event's payments.
- [ ] **received_by** defaults to the current user when omitted, but can be set to
      any org user. It's `SET_NULL` — deleting a user keeps the payment record.
- [ ] The event page shows a **Payments** section (after Pricing): a balance summary
      (total / paid / balance + status pill), a **Record payment** form, and a table
      of payments with a delete action. Recording/deleting refreshes the balance.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/events/<id>/payments/` | List an event's payments (org-scoped) |
| POST | `/api/events/<id>/payments/` | Record a payment |
| GET/PATCH/DELETE | `/api/events/<id>/payments/<pk>/` | Retrieve / edit / delete a payment |

Balance fields (`amount_paid`, `balance_due`, `payment_status`, nested `payments`)
also come back on `GET /api/events/<id>/`.

## Manual test cases

### TC1 — Record an advance (partial)
**Steps:** Open a £1,000 event → Payments → Record payment → £500, today, Bank
Transfer, received-by = me → Save.
**Expected:** Row appears; summary shows Paid £500, Balance £500, pill "Part paid".

### TC2 — Record the balance (paid)
**Steps:** Record a second £500 payment.
**Expected:** Paid £1,000, Balance £0, pill "Paid".

### TC3 — Delete a payment restores balance
**Steps:** Delete one of the payments.
**Expected:** Paid/Balance recompute; status returns to "Part paid" (or "Unpaid").

### TC4 — received-by
**Steps:** Record a payment leaving received-by as "—".
**Expected:** Saved with received-by defaulting to the logged-in user. Setting it to
another team member records that user instead.

### TC5 — Org isolation
**Steps:** As org A, try `POST /api/events/<B's event id>/payments/`.
**Expected:** Rejected / not found; no payment created. Listing B's event payments
returns nothing.

## Not in scope
- Online card collection from the client (Stripe Connect / pay links).
- Formal tax invoices, receipts as legal documents, or an accounting ledger.
- A receipt PDF (possible phase 2 — a simple acknowledgement, not a tax invoice).

## Where it lives
- Backend: `events/models.py` (`EventPayment`, Event balance props),
  `events/serializers.py` (`EventPaymentSerializer` + fields on `EventSerializer`),
  `events/views.py` (`EventPaymentListCreateView` / `EventPaymentDetailView`),
  `events/urls.py`. Tests: `events/test_payments.py`.
- Frontend: `components/EventPaymentsCard.tsx` (+ test), wired into
  `app/events/[id]/page.tsx`; API in `lib/api.ts` (`EventPayment` type +
  `getEventPayments` / `createEventPayment` / `deleteEventPayment`).
