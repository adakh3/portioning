"""Single source of truth for booking totals — used by BOTH quotes and events.

Do not re-implement this math anywhere else (serializers, views, models): call
`compute_booking_totals`. See docs/CODE_MAINTENANCE.md.
"""
from dataclasses import dataclass
from decimal import Decimal

TWO_PLACES = Decimal('0.01')


@dataclass(frozen=True)
class BookingTotals:
    taxable_subtotal: Decimal
    non_taxable_subtotal: Decimal
    subtotal: Decimal
    tax_amount: Decimal
    total: Decimal


def compute_booking_totals(food_total, line_items, tax_rate):
    """Compute (subtotal, tax_amount, total) for a booking.

    - ``food_total``: Decimal — the food/menu cost (e.g. price_per_head × guests).
    - ``line_items``: iterable of objects each with ``.line_total`` (Decimal, already
      signed — discounts are negative).
    - ``tax_rate``: Decimal fraction (0.20 = 20%).

    Tax applies to the **whole subtotal** (food + all line items). A discount is a
    negative line, so it reduces the subtotal before tax (tax lands on the net).
    The tax on/off decision lives at the caller (Quote passes its tax_rate; Event
    passes tax_rate only when is_taxable).
    """
    food_total = Decimal(food_total or 0)
    tax_rate = Decimal(tax_rate or 0)

    items_total = sum((Decimal(item.line_total or 0) for item in line_items), Decimal('0.00'))
    subtotal = food_total + items_total
    tax_amount = (subtotal * tax_rate).quantize(TWO_PLACES)
    total = subtotal + tax_amount

    return BookingTotals(
        # The taxable/non-taxable split is gone — everything in the subtotal is taxed.
        # Fields kept (taxable_subtotal == subtotal) so existing callers don't break.
        taxable_subtotal=subtotal,
        non_taxable_subtotal=Decimal('0.00'),
        subtotal=subtotal,
        tax_amount=tax_amount,
        total=total,
    )
