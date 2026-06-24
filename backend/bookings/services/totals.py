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

    - ``food_total``: Decimal — the taxable food/menu cost (e.g. price_per_head × guests).
    - ``line_items``: iterable of objects each with ``.is_taxable`` (bool) and ``.line_total``
      (Decimal, already signed — discounts are negative).
    - ``tax_rate``: Decimal fraction (0.20 = 20%).

    Tax applies to food **plus taxable line items** only; non-taxable items are added to the
    subtotal but never taxed.
    """
    food_total = Decimal(food_total or 0)
    tax_rate = Decimal(tax_rate or 0)

    taxable = Decimal('0.00')
    non_taxable = Decimal('0.00')
    for item in line_items:
        amount = Decimal(item.line_total or 0)
        if item.is_taxable:
            taxable += amount
        else:
            non_taxable += amount

    taxable += food_total  # food/menu cost is taxable
    subtotal = taxable + non_taxable
    tax_amount = (taxable * tax_rate).quantize(TWO_PLACES)
    total = subtotal + tax_amount

    return BookingTotals(
        taxable_subtotal=taxable,
        non_taxable_subtotal=non_taxable,
        subtotal=subtotal,
        tax_amount=tax_amount,
        total=total,
    )
