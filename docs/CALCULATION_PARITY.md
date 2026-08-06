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

- **food_total** = the per-head menu cost across the guest **segments**, **plus**
  any additional meals (the caller sums meals in before calling the engine; both
  quotes and events). Segment food = Σ over all segments of `rate × count`, where
  the per-cover **rate = round(price/head × segment.price_multiplier)** to cents —
  in-count segments (Adults, Kids) and additional covers (Vendors) alike;
  `counts_toward_total` only governs count validation/display, never price. Rounding
  **per cover** (not once on the aggregate) lets the itemized food lines sum
  **exactly** to the subtotal. Backend: `totals.py: segment_food_total` /
  `segment_effective_rate`; frontend mirror: `quoteTotals.ts: segmentFood` /
  `segmentFoodFromRows` / `segmentEffectiveRate`. With **no** breakdown the whole
  guest count sits under the org's default segment (multiplier 1.0), so this reduces
  **exactly** to `price/head × guests` — existing bookings, and Gents/Ladies orgs
  (both multipliers 1.0), keep byte-identical food totals. The shared
  `segment_food_cases` in the golden file assert this in both engines.

  **Per-segment override.** A booking may set a flat per-head rate on a segment
  (`BookingGuestCount.price_per_head`). When present it **replaces** the
  multiplier calculation for that segment: `rate = round(override)`. The org's
  default in-count segment (Adults) never honours one — it always uses the base
  price/head — guarded on the write path, not just in the UI.

  **Unusable input: fall back, never free** (REL-449). A rate is money, so neither
  engine may return `NaN`, `Infinity`, or a negative, and neither may quietly turn a
  bad value into a discount:

  | Situation | Result |
  |---|---|
  | override unusable (junk, negative, out of range) | **ignored** — segment reverts to its multiplier |
  | multiplier unusable | reverts to **1.0** — full price |
  | base price/head unusable | treated as 0 |
  | override of exactly `0` | **honoured** — a deliberately comped segment |

  Flooring an unusable value to zero would turn a config error into a silent
  discount, which is the failure a caterer never spots — hence "never free". The one
  thing always refused is a negative, which would pay the customer to attend.

  **One spelling of a number.** `Decimal` and JS `Number` accept different
  languages, and every disagreement is money one engine charges and the other
  doesn't: `Decimal` takes `"1_000"` and Unicode digits (`"١٢٣"`, `"５"`), while
  `Number` turns `"  "`, `false` and `[]` into `0`. Both engines therefore accept
  only one plain spelling — `RATE_RE` in `totals.py` (imported by the API validator
  `events.models.parse_segment_rate`) and its mirror in `quoteTotals.ts`. The API
  also **quantizes to cents HALF_UP before storing**, because the column is
  `decimal_places=2` and Django rounds HALF_EVEN on write — without it, `12.345`
  previewed as `12.35` and saved as `12.34`.

  **Itemized display** (`segment_food_rows` / `segmentFoodRows`) shows one line per
  segment (`Name — count × rate = amount`) on the totals card, both PDFs, and the
  sign page — but **only when segments have more than one distinct rate**. A
  count-only booking or a Gents/Ladies org (single shared rate) keeps the single
  `price/head × guests = total` line, so those surfaces stay byte-identical.
- **subtotal** = food_total + every add-on line item (discounts are negative
  lines, so they reduce the subtotal).
- **charge_base** = `max(subtotal, 0)` — the base for the two percentage charges
  below. A discount larger than everything it discounts used to drive the
  subtotal negative, which flipped the service charge and gratuity negative too
  and *compounded* the error (a −95,000 subtotal produced a −19,000 "service
  charge"). A charge on nothing is nothing. Such a save is also **rejected** at
  the API (`bookings/services/subtotal_guard.py`), so a negative subtotal should
  only ever be a transient live-preview state.
- **service_charge** = charge_base × `service_charge_pct` / 100, rounded to 2 dp
  (a percentage, e.g. 20). US orgs default to 20%; others to 0.
- **tax** = **tax_base** × tax_rate, rounded to 2 dp, where
  **tax_base** = subtotal + (service_charge if `service_charge_taxable` else 0).
  Tax applies to the whole subtotal (no per-line split); quotes use the quote's
  `tax_rate`, events use it when `is_taxable`, else 0.
- **gratuity** = charge_base × `gratuity_pct` / 100, rounded to 2 dp — **always
  post-tax and never taxed**.
- **total** = subtotal + service_charge + tax + gratuity.

  All percentages zero reduces **exactly** to `subtotal → tax → total`, so every
  existing booking's stored totals are unchanged (a named golden case + the
  legacy-org snapshot gate prove it).

Line-item totals: `per_guest` = unit_price × guest_count; `discount` =
−|qty × unit_price|; everything else (`each`, `flat`, `per_hour`) = qty × unit_price.
Branch **order** is part of the contract: `per_guest` is tested *before* `discount`,
so a per-guest line in the discount category prices as a positive per-head charge.

**The engine owns this math** (`line_item_total` in `totals.py`, mirrored by
`lineItemTotal`). `BookingLineItem.save` calls it rather than carrying its own copy —
two copies of one rule is how the two engines drifted in the first place.

**Rounded to 2 dp HALF_UP**, like every other money value here — via
`round2` in `totals.py` and `round2` in `quoteTotals.ts`. A bare
`.quantize(Decimal('0.01'))` is HALF_EVEN and silently disagreed with the live
preview on an exact half-cent: 1.50 × $0.03 stored `$0.04` while the screen showed
`$0.05` (REL-462). The `discount` branch rounds the **magnitude** and applies the
sign afterwards, on both sides — rounding −42.425 half-up would give −42.42 and
quietly shrink the discount.

`per_guest` lines are **re-derived from the booking's current guest count on every
recalculate**, not read back from storage: `line_total` is a stored column, and a
PATCH that moved `guest_count` without resending `line_items` used to leave the line
priced at the old count.

## How parity is enforced — the golden-cases file

`docs/calculation-golden-cases.json` is a **shared, language-neutral spec**:
each case lists `food_total`, line items (precomputed signed `line_total`),
`tax_rate`, and the `expected` subtotal/tax/total.

- The **backend** runs it through `compute_booking_totals` —
  `bookings/test_totals.py::TestGoldenCaseParity`.
- The **frontend** runs the *same file* through `computeBookingTotals` —
  `lib/quoteTotals.test.ts` → `describe("golden-case parity with the backend engine")`.

The file carries four more shared sections, mirrored the same way:

- `segment_food_cases` — per-segment food (REL-415).
- `meal_audience_cases` — an additional meal's guest count derived from its audience
  (everyone / guests only / a single segment), through `derive_meal_guest_count` and
  `deriveMealCountFromRows` (REL-426).
- `line_item_cases` — every unit (`per_guest`, `per_hour`, `flat`, `each`) × discount
  and non-discount, including the half-cent boundaries and the branch-order case,
  through `line_item_total` and `lineItemTotal` (REL-463). **This was the biggest
  parity gap**: the `cases` loop feeds precomputed line totals as flat qty-1 lines,
  so `per_guest`, `per_hour` and the discount sign had never been compared at all.
- `itemized_rows_cases` — the per-segment display rows and their null-collapse,
  through `segment_food_rows` and `segmentFoodRowsFromRows` (REL-463). The frontend's
  `segmentFoodRows` takes UI state, so the `…FromRows` variant is the one that mirrors
  the backend signature; the UI-state wrapper delegates to it.

Comparisons are **exact** on both sides — string-formatted cents, no tolerance.
`toBeCloseTo(…, 2)` permits sub-half-cent drift, which is precisely where a float
artifact hides.

Because both engines are pinned to the same expected numbers, you cannot change
the rule on one side without that side's test failing against the shared spec.

## The engine's front door

`price_booking(PricingInput) -> PricingResult` (`bookings/services/totals.py`) computes
**every** number a surface prints — itemized food rows, meal rows, per-line totals,
add-ons subtotal, subtotal, service charge, `pre_tax_total`, tax base, tax, gratuity,
total — from raw inputs. No caller does arithmetic of its own.

`bookings/services/booking_pricing.py` is the ORM bridge: it turns a `Quote` or an
`Event` into that plain input and stores the result. Both models' `recalculate_totals`
are one call to it, so a quote and the event it becomes cannot compute differently.

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
