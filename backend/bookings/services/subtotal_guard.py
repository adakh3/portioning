"""Refuse to store a booking whose subtotal has gone negative.

A discount line item was never bounded by the value of the thing being
discounted, so a $100,000 discount on a $5,000 quote stored a -$95,000 subtotal
and a -$114,000 total — and rendered a perfectly normal PDF with a negative
GRAND TOTAL that could be sent to a client.

Two separate defects came out of that; this file is the second half of the fix:

* the percentage charges are no longer taken on a negative subtotal
  (``charge_base`` in ``totals.py`` / ``chargeBase`` in ``lib/quoteTotals.ts``),
  which stops the service charge flipping sign and compounding the error;
* and a save that would leave the booking worth less than nothing is rejected
  here, rather than persisted.

Checked against the **computed** subtotal rather than re-deriving one from the
payload, so it accounts for segment pricing, per-guest units and every other
input without duplicating the engine. The caller runs it inside the same
transaction as the write, so a rejection rolls the whole save back.

Deliberately NOT enforced inside ``recalculate_totals``: a booking already
stored with a negative subtotal would then be impossible to edit back to
sanity — the guard belongs at the API boundary, not on every recalculation.
"""
from decimal import Decimal

from rest_framework.exceptions import ValidationError


def reject_negative_subtotal(booking):
    """Raise DRF ValidationError (→ 400) when ``booking.subtotal`` is below zero.

    Call after ``recalculate_totals()``, inside the save's transaction.
    """
    subtotal = booking.subtotal or Decimal('0.00')
    if subtotal < 0:
        raise ValidationError({
            'line_items': [
                'The discounts on this booking are larger than everything they '
                f'discount, leaving a subtotal of {subtotal}. Reduce the discount '
                'so the booking is worth at least zero.'
            ]
        })
