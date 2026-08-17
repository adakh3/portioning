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


def booking_menu_courses(booking, with_dietary=False):
    """Course-grouped menu — a list of ``{'name','items'}`` in course order (a trailing
    ``name=''`` group holds unassigned dishes), or ``None`` when the booking defines no
    courses (surfaces then fall back to the flat/category menu, course-less byte-
    identical). Shared by the presentation dict AND the event PDF (which bypasses
    presentation). Service style is booking-level, not per-course (REL-417).

    Dishes offered as a choice collapse into ONE line — ``Choice of: A / B / C``
    (REL-419 AC12–AC14) — so the contract reads the way a US catering contract reads:
    the client picks one, and the per-head price is the same either way. This is the
    single place that rendering exists, which is what keeps the sign page, both PDFs
    and the in-app pages saying the same thing.

    ``with_dietary`` appends each dish's dietary/allergen suffix ("Salmon (GF)"), as
    the flat menu already does. Opt-in, and off by default, so every existing surface
    renders exactly as before; the BEO turns it on because a kitchen reading the
    course order still has to see which plate is the gluten-free one (REL-444 AC4).
    """
    from events.models import resolve_booking_menu, choice_groups
    groups = resolve_booking_menu(booking)
    if not groups:
        return None
    if with_dietary:
        from dishes.labels import dietary_suffix
        from dishes.ordering import tags_for_dish_ids
        every_dish_id = [dish_id for group in groups for dish_id in group['dish_ids']]
        tags = tags_for_dish_ids(every_dish_id)
        groups = [
            {**g, 'dish_names': [name + dietary_suffix(tags.get(dish_id, []))
                                 for dish_id, name in zip(g['dish_ids'], g['dish_names'])]}
            for g in groups
        ]
    # Read the flags through `choice_groups`, never the raw rows: it is the one place
    # that decides a flag counts (plated, and the dish is in a course), so the contract
    # can't say "Choice of" about a booking the finals panel doesn't tally.
    offered = {
        dish_id for group in choice_groups(booking) for dish_id in group['dish_ids']
    }
    out = []
    for g in groups:
        pairs = list(zip(g['dish_ids'], g['dish_names']))
        chosen_ids = [dish_id for dish_id, _ in pairs if dish_id in offered]
        chosen_names = [name for dish_id, name in pairs if dish_id in offered]
        # One offered dish is not a choice — "Choice of: Filet Mignon" would be a
        # silly thing to put in a contract. The editor warns about it; here it simply
        # reads as the ordinary dish it is.
        if len(chosen_ids) < 2:
            chosen_ids = []
        items = []
        for dish_id, name in pairs:
            if dish_id not in offered or not chosen_ids:
                items.append(name)
            elif dish_id == chosen_ids[0]:
                # The choice line takes the position of the FIRST offered dish, so a
                # course listing a fixed item then a choice keeps its running order.
                # Keyed on the id, not the name — two dishes can share a name.
                items.append(f"Choice of: {' / '.join(chosen_names)}")
        # `course_id` lets a surface hang extra per-course content off the group —
        # the BEO's choice tallies (REL-444 AC7) — without re-resolving the menu or
        # matching on the name, which two courses are free to share.
        out.append({
            'course_id': g['course'].id if g['course'] else None,
            'name': g['course'].name if g['course'] else '',
            'items': items,
        })
    return out


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

    # Menu grouped by COURSE (Starter/Entrée/Dessert + service style) when the booking
    # defines courses; None otherwise so surfaces fall back to the flat/category menu
    # exactly as before (REL-417 AC4). Dishes keep add-order within a course.
    #
    # `course_id` is dropped here on purpose. This dict is served verbatim on the
    # UNAUTHENTICATED /b/<token> sign page, and a BookingCourse pk is an internal key
    # from a sequence shared across every org — nothing on that page consumes it, so
    # putting it on the wire for anyone holding a signing link buys nothing. The
    # in-process callers (the BEO) read it straight off `booking_menu_courses`.
    _courses = booking_menu_courses(booking)
    menu_courses = None if _courses is None else [
        {k: v for k, v in g.items() if k != 'course_id'} for g in _courses
    ]

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
    # `time_display` is set for EVERY row, deliberately (REL-447). It used to be
    # entries only, on the reasoning that a legacy slot's full ISO datetime could
    # just be rendered client-side — but the sign page did that with
    # `new Date(...).toLocaleString()`, which converts into the CUSTOMER's zone.
    # The API serves UTC and these are wall-clock times the caterer typed, so a
    # 19:00 meal read as 12:00 PM to a customer in Los Angeles, in the same list as
    # entries the server had already formatted in UTC: one list, two timezones, on
    # the document they are being asked to sign. A 02:00 late-night snack came out
    # as the previous evening. The server formats every row so no client converts.
    # `date` is set only for a step on a different day from the booking's own
    # (a load-in the afternoon before); `source` says where the row came from,
    # so a surface can mark the ones the timeline doesn't own.
    from bookings.services.timeline import booking_timeline, format_timeline_value
    timeline = [
        {
            'label': row.label,
            'time': _iso(row.value),
            'time_display': format_timeline_value(row.value, settings.time_format),
            'date': _iso(row.date),
            'source': row.source,
        }
        for row in booking_timeline(booking, {
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
        'menu_courses': menu_courses,  # course-grouped (REL-417) or None
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
        # AI Proposal Builder prose (REL-413): the client-facing sections when this
        # booking was AI-drafted; None otherwise so a hand-built quote/event renders
        # byte-identically to before. Only Quotes carry the field today.
        'proposal': getattr(booking, 'proposal_prose', None),
        'timeline': timeline,
        'signature': sig_block,
    }
