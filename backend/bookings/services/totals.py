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
    service_charge: Decimal
    tax_base: Decimal
    tax_amount: Decimal
    gratuity: Decimal
    total: Decimal


def compute_booking_totals(food_total, line_items, tax_rate,
                           service_charge_pct=0, service_charge_taxable=True,
                           gratuity_pct=0):
    """Compute booking totals: subtotal → service charge → tax → gratuity → total.

    - ``food_total``: Decimal — the food/menu cost (e.g. price_per_head × guests).
    - ``line_items``: iterable of objects each with ``.line_total`` (Decimal, already
      signed — discounts are negative).
    - ``tax_rate``: Decimal fraction (0.20 = 20%).
    - ``service_charge_pct`` / ``gratuity_pct``: **percentages** (20 = 20%), applied
      to the subtotal.
    - ``service_charge_taxable``: whether the service charge is added to the tax base.

    Pipeline: subtotal = food + items (discounts negative); service charge on the
    subtotal; tax on subtotal + (service charge if taxable); gratuity on the subtotal,
    **always post-tax and never taxed**; total = subtotal + service charge + tax +
    gratuity. Tax applies to the whole subtotal (no per-line split); the tax on/off
    decision lives at the caller (Quote passes its tax_rate; Event passes it only when
    taxable).

    All-percentages-zero reduces **exactly** to the pre-service-charge math
    (service_charge = gratuity = 0, tax_base = subtotal), which keeps every existing
    booking's stored totals unchanged.
    """
    food_total = Decimal(food_total or 0)
    tax_rate = Decimal(tax_rate or 0)
    service_charge_pct = Decimal(service_charge_pct or 0)
    gratuity_pct = Decimal(gratuity_pct or 0)

    items_total = sum((Decimal(item.line_total or 0) for item in line_items), Decimal('0.00'))
    subtotal = food_total + items_total
    service_charge = (subtotal * service_charge_pct / 100).quantize(TWO_PLACES)
    tax_base = subtotal + (service_charge if service_charge_taxable else Decimal('0.00'))
    tax_amount = (tax_base * tax_rate).quantize(TWO_PLACES)
    gratuity = (subtotal * gratuity_pct / 100).quantize(TWO_PLACES)
    total = subtotal + service_charge + tax_amount + gratuity

    return BookingTotals(
        # The taxable/non-taxable split is gone — everything in the subtotal is taxed.
        # Fields kept (taxable_subtotal == subtotal) so existing callers don't break.
        taxable_subtotal=subtotal,
        non_taxable_subtotal=Decimal('0.00'),
        subtotal=subtotal,
        service_charge=service_charge,
        tax_base=tax_base,
        tax_amount=tax_amount,
        gratuity=gratuity,
        total=total,
    )
