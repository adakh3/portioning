"""Accepting a quote is the moment a booking is confirmed: it creates the real,
confirmed Event (menu, kitchen portions, add-ons, totals) and wins the linked
lead. This lives here — not in a view — so every path that accepts a quote
produces an identical event: the staff transition endpoint AND the client-facing
e-signature endpoint both call `accept_quote`.
"""
from bookings.models.quotes import QuoteStatus


def accept_quote(quote, user=None):
    """Move `quote` to ACCEPTED and return its confirmed Event.

    Creates the event (copying menu, recomputing kitchen portions and totals,
    carrying add-on line items) on first acceptance and auto-wins the linked
    lead. Idempotent: a quote already accepted with an event just returns that
    event. Raises ValueError if the quote cannot transition to ACCEPTED.
    """
    if quote.status != QuoteStatus.ACCEPTED:
        quote.transition_to(QuoteStatus.ACCEPTED)  # sets accepted_at, saves

    if quote.event:
        return quote.event

    from events.models import Event, EventDishComment
    from calculator.engine.calculator import calculate_portions
    from bookings.views.quotes import _copy_line_items_to_event, _copy_additional_meals_to_event

    who = quote.account.name if quote.account_id else (
        quote.primary_contact.name if quote.primary_contact_id else 'Event')
    # guest_count is the number on both sides; the gents/ladies split only carries
    # when the quote has a real one (it adds up) — never fabricate a split the
    # customer didn't give us.
    gents, ladies = quote.gents, quote.ladies
    if gents + ladies != quote.guest_count:
        gents = ladies = 0
    notes = quote.notes
    if quote.internal_notes:
        notes = (f"{notes}\n\n" if notes else "") + \
            f"Internal notes (from quote):\n{quote.internal_notes}"
    event = Event.objects.create(
        name=f"{who} — {quote.event_type}",
        event_date=quote.event_date,
        guest_count=quote.guest_count,
        gents=gents,
        ladies=ladies,
        big_eaters=quote.big_eaters,
        big_eaters_percentage=quote.big_eaters_percentage,
        account=quote.account,
        is_b2b=quote.is_b2b,
        primary_contact=quote.primary_contact,
        venue=quote.venue,
        venue_address=quote.venue_address,
        event_type=quote.event_type,
        meal_type=quote.meal_type,
        service_style=quote.service_style,
        booking_date=quote.booking_date or (quote.accepted_at.date() if quote.accepted_at else None),
        price_per_head=quote.price_per_head,
        tax_rate=quote.tax_rate or 0,
        is_taxable=quote.is_taxable and bool(quote.tax_rate and quote.tax_rate > 0),
        setup_time=quote.setup_time,
        guest_arrival_time=quote.guest_arrival_time,
        meal_time=quote.meal_time,
        end_time=quote.end_time,
        notes=notes,
        status='confirmed',
        product=quote.product,
        based_on_template=quote.based_on_template,
        created_by=user,
        # Credit the deal owner (the quote/lead's salesperson) for sales
        # targets; fall back to whoever accepted the quote.
        assigned_to=quote.assigned_to or (quote.lead.assigned_to if quote.lead_id else None) or user,
        organisation=quote.organisation,
    )

    # Copy menu (dishes) from quote to event + auto-calculate kitchen portions
    if quote.dishes.exists():
        event.dishes.set(quote.dishes.all())
        result = calculate_portions(
            dish_ids=list(event.dishes.values_list('id', flat=True)),
            guests=event.portioning_guests(),
            org=quote.organisation,
        )
        for p in result['portions']:
            EventDishComment.objects.create(
                event=event,
                dish_id=p['dish_id'],
                portion_grams=p['grams_per_person'],
            )

    # Carry the add-on line items and additional meals across, then recompute via
    # the shared engine so the event total matches the quote (food-only included).
    _copy_line_items_to_event(quote, event)
    _copy_additional_meals_to_event(quote, event)
    event.recalculate_totals()

    quote.event = event
    quote.save(update_fields=['event', 'updated_at'])

    # Auto-win the lead if it exists and isn't already won
    if quote.lead and quote.lead.status != 'won':
        from bookings.activity import log_activity
        old_status = quote.lead.status
        quote.lead.won_event = event
        quote.lead.won_quote = quote
        quote.lead.transition_to('won')
        log_activity(
            quote.lead, 'status_change',
            field_name='status', old_value=old_status, new_value='won',
            description=f"Auto-marked as Won via quote acceptance (Quote #{quote.id})",
        )

    return event
