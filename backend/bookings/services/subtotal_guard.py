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

from decimal import InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import DecimalValidator
from django.db import DataError
from rest_framework.exceptions import ValidationError

# Every stored money field on a booking. Each is DecimalField(12, 2), so the
# largest storable amount is 9,999,999,999.99.
MONEY_FIELDS = ('subtotal', 'service_charge', 'tax_amount', 'gratuity', 'total')

# The arithmetic that blows up when a booking is too big to store.
OVERFLOW_ERRORS = (InvalidOperation, DjangoValidationError, DataError)


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


def reject_unstorable_totals(booking):
    """Raise DRF ValidationError (→ 400) when a total is too large for its column.

    The per-field validators each pass on their own but say nothing about their
    product: ``price_per_head`` may be up to 9,999,999.99 and ``guest_count`` up to
    50,000, which multiply out to ~500 billion — three digits more than the
    DecimalField(12, 2) that has to hold it. The booking then failed deep in the
    save with a raw ``decimal.InvalidOperation`` and the client got a 500. The
    numbers are absurd, but "absurd" should read back as a validation message, not
    a crash.
    """
    too_big = []
    for name in MONEY_FIELDS:
        value = getattr(booking, name, None)
        if value is None:
            continue
        field = booking._meta.get_field(name)
        try:
            DecimalValidator(field.max_digits, field.decimal_places)(value)
        except DjangoValidationError:
            too_big.append(name)
    if too_big:
        raise ValidationError({
            'guest_count': [
                'This booking is too large to store: its '
                f'{", ".join(too_big)} exceeded the maximum of 9,999,999,999.99. '
                'Reduce the guest count or the price per head.'
            ]
        })


def validate_booking_totals(booking):
    """The whole post-recalculate check: storable, and worth at least nothing."""
    reject_unstorable_totals(booking)
    reject_negative_subtotal(booking)


# Largest amount each column can hold. The booking's money fields are
# DecimalField(12, 2); a line item's ``line_total`` is only DecimalField(10, 2),
# so a per-guest line overflows two orders of magnitude sooner than the booking
# it belongs to — which is exactly the case that crashed.
MAX_STORABLE = Decimal('9999999999.99')
MAX_LINE_TOTAL = Decimal('99999999.99')


def reject_unstorable_inputs(guest_count, price_per_head, line_items):
    """Reject a payload whose food cost cannot fit, **before** anything is written.

    The post-recalculate guard above can't catch every route, because
    ``BookingLineItem.save()`` recalculates the parent booking itself — so an
    over-large per-guest line blew up mid-write, before the serializer got its
    turn. Checking the inputs up front means no partial write happens at all.

    Conservative on purpose: it only rejects a product that already exceeds the
    column on its own, so a legitimate booking can never be blocked by it.
    """
    guests = Decimal(guest_count or 0)
    if guests <= 0:
        return

    def check(amount, ceiling, field, label):
        if amount > ceiling:
            raise ValidationError({field: [
                f'{label} works out to {amount:,.2f}, which is larger than the '
                f'maximum that can be stored ({ceiling:,}). Reduce the guest '
                'count or the price.'
            ]})

    if price_per_head:
        check(Decimal(price_per_head) * guests, MAX_STORABLE, 'price_per_head',
              'Price per head x guest count')

    for item in line_items or []:
        if (item.get('unit') or '') != 'per_guest':
            continue
        unit_price = item.get('unit_price')
        if unit_price in (None, ''):
            continue
        check(Decimal(str(unit_price)) * guests, MAX_LINE_TOTAL, 'line_items',
              f'The per-guest item "{item.get("description") or ""}" x guest count')
