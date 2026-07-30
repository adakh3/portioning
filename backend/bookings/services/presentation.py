"""Single source of truth for how a booking is *presented* to a client.

`booking_presentation(booking, signature=None)` assembles the canonical, customer-
safe content of a quote/event — resolved choice labels, all the dates, the guest
split, the menu grouped by course, additional meals, line items, totals, timeline,
notes, terms, and the acceptance/signature block. It never exposes internal notes
or costs.

Every client-facing surface renders FROM this one function so they can never
diverge on which fields exist or their values:
  - the /b/<token> HTML sign page (via serialize_public_booking), and
  - the quote PDF (generate_quote_pdf).
Each surface still owns its own visual layout (A4 print vs mobile web); this owns
the *content*. Add a field here and both surfaces can show it.
"""
from decimal import Decimal


def _choice_label(model, value, org):
    """Resolve a choice value to its org label, falling back to the raw value."""
    if not value:
        return ''
    return (model.objects.filter(value=value, organisation=org)
            .values_list('label', flat=True).first() or value)


def _iso(dt):
    return dt.isoformat() if dt else None


def booking_presentation(booking, signature=None):
    from bookings.models import OrgSettings
    from bookings.models.choices import EventTypeOption, ServiceStyleOption, MealTypeOption
    from dishes.labels import dietary_suffix
    from dishes.ordering import dish_display_names_in_added_order, tags_for_dish_ids

    org = booking.organisation
    settings = OrgSettings.for_org(org)
    is_quote = booking.__class__.__name__ == 'Quote'

    # Guests: total + optional gents/ladies split
    gents, ladies = booking.gents or 0, booking.ladies or 0
    guest_count = getattr(booking, 'guest_count', None) or (gents + ladies)

    # Itemized food lines per guest segment (kids/vendors) when multi-rate, else
    # None so the surface shows the single food line. Same helper the PDFs use.
    from bookings.services.totals import segment_food_rows
    from events.models import resolve_booking_segments
    _rows = segment_food_rows(booking.price_per_head, resolve_booking_segments(booking))
    food_rows = [
        {'name': r['name'], 'count': r['count'], 'rate': str(r['rate']), 'amount': str(r['amount'])}
        for r in _rows
    ] if _rows else None

    # Menu — grouped by course/category (rich structure; PDF flattens, HTML groups),
    # plus the flat added-order list the PDF's 2-column table uses verbatim.
    # Dish names carry their dietary/allergen suffix ("Chicken Tikka (GF; contains
    # milk)") — untagged dishes are just their name, so untagged menus are
    # unchanged. Tags are fetched once for the whole menu, never per dish.
    booking_dishes = list(booking.dishes.all())
    meals = list(booking.additional_meals.all())
    meal_dishes = {m.pk: list(m.dishes.all()) for m in meals}
    all_dish_ids = [d.pk for d in booking_dishes]
    for dishes in meal_dishes.values():
        all_dish_ids.extend(d.pk for d in dishes)
    tags_by_dish = tags_for_dish_ids(all_dish_ids)

    def _display(dish):
        return dish.name + dietary_suffix(tags_by_dish.get(dish.pk, []))

    groups = {}
    for dish in booking_dishes:
        cat = dish.category
        groups.setdefault((cat.display_order, cat.display_name), []).append(_display(dish))
    menu = [{'category': name, 'items': sorted(items)} for (_o, name), items in sorted(groups.items())]
    menu_flat = dish_display_names_in_added_order(booking)

    additional_meals = [
        {
            'label': m.label,
            'guest_count': m.guest_count,
            'price_per_head': str(m.price_per_head) if m.price_per_head else None,
            'items': sorted(_display(d) for d in meal_dishes[m.pk]),
        }
        for m in meals
    ]

    line_items = [
        {
            'description': li.description,
            'category': li.get_category_display(),
            'quantity': str(li.quantity),
            'unit': li.get_unit_display(),
            'unit_price': str(li.unit_price),
            'line_total': str(li.line_total),
            'is_discount': li.category == 'discount',
        }
        for li in booking.line_items.all()
    ]

    # Timeline — labelled moments in the order they run. The booking's own
    # entries when it has any, else the four legacy slots (see services/timeline).
    # `time_display` is set only for entries: they carry a bare time, which a
    # client can't parse as a date, so the server formats it. Legacy slots keep
    # `time_display: None` and their full ISO datetime, so surfaces render them
    # exactly as they always have.
    from bookings.services.timeline import booking_timeline, format_timeline_value
    timeline = [
        {
            'label': label,
            'time': _iso(value),
            'time_display': (None if hasattr(value, 'date')
                             else format_timeline_value(value, settings.time_format)),
        }
        for label, value in booking_timeline(booking, {
            'setup_time': 'Setup', 'guest_arrival_time': 'Guest arrival',
            'meal_time': 'Meal service', 'end_time': 'End',
        })
    ]

    contact = booking.primary_contact
    account = booking.account if booking.account_id else None

    sig_block = None
    if signature is not None:
        sig_block = {
            'signer_name': signature.signer_name,
            'signed_at': _iso(signature.signed_at),
            'ip_address': signature.ip_address,
            'signature_image': signature.signature_image or '',
        }

    return {
        'kind': 'quote' if is_quote else 'event',
        'reference': f"{'Quote' if is_quote else 'Event'} #{booking.pk}",
        'ref_code': f"Q-{booking.pk}" if is_quote else f"E-{booking.pk}",
        'customer_id': str(booking.primary_contact_id or booking.account_id or booking.pk),
        # Business (caterer) + currency/tax config
        'business_name': org.name,
        'currency_symbol': settings.currency_symbol,
        'currency_code': settings.currency_code,
        'tax_label': settings.tax_label or 'Tax',
        'terms': settings.quotation_terms or '',
        # Customer (the person signing) + optional business account
        'customer_name': (contact.name if contact else (account.name if account else None)),
        'contact_phone': contact.phone if contact else '',
        'contact_email': contact.email if contact else '',
        'account_name': account.name if account else None,
        # Where + when
        'venue_name': booking.venue.name if booking.venue_id else None,
        'venue_address': booking.venue_address or '',
        'event_date': _iso(booking.event_date),
        'quote_date': _iso(getattr(booking, 'created_at', None)),
        'booking_date': _iso(getattr(booking, 'booking_date', None)),
        'valid_until': _iso(getattr(booking, 'valid_until', None)),
        # Guests
        'guest_count': guest_count,
        'gents': gents,
        'ladies': ladies,
        # Type / style — raw value + resolved label (surfaces should show the label)
        'event_type': booking.event_type or '',
        'event_type_label': _choice_label(EventTypeOption, booking.event_type, org),
        'meal_type': booking.meal_type or '',
        'meal_type_label': _choice_label(MealTypeOption, booking.meal_type, org),
        'service_style': booking.service_style or '',
        'service_style_label': _choice_label(ServiceStyleOption, booking.service_style, org),
        # Food
        'menu': menu,
        'menu_flat': menu_flat,
        'additional_meals': additional_meals,
        'line_items': line_items,
        'price_per_head': str(booking.price_per_head) if booking.price_per_head else None,
        'food_rows': food_rows,
        # Money
        'subtotal': str(booking.subtotal),
        'service_charge_pct': str(booking.service_charge_pct),
        'service_charge': str(booking.service_charge),
        'service_charge_taxable': booking.service_charge_taxable,
        'tax_rate': str(booking.tax_rate),
        'tax_amount': str(booking.tax_amount),
        'gratuity_pct': str(booking.gratuity_pct),
        'gratuity': str(booking.gratuity),
        'total': str(booking.total),
        # Extras
        'notes': booking.notes or '',
        'timeline': timeline,
        'signature': sig_block,
    }
