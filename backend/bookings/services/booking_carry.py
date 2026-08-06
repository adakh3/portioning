"""The one answer to "what must an event inherit from the quote it came from?".

Two paths turn a quote into an event — accepting the quote
(`services/quote_acceptance.py`) and winning a lead (`views/leads.py`) — and they
drifted. Acceptance carried the whole pricing snapshot; lead conversion carried
only `price_per_head`/`tax_rate`, so an event won through the lead board recomputed
at 0% service charge and 0% gratuity and came out BELOW the price the customer was
quoted — by the entire service charge, 20% for a US org on default settings
(REL-462 Bug 1). Lead conversion also dropped the additional meals and the
per-segment guest breakdown, which under-bills again and re-prices the food.

Both paths now go through here, so a third conversion path cannot reintroduce it by
forgetting a field: add the field once, in `pricing_core_fields`, and every path
gets it.
"""

# Set on the event at CREATE time. Rows that need the event to exist first are
# carried by `carry_pricing_rows` below.
_NO_QUOTE_DEFAULTS = {
    'price_per_head': None,
    'tax_rate': 0,
    'is_taxable': False,
    'service_charge_pct': 0,
    'service_charge_taxable': True,
    'gratuity_pct': 0,
}


def pricing_core_fields(quote):
    """Every pricing INPUT an event must be created with to price like its quote.

    Pass ``None`` for a lead converted with no quote behind it: the event is created
    unpriced, exactly as before, rather than inheriting a phantom rate.

    `is_taxable` is deliberately re-derived rather than copied: a quote flagged
    taxable with no rate would otherwise make the event claim tax it can't compute.
    """
    if quote is None:
        return dict(_NO_QUOTE_DEFAULTS)
    return {
        'price_per_head': quote.price_per_head,
        'tax_rate': quote.tax_rate or 0,
        'is_taxable': bool(quote.is_taxable and quote.tax_rate and quote.tax_rate > 0),
        'service_charge_pct': quote.service_charge_pct or 0,
        'service_charge_taxable': quote.service_charge_taxable,
        'gratuity_pct': quote.gratuity_pct or 0,
    }


def carry_pricing_rows(quote, event):
    """Copy the priced ROWS that decide what the event costs: the per-segment guest
    breakdown, then the additional meals.

    Call BEFORE `event.recalculate_totals()` and before portioning — kitchen
    portions, segment-priced food and audience-scoped meals all resolve from the
    segment rows, so an event missing them collapses to the default segment and
    silently re-prices the food (REL-426).

    No-ops when `quote` is None. Safe to call once per conversion; it creates rows
    rather than reconciling them, so don't call it twice on the same event.
    """
    if quote is None:
        return

    from events.models import BookingGuestCount
    for row in quote.guest_counts.all():
        BookingGuestCount.objects.create(
            event=event, segment=row.segment, count=row.count,
            price_per_head=row.price_per_head,
        )

    from bookings.views.quotes import _copy_additional_meals_to_event
    _copy_additional_meals_to_event(quote, event)
