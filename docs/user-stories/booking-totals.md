# Booking totals — one shared engine (quotes + events)

## User story
As a user, I want quote **and** event totals to add up **everything** — food/menu,
additional meals, all add-on items, and tax — using the **same calculation**, so the
number never silently regresses or differs between screens.

## Background
Quote and event totals were computed in different places (quote model vs. an inline
client-side calc on the event page) with **different rules** (the event page taxed the
whole subtotal at the org rate and included additional meals; the quote engine taxed only
food + taxable items). That divergence is what kept regressing.

Now there is **one engine**: `bookings/services/totals.py` `compute_booking_totals(food_total,
line_items, tax_rate)`. Both `Quote.recalculate_totals` and `Event.recalculate_totals` call it.
The event page no longer re-implements the math — in view mode it shows the server's stored
totals; while editing it shows a live preview using the **same rule** (tax on food + meals +
taxable items only).

## The rule (single source of truth)
- **Subtotal** = food (price/head × guests) + additional meals + all add-on line items.
- **Taxable base** = food + meals + **taxable** add-on items only (non-taxable items are in the
  subtotal but never taxed).
- **Tax** = taxable_base × tax_rate (events: the org's default rate when `is_taxable`; quotes: the
  quote's tax_rate). Discounts are negative line items and reduce the subtotal/taxable base.
- **Total** = subtotal + tax. Everything rounds to 2 dp.

## Acceptance criteria
- [ ] A quote's total = food + every add-on item + tax (tax on food + taxable items only).
- [ ] An event's total = food + additional meals + every add-on item + tax — computed by the **same** engine; events store `subtotal`/`tax_amount`/`total`.
- [ ] The event page shows the **server** total when viewing; the editing preview matches the engine's rule.
- [ ] Converting a won lead/quote to an event carries the pricing so the event total matches.
- [ ] A deposit invoice created from an event uses the event's real total (not 0.00).

## Manual test cases

### TC1 — Quote total
**Steps:** Open a quote with a per-head price, some taxable and non-taxable add-ons, and a discount.
**Expected:** Total = food + all items + tax, where tax applies to food + taxable items only; the discount reduces it.

### TC2 — Event total incl. meals
**Steps:** Open an event with a main per-head price, an additional meal, and add-on items.
**Expected:** Total includes the main food, the meal, and the add-ons (+ tax if taxable). Editing the items updates the preview; saving stores the same number you see when viewing.

### TC3 — Conversion
**Steps:** Win a lead with a quote → create the event.
**Expected:** The event's total matches the quote's (same food + items + tax).

### TC4 — Invoice
**Steps:** Create a deposit invoice from an event.
**Expected:** The invoice's subtotal/tax/total reflect the event's real totals, not zeros.

## Automated coverage
- Backend: `bookings/test_totals.py` — the engine (food/items/taxable-vs-non-taxable/discount/rounding/zero), Quote integration, Event integration (incl. additional meals, non-taxable events).
