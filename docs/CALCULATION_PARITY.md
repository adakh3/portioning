# Calculation Parity — keeping the frontend mirror honest

Booking totals (food + add-on line items + tax → subtotal / tax / total) are
computed in **two** places by design:

- **Backend — the source of truth.** `backend/bookings/services/totals.py`
  (`compute_booking_totals`), called by `Quote.recalculate_totals` and
  `Event.recalculate_totals`. The stored `subtotal` / `tax_amount` / `total` are
  **read-only** on the serializers, and `create`/`update` always recompute, so
  whatever the client sends is ignored — the server number is authoritative.
- **Frontend — a live preview mirror.** `frontend/lib/quoteTotals.ts`
  (`computeBookingTotals` / `computeQuoteTotals` / `lineItemTotal`), used only to
  show totals updating as you type. On save the backend recomputes; in view mode
  the page shows the backend's stored values.

This is the standard pattern for "updates as you type" totals (carts, invoicing
tools). The one risk is **drift**: two implementations of one rule, in two
languages. This doc is how we stop that.

## The canonical rule (one definition of the math)

- **food_total** = price/head × guests, **plus** any additional meals
  (events only; the caller sums meals in before calling the engine).
- **subtotal** = food_total + every add-on line item (taxable and non-taxable;
  discounts are negative lines).
- **taxable base** = food_total + **taxable** line items only.
- **tax** = taxable_base × tax_rate, rounded to 2 dp.
  (Quotes use the quote's `tax_rate`; events use `tax_rate` when `is_taxable`,
  else 0.)
- **total** = subtotal + tax.

Line-item totals: `per_guest` = unit_price × guest_count; `discount` =
−|qty × unit_price|; everything else (`each`, `flat`, `per_hour`) = qty × unit_price.

## How parity is enforced — the golden-cases file

`docs/calculation-golden-cases.json` is a **shared, language-neutral spec**:
each case lists `food_total`, line items (precomputed `line_total` + `is_taxable`),
`tax_rate`, and the `expected` subtotal/tax/total.

- The **backend** runs it through `compute_booking_totals` —
  `bookings/test_totals.py::TestGoldenCaseParity`.
- The **frontend** runs the *same file* through `computeBookingTotals` —
  `lib/quoteTotals.test.ts` → `describe("golden-case parity with the backend engine")`.

Because both engines are pinned to the same expected numbers, you cannot change
the rule on one side without that side's test failing against the shared spec.

## The contract — when you touch totals math

Any change to the totals rule must update **all of these together**, or a test
will fail:

1. `backend/bookings/services/totals.py` (the source of truth).
2. `frontend/lib/quoteTotals.ts` (the mirror).
3. `docs/calculation-golden-cases.json` (add/adjust the expected numbers).
4. `PORTIONING_LOGIC.md` if the change also affects portioning (per CLAUDE.md).

Add a new golden case for any new behaviour (new unit type, new tax handling,
etc.) so both engines are proven to agree on it.

## Not mirrored

The **portioning engine** (`backend/calculator/engine/`, grams per dish per
guest) is backend-only — there is no frontend copy, so no parity concern. The
frontend just renders what the engine returns.
