"""Deterministic tools for the proposal agent — the LLM never does these jobs.

These are the guardrails that make an LLM safe around menus and money:

* ``get_lead_context`` / ``get_catalog_digest`` — load the ONLY facts the LLM may
  compose from (a dish/add-on not in the digest cannot be proposed),
* ``resolve_menu`` — the catalog-grounding check: every proposed id must exist and
  be active for this org, else it's an error the graph loops on,
* ``price_quote`` — all money, materialized via the same ``compute_booking_totals``
  engine quotes/events use; the LLM never emits a number,
* ``check_feasibility`` / ``availability_check`` — cheap sanity signals that become
  warnings on the draft, never blockers.

Everything is org-scoped: catalog reads go through the tenant managers' ``for_org``.
v1 scope note: meals (welcome drinks etc.) are narrated in the prose but not yet
persisted as priced ``BookingMeal`` rows — pricing is menu-per-head + add-on lines.
"""
from decimal import Decimal


def get_lead_context(lead):
    """Lead fields + a compact WhatsApp thread summary — one loader for the agent."""
    messages = list(
        lead.whatsapp_messages.order_by('created_at').values_list('direction', 'body')[:40]
    )
    thread_summary = "\n".join(f"[{d}] {b}" for d, b in messages if b)
    return {
        'lead_id': lead.id,
        'contact_name': lead.contact_name or '',
        'event_date': lead.event_date.isoformat() if lead.event_date else None,
        'guest_estimate': lead.guest_estimate,
        'budget': str(lead.budget) if lead.budget is not None else None,
        'event_type': lead.event_type or '',
        'meal_type': lead.meal_type or '',
        'service_style': lead.service_style or '',
        'notes': lead.notes or '',
        'thread_summary': thread_summary,
    }


def get_catalog_digest(org):
    """Templates (+ price tiers), dishes, and add-on variants as compact JSON —
    the closed world the LLM composes from. Ids here are the only legal references."""
    from menus.models import MenuTemplate
    from dishes.models import Dish
    from bookings.models.addons import AddOnVariant

    templates = []
    for t in MenuTemplate.objects.for_org(org).filter(is_active=True).prefetch_related('price_tiers'):
        templates.append({
            'id': t.id,
            'name': t.name,
            'menu_type': t.menu_type,
            'price_tiers': [
                {'id': pt.id, 'min_guests': pt.min_guests, 'price_per_head': str(pt.price_per_head)}
                for pt in t.price_tiers.all()
            ],
        })

    dishes = [
        {
            'id': d.id, 'name': d.name,
            'category': d.category.display_name if d.category_id else '',
            'is_vegetarian': d.is_vegetarian,
            'protein_type': d.protein_type,
            'popularity': d.popularity,
        }
        for d in Dish.objects.for_org(org).filter(is_active=True).select_related('category')
    ]

    addons = [
        {
            'variant_id': v.id,
            'name': str(v),
            'unit_price': str(v.effective_price),
            'unit': v.product.default_unit,
            'category': v.product.category,
        }
        for v in AddOnVariant.objects.for_org(org).filter(
            is_active=True, product__is_active=True,
        ).select_related('product')
    ]

    return {'menu_templates': templates, 'dishes': dishes, 'addons': addons}


def resolve_menu(org, menu_plan):
    """Validate every id in ``menu_plan`` against the org catalog. The
    catalog-grounding guardrail: returns ``{errors, resolved}`` — ``errors`` is a
    list of human-readable problems the graph loops on (retry ≤ 2, then degrade)."""
    from menus.models import MenuTemplate, MenuTemplatePriceTier
    from dishes.models import Dish
    from bookings.models.addons import AddOnVariant

    errors = []

    template = None
    if menu_plan.get('template_id') is not None:
        template = MenuTemplate.objects.for_org(org).filter(
            pk=menu_plan['template_id'], is_active=True,
        ).first()
        if template is None:
            errors.append(f"template_id {menu_plan['template_id']} is not a valid active template")

    tier = None
    if menu_plan.get('tier_id') is not None:
        tier = MenuTemplatePriceTier.objects.filter(
            pk=menu_plan['tier_id'], menu__organisation=org,
        ).first()
        if tier is None:
            errors.append(f"tier_id {menu_plan['tier_id']} is not a valid price tier")

    valid_dish_ids = set(
        Dish.objects.for_org(org).filter(is_active=True).values_list('id', flat=True)
    )
    resolved_sections = []
    for section in menu_plan.get('sections', []):
        good = [d for d in section.get('dish_ids', []) if d in valid_dish_ids]
        bad = [d for d in section.get('dish_ids', []) if d not in valid_dish_ids]
        if bad:
            errors.append(f"section {section.get('name')!r} references dishes not in catalog: {bad}")
        resolved_sections.append({'name': section.get('name', ''), 'dish_ids': good})

    valid_variant_ids = set(
        AddOnVariant.objects.for_org(org).filter(
            is_active=True, product__is_active=True,
        ).values_list('id', flat=True)
    )
    good_addons = [a for a in menu_plan.get('addon_variant_ids', []) if a in valid_variant_ids]
    bad_addons = [a for a in menu_plan.get('addon_variant_ids', []) if a not in valid_variant_ids]
    if bad_addons:
        errors.append(f"add-on variants not in catalog: {bad_addons}")

    resolved = {
        'template': template,
        'tier': tier,
        'sections': resolved_sections,
        'addon_variant_ids': good_addons,
    }
    return {'errors': errors, 'resolved': resolved}


def price_per_head_for(org, resolved, event_params):
    """Resolve the per-head price deterministically. Priority: an explicitly chosen
    tier → the best tier of the chosen template for the headcount → the org default.
    Returns ``(price, assumption_or_None)``."""
    guests = event_params.get('headcount') or 0
    if resolved.get('tier') is not None:
        return Decimal(resolved['tier'].price_per_head), None

    template = resolved.get('template')
    if template is not None:
        tiers = list(template.price_tiers.order_by('min_guests'))
        if tiers:
            # Highest tier whose threshold the headcount meets; else the smallest.
            eligible = [t for t in tiers if t.min_guests <= guests]
            chosen = eligible[-1] if eligible else tiers[0]
            return Decimal(chosen.price_per_head), {
                'field': 'price_per_head',
                'value': str(chosen.price_per_head),
                'reason': f"picked the {chosen.min_guests}+ pax tier of template {template.name!r}",
            }

    from bookings.models import OrgSettings
    default = OrgSettings.for_org(org).default_price_per_head
    return Decimal(default or 0), {
        'field': 'price_per_head',
        'value': str(default or 0),
        'reason': "no template/tier resolved — used the org default price per head",
    }


def line_total_for(unit, category, unit_price, quantity, guests):
    """Replicate ``BookingLineItem.save``'s line-total derivation exactly, so the
    price we compute equals the price the row will store: per-guest lines scale by
    headcount, discounts go negative, everything else is quantity × unit price."""
    from bookings.models.quotes import LineItemCategory, LineItemUnit

    if unit == LineItemUnit.PER_GUEST:
        return (unit_price * guests).quantize(Decimal('0.01'))
    if category == LineItemCategory.DISCOUNT:
        return -(abs(quantity * unit_price)).quantize(Decimal('0.01'))
    return (quantity * unit_price).quantize(Decimal('0.01'))


def price_quote(org, event_params, resolved):
    """Materialize all money via ``compute_booking_totals`` — replicating exactly
    what ``Quote.recalculate_totals`` (segment-priced food) and
    ``BookingLineItem.save`` (unit/discount-aware line totals) will do on assembly,
    so the persisted totals match the priced totals to the cent for every org
    config (per-guest add-ons, discounts, non-1.0 default segment multipliers)."""
    from bookings.models import OrgSettings
    from bookings.models.addons import AddOnVariant
    from bookings.services.totals import compute_booking_totals, segment_food_total
    from events.models import resolve_legacy_segments

    settings_obj = OrgSettings.for_org(org)
    guests = event_params.get('headcount') or 0
    ppp, ppp_assumption = price_per_head_for(org, resolved, event_params)
    # Food priced through the SAME segment resolver a freshly-assembled quote uses
    # (no gender split, no per-segment rows → whole headcount under the org's
    # default segment, honouring its price multiplier).
    segments = resolve_legacy_segments(org, guests, 0, 0, has_split=False)
    food_total = segment_food_total(ppp, segments)

    line_items = []
    variants = {
        v.id: v for v in AddOnVariant.objects.for_org(org).filter(
            id__in=resolved.get('addon_variant_ids', []),
        ).select_related('product')
    }
    for vid in resolved.get('addon_variant_ids', []):
        v = variants.get(vid)
        if v is None:
            continue
        unit_price = Decimal(v.effective_price)
        quantity = Decimal('1')  # v1: one of each proposed add-on
        line_total = line_total_for(
            v.product.default_unit, v.product.category, unit_price, quantity, guests,
        )
        line_items.append({
            'variant_id': v.id,
            'description': str(v),
            'category': v.product.category,
            'unit': v.product.default_unit,
            'unit_price': str(unit_price),
            'quantity': str(quantity),
            'is_taxable': v.product.is_taxable,
            'line_total': str(line_total),
        })

    rate = settings_obj.default_tax_rate
    totals = compute_booking_totals(
        food_total,
        [_LineTotal(Decimal(li['line_total'])) for li in line_items],
        rate,
        service_charge_pct=settings_obj.service_charge_default_pct,
        service_charge_taxable=settings_obj.service_charge_taxable_default,
        gratuity_pct=settings_obj.gratuity_default_pct,
    )

    return {
        'price_per_head': str(ppp),
        'guest_count': guests,
        'food_total': str(food_total),
        'subtotal': str(totals.subtotal),
        'service_charge': str(totals.service_charge),
        'tax_amount': str(totals.tax_amount),
        'gratuity': str(totals.gratuity),
        'total': str(totals.total),
        'line_items': line_items,
        'ppp_assumption': ppp_assumption,
    }


class _LineTotal:
    """Minimal stand-in for a line item — compute_booking_totals reads .line_total."""
    def __init__(self, line_total):
        self.line_total = line_total


def check_feasibility(resolved, event_params):
    """Cheap portioning-engine-adjacent sanity → warnings (never blockers)."""
    warnings = []
    total_dishes = sum(len(s.get('dish_ids', [])) for s in resolved.get('sections', []))
    if total_dishes == 0:
        warnings.append("no catalog dishes were selected for the menu")
    if not event_params.get('headcount'):
        warnings.append("no headcount resolved — pricing used 0 guests")
    return warnings


def availability_check(org, date_iso):
    """Existing events on the date → a trust warning for the caterer."""
    if not date_iso:
        return []
    from events.models import Event
    clash = Event.objects.for_org(org).filter(event_date=date_iso).exists()
    return [f"there is already an event booked on {date_iso}"] if clash else []
