"""The bridge between a stored booking and the pure pricing engine.

`services/totals.py` is deliberately ORM-free — it takes plain data and returns
numbers. This module is the one place that knows how to turn a `Quote` or an
`Event` into that plain data, and how to store the answer back.

It exists so the two models stop carrying a copy each. `Quote.recalculate_totals`
and `Event.recalculate_totals` were the same twenty lines twice, as were their
`food_total` properties — and duplicated money math is how a quote and the event it
became end up disagreeing (REL-463).
"""
from decimal import Decimal

from bookings.services.totals import PricingInput, price_booking

# Written by `store_pricing_result` on every recalculate. Everything else about a
# booking's money is derived from these, never typed.
STORED_MONEY_FIELDS = ('subtotal', 'service_charge', 'tax_amount', 'gratuity', 'total')


def pricing_input_for(booking, line_items=None):
    """Assemble the engine's input from a booking (quote XOR event).

    Pass ``line_items=()`` when only the food matters — it skips the line-item query
    entirely, which is why `food_total_for` below is no more expensive than the hand
    -rolled property it replaced.

    `tax_rate` is resolved to the EFFECTIVE rate here (0 when the booking isn't
    taxable), keeping that decision on this side of the boundary — the engine is
    handed a number, not a policy.
    """
    from events.models import resolve_booking_segments

    if line_items is None:
        line_items = [
            {'category': li.category, 'unit': li.unit, 'quantity': li.quantity,
             'unit_price': li.unit_price, 'description': li.description,
             'sort_order': li.sort_order}
            for li in booking.line_items.all()
        ]

    return PricingInput(
        price_per_head=booking.price_per_head,
        guest_count=booking.guest_count or 0,
        segments=tuple(resolve_booking_segments(booking)),
        meals=tuple(
            {'label': m.label, 'price_per_head': m.price_per_head,
             'guest_count': m.guest_count}
            for m in booking.additional_meals.all()
        ),
        line_items=tuple(line_items),
        tax_rate=(booking.tax_rate if booking.is_taxable else Decimal('0')) or Decimal('0'),
        service_charge_pct=booking.service_charge_pct,
        service_charge_taxable=booking.service_charge_taxable,
        gratuity_pct=booking.gratuity_pct,
    )


def food_total_for(booking):
    """The booking's food cost — menu priced per segment, plus additional meals."""
    return price_booking(pricing_input_for(booking, line_items=())).food['food_total']


def price_and_store(booking, extra_update_fields=()):
    """Recompute a booking's money through the engine and persist it.

    Order matters and is load-bearing:

    1. drop any prefetch cache — a caller may have loaded this booking with
       `prefetch_related('line_items')`, and that cache predates rows added in the
       same save, so the stored subtotal would silently drop the just-added add-ons;
    2. sync audience-scoped meal counts (dual-write) before anything is priced;
    3. re-derive `per_guest` line totals from the CURRENT guest count — `line_total`
       is a stored column, and a PATCH that moved `guest_count` without resending
       `line_items` would otherwise be priced off the old count (REL-462 Bug 4);
    4. price, then store.

    Returns the `PricingResult`, so a caller that also wants the itemized rows (the
    preview endpoint, the documents) doesn't have to price the booking twice.
    """
    from bookings.models.addons import BookingLineItem
    from events.models import sync_audience_meal_counts

    for rel in ('line_items', 'additional_meals'):
        getattr(booking, '_prefetched_objects_cache', {}).pop(rel, None)
    sync_audience_meal_counts(booking)
    refreshed = BookingLineItem.refreshed_for(booking)

    result = price_booking(pricing_input_for(booking, line_items=[
        {'category': li.category, 'unit': li.unit, 'quantity': li.quantity,
         'unit_price': li.unit_price, 'description': li.description,
         'sort_order': li.sort_order}
        for li in refreshed
    ]))

    store_pricing_result(booking, result, extra_update_fields=extra_update_fields)
    return result


def store_pricing_result(booking, result, extra_update_fields=()):
    """Write the engine's answer onto the booking. The ONLY writer of these five."""
    totals = result.totals
    booking.subtotal = totals['subtotal']
    booking.service_charge = totals['service_charge']
    booking.tax_amount = totals['tax_amount']
    booking.gratuity = totals['gratuity']
    booking.total = totals['total']
    booking.save(update_fields=list(STORED_MONEY_FIELDS) + list(extra_update_fields))
