# Code Maintenance

How we keep this codebase healthy without ever needing a "cleanup sprint" (which never comes).

## The Boy Scout rule (the one discipline we actually follow)

> **Any file or function you touch to make a change, you also clean up before committing.**

Not the whole codebase — **only what you touched**. Leave each file a little better than you
found it. In practice this means, for the code you're already editing:

- Remove dead code, unused imports/vars, commented-out blocks.
- Fix the obvious: a confusing name, a duplicated 3 lines, a misleading comment, a magic number.
- Tighten types / add the missing small test for the thing you just changed.
- Don't expand scope: if a cleanup balloons beyond the function you touched, stop and file a
  follow-up (Linear) instead of refactoring half the app in a feature PR.

This is the only refactoring discipline that compounds without a dedicated effort.

## Single source of truth for calculations

Money/portion math must live in **one place** and be reused everywhere — never re-implemented
per screen or per model. If two features compute "the same number," they call the same function.

- **Booking totals** (food + add-on line items + tax) → `bookings/services/totals.py`
  (`compute_booking_totals`). Used by **both** quotes and events. Do **not** sum totals inline
  in a serializer/view/model — call the engine.
- **Portioning** → `calculator/engine/` (pure, no ORM).

When you change a calculation, change the engine and its tests — nowhere else.

## Tests for anything that adds up money

Calculations regress silently. Every money/total calculation must have unit tests covering the
**combinations**, not just the happy path:

- food only; line items only; both together
- taxable vs non-taxable items (tax applies only to taxable + food)
- discounts (negative lines) and per-guest pricing
- rounding to 2 dp
- zero / empty cases

If you touch a calculation and there's no test for the case you changed, add it (Boy Scout rule).

## Where things live (quick map)

- Tenancy/permissions: `users/` (`mixins.py`, `permissions` in `bookings/permissions.py`).
- Org settings & choice options: `bookings/models/settings.py`, `bookings/models/choices.py`.
- Booking line items (shared by quotes & events): `bookings/models/addons.py` (`BookingLineItem`).
- User stories + manual test cases: `docs/user-stories/`.
