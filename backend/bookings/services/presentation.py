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
    from dishes.ordering import dish_names_in_added_order

    org = booking.organisation
    settings = OrgSettings.for_org(org)
    is_quote = booking.__class__.__name__ == 'Quote'

    # Guests: total + optional gents/ladies split
    gents, ladies = booking.gents or 0, booking.ladies or 0
    guest_count = getattr(booking, 'guest_count', None) or (gents + ladies)

    # Menu — grouped by course/category (rich structure; PDF flattens, HTML groups),
    # plus the flat added-order list the PDF's 2-column table uses verbatim.
    groups = {}
    for dish in booking.dishes.all():
        cat = dish.category
        groups.setdefault((cat.display_order, cat.display_name), []).append(dish.name)
    menu = [{'category': name, 'items': sorted(items)} for (_o, name), items in sorted(groups.items())]
    menu_flat = dish_names_in_added_order(booking)

    additional_meals = [
        {
            'label': m.label,
            'guest_count': m.guest_count,
            'price_per_head': str(m.price_per_head) if m.price_per_head else None,
            'items': sorted(d.name for d in m.dishes.all()),
        }
        for m in booking.additional_meals.all()
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

    # Timeline — labelled moments in the order they run.
    timeline = [
        {'label': label, 'time': _iso(getattr(booking, field, None))}
        for label, field in (
            ('Setup', 'setup_time'), ('Guest arrival', 'guest_arrival_time'),
            ('Meal service', 'meal_time'), ('End', 'end_time'),
        )
        if getattr(booking, field, None)
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
