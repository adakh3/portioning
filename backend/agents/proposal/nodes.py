"""The nine proposal nodes. LLM nodes propose; deterministic nodes dispose.

Linear 1→2→3→4→5→6→7→8→9 with two controlled loops: the interrupt at 3, and the
conditional edge at 6 (validation errors & retry<2 → back to compose_menu with the
errors as feedback; retries exhausted → degrade, don't fail). All LLM calls go
through ``ask_structured`` (portioning/llm.py). Deterministic nodes own all money
and every catalog decision.
"""
import logging
from decimal import Decimal

from django.db import transaction

from agents.nodes import AskStructuredError, ask_structured
from agents.proposal import tools
from agents.proposal.schemas import MENU_PLAN_SCHEMA, PROSE_SCHEMA, QUESTIONS_SCHEMA

logger = logging.getLogger(__name__)

MAX_MENU_RETRIES = 2

# Canonical question ids for known event params — the LLM is told to use these so
# resolve_event_params can read answers by field. Anything else is free-form.
CANONICAL_FIELDS = ['event_date', 'headcount', 'service_style', 'occasion', 'meal_type',
                    'dietary_notes', 'budget_per_head']

_QUESTIONS_SYSTEM = (
    "You are a catering sales assistant. From a lead, produce 3-6 sharp clarifying "
    "questions a caterer must answer before you can draft a proposal. Pre-fill each "
    "question's `suggested` value with your best guess from the lead data; set "
    "`impact` to 'high' for anything that would change the menu or price. For known "
    "fields use these exact ids: " + ", ".join(CANONICAL_FIELDS) + ". Never invent an "
    "event date — if the lead has none, you MUST ask for it (id 'event_date'). Only "
    "ask what you genuinely need; do not pad to six."
)

_MENU_SYSTEM = (
    "You compose a catering menu for a proposal. Compose ONLY from the provided "
    "catalog digest — every template_id, tier_id, dish id and add-on variant id you "
    "return must appear in it; never invent items. Prefer the best-fitting menu "
    "template for the occasion and budget, then adjust dishes for dietary needs and "
    "variety, favouring higher-popularity dishes. Record every non-obvious choice you "
    "make as an assumption {field, value, reason}. Return the structured plan only."
)

_PROSE_SYSTEM = (
    "You write warm, professional US-catering proposal prose. Given the resolved "
    "event details and the chosen menu, write: an intro, a one-line description per "
    "menu section (keyed by section name), a 'what's included' list, a day-of outline, "
    "and a closing. Reference only the given details; never invent facts, prices, or "
    "dishes. Plain punctuation, no emoji."
)


# ── 1. load_context (deterministic) ──
def load_context(state):
    from users.models import Organisation
    from bookings.models import Lead

    org = Organisation.objects.get(pk=state['org_id'])
    lead = Lead.objects.for_org(org).filter(pk=state['lead_id']).first()
    if lead is None:
        return {'error': f"lead {state['lead_id']} not found for this org"}
    return {'context': {
        'lead': tools.get_lead_context(lead),
        'catalog': tools.get_catalog_digest(org),
    }}


# ── 2. generate_questions (LLM) ──
def generate_questions(state):
    ctx = state['context']
    try:
        data, _model, _attempts = ask_structured(
            task_setting='LLM_PROPOSAL_QUESTIONS',
            system=_QUESTIONS_SYSTEM,
            user_content=_json(ctx['lead']),
            schema=QUESTIONS_SCHEMA,
        )
    except AskStructuredError as exc:
        return {'error': f"generate_questions failed: {exc}"}

    questions = data['questions']
    # Deterministic guarantees: a missing date or headcount is always asked — both
    # are high-impact and both are DB-required on the resulting quote.
    if not ctx['lead'].get('event_date') and not any(q['id'] == 'event_date' for q in questions):
        questions.insert(0, {
            'id': 'event_date', 'text': 'What is the event date?',
            'kind': 'date', 'suggested': None, 'impact': 'high',
        })
    if not ctx['lead'].get('guest_estimate') and not any(q['id'] == 'headcount' for q in questions):
        questions.insert(0, {
            'id': 'headcount', 'text': 'How many guests are you expecting?',
            'kind': 'number', 'suggested': None, 'impact': 'high',
        })
    return {'questions': questions}


# ── 3. await_answers (interrupt) ──
def await_answers(state):
    from langgraph.types import interrupt

    # Resume payload is wrapped ({'answers': ...}) so it is never an empty dict —
    # LangGraph treats a falsy resume value as "no resume" and won't advance, which
    # would silently strand a run whose caterer accepted all suggestions unchanged.
    payload = interrupt({'questions': state['questions']})
    answers = (payload or {}).get('answers', {}) if isinstance(payload, dict) else {}
    return {'answers': answers}


# ── 4. resolve_event_params (deterministic) ──
def resolve_event_params(state):
    """Merge lead + answers by the decision hierarchy (answers win over lead).
    Low-impact defaults are recorded as assumptions, never guessed silently."""
    lead = state['context']['lead']
    answers = state.get('answers', {})
    assumptions = list(state.get('assumptions', []))

    def pick(field, lead_key=None, default=None, assume_reason=None):
        if answers.get(field) not in (None, ''):
            return answers[field]
        if lead_key and lead.get(lead_key) not in (None, ''):
            return lead[lead_key]
        if default is not None and assume_reason:
            assumptions.append({'field': field, 'value': str(default), 'reason': assume_reason})
        return default

    headcount = _as_int(pick('headcount', 'guest_estimate'))
    if not headcount:
        # DB requires guest_count >= 1 and pricing needs a number; fall back to 1
        # and flag it loudly rather than inventing a plausible-looking crowd.
        headcount = 1
        assumptions.append({'field': 'headcount', 'value': '1',
                            'reason': 'no headcount given; defaulted to 1 — please confirm'})
    params = {
        'occasion': pick('occasion', 'event_type'),
        'date': pick('event_date', 'event_date'),
        'headcount': headcount,
        'service_style': pick('service_style', 'service_style',
                              default='buffet', assume_reason='no service style stated; assumed buffet'),
        'meal_type': pick('meal_type', 'meal_type'),
        'dietary_notes': pick('dietary_notes') or lead.get('notes', ''),
        'budget_per_head': _as_decimal(answers.get('budget_per_head')),
    }
    return {'event_params': params, 'assumptions': assumptions}


# ── 5. compose_menu (LLM) ──
def compose_menu(state):
    ctx = state['context']
    params = state['event_params']
    validation = state.get('validation', {})
    feedback = ''
    if validation.get('errors'):
        feedback = (
            "\n\nYour previous plan had these problems — fix them, using only catalog "
            f"ids:\n- " + "\n- ".join(validation['errors'])
        )
    user = _json({'event_params': params, 'catalog': ctx['catalog']}) + feedback
    try:
        data, _model, _attempts = ask_structured(
            task_setting='LLM_PROPOSAL_MENU',
            system=_MENU_SYSTEM,
            user_content=user,
            schema=MENU_PLAN_SCHEMA,
        )
    except AskStructuredError as exc:
        return {'error': f"compose_menu failed: {exc}"}

    assumptions = list(state.get('assumptions', []))
    assumptions.extend(data.get('assumptions', []))
    return {'menu_plan': data, 'assumptions': assumptions}


# ── 6. validate_composition (deterministic) ──
def validate_composition(state):
    from users.models import Organisation

    org = Organisation.objects.get(pk=state['org_id'])
    params = state['event_params']
    result = tools.resolve_menu(org, state['menu_plan'])
    warnings = tools.check_feasibility(result['resolved'], params)
    warnings += tools.availability_check(org, params.get('date'))

    validation = dict(state.get('validation', {}))
    validation['errors'] = result['errors']
    validation['warnings'] = warnings
    validation['retry_count'] = validation.get('retry_count', 0)

    assumptions = list(state.get('assumptions', []))
    # If we've exhausted retries and still have errors, degrade: keep only the valid
    # (resolved) ids and record it — a partial menu beats no draft.
    degraded = bool(result['errors']) and validation['retry_count'] >= MAX_MENU_RETRIES
    if degraded:
        assumptions.append({
            'field': 'menu', 'value': 'stripped invalid items',
            'reason': 'the composer kept proposing items not in the catalog; kept only valid ones',
        })
    return {
        'validation': validation,
        '_resolved': _serialize_resolved(result['resolved']),
        'assumptions': assumptions,
    }


def route_after_validate(state):
    """Loop back to compose (with feedback) while there are errors and retries left;
    otherwise proceed to pricing (degrading on any residual errors)."""
    v = state.get('validation', {})
    if v.get('errors') and v.get('retry_count', 0) < MAX_MENU_RETRIES:
        return 'retry'
    return 'proceed'


def bump_retry(state):
    """Tiny node on the retry edge: increment the counter so the loop is bounded."""
    v = dict(state.get('validation', {}))
    v['retry_count'] = v.get('retry_count', 0) + 1
    return {'validation': v}


# ── 7. price_quote (deterministic) ──
def price_quote(state):
    from users.models import Organisation

    org = Organisation.objects.get(pk=state['org_id'])
    resolved = _deserialize_resolved(org, state['_resolved'])
    pricing = tools.price_quote(org, state['event_params'], resolved)

    assumptions = list(state.get('assumptions', []))
    if pricing.get('ppp_assumption'):
        assumptions.append(pricing['ppp_assumption'])
    return {'pricing': pricing, 'assumptions': assumptions}


# ── 8. write_prose (LLM) ──
def write_prose(state):
    params = state['event_params']
    section_names = [s['name'] for s in state['_resolved']['sections']]
    user = _json({
        'event_params': params,
        'menu_sections': section_names,
        'whats_included_hint': 'menu, service, setup',
    })
    try:
        data, _model, _attempts = ask_structured(
            task_setting='LLM_PROPOSAL_PROSE',
            system=_PROSE_SYSTEM,
            user_content=user,
            schema=PROSE_SCHEMA,
        )
    except AskStructuredError as exc:
        # Prose is not worth failing the whole draft — degrade to a minimal,
        # truthful stub the caterer can rewrite, and record it.
        logger.info("write_prose degraded: %s", exc)
        assumptions = list(state.get('assumptions', []))
        assumptions.append({'field': 'prose', 'value': 'minimal',
                            'reason': 'prose generation failed; left a stub to edit'})
        return {'prose': _stub_prose(params), 'assumptions': assumptions}
    return {'prose': data}


# ── 9. assemble_draft (deterministic) ──
def assemble_draft(state):
    """Create the draft Quote + add-on lines + prose, recompute totals, and ASSERT
    the persisted total matches what price_quote computed (parity guard)."""
    from users.models import Organisation
    from bookings.models import Lead, OrgSettings
    from bookings.models.quotes import Quote
    from bookings.models.addons import BookingLineItem
    from bookings.views.leads import _find_or_create_contact, _lead_company
    from bookings.services.subtotal_guard import validate_booking_totals

    org = Organisation.objects.get(pk=state['org_id'])
    lead = Lead.objects.for_org(org).get(pk=state['lead_id'])
    params = state['event_params']
    pricing = state['pricing']
    resolved = state['_resolved']
    s = OrgSettings.for_org(org)
    assumptions = list(state.get('assumptions') or [])

    # Quote requires a Contact and a non-null event_date. Reuse the same lead→
    # contact resolution the manual "create quote from lead" flow uses, and mirror
    # its event_date fallback (lead's created date) rather than inventing one —
    # recording the fallback as an assumption so the caterer sees it.
    company = _lead_company(lead)
    contact = _find_or_create_contact(
        org, lead.contact_name, lead.contact_email, lead.contact_phone, account=company,
    )
    event_date = params.get('date') or lead.event_date
    if not event_date:
        event_date = lead.created_at.date()
        assumptions.append({'field': 'event_date', 'value': event_date.isoformat(),
                            'reason': 'no event date given; used the lead date as a placeholder — please confirm'})

    with transaction.atomic():
        quote = Quote.objects.create(
            organisation=org,
            lead=lead,
            primary_contact=contact,
            is_b2b=bool(company),
            account=company,
            guest_count=pricing['guest_count'] or 1,
            price_per_head=Decimal(pricing['price_per_head']),
            event_type=params.get('occasion') or '',
            service_style=params.get('service_style') or '',
            event_date=event_date,
            based_on_template_id=resolved.get('template_id'),
            is_taxable=True,
            tax_rate=s.default_tax_rate,
            service_charge_pct=s.service_charge_default_pct,
            service_charge_taxable=s.service_charge_taxable_default,
            gratuity_pct=s.gratuity_default_pct,
            proposal_prose=state.get('prose') or {},
            proposal_assumptions=assumptions,
        )
        # Menu dishes (union across sections) so the menu renders; prose narrates.
        dish_ids = {d for sec in resolved['sections'] for d in sec['dish_ids']}
        if dish_ids:
            quote.dishes.set(list(dish_ids))
        for li in pricing['line_items']:
            BookingLineItem.objects.create(
                quote=quote,
                variant_id=li['variant_id'],
                category=li['category'],
                description=li['description'],
                quantity=Decimal(li['quantity']),
                unit=li['unit'],
                unit_price=Decimal(li['unit_price']),
                is_taxable=li['is_taxable'],
                line_total=Decimal(li['line_total']),
            )
        quote.recalculate_totals()
        validate_booking_totals(quote)

    # Parity guard: the totals engine on the persisted quote must equal the price
    # the agent computed. A divergence is a bug, not a soft warning.
    if quote.total != Decimal(pricing['total']):
        raise AssertionError(
            f"totals parity failed: quote.total={quote.total} != priced {pricing['total']}"
        )
    return {'quote_id': quote.id}


# ── helpers ──
def _json(obj):
    import json
    return json.dumps(obj, default=str)


def _as_int(v):
    try:
        return int(v) if v not in (None, '') else None
    except (ValueError, TypeError):
        return None


def _as_decimal(v):
    try:
        return str(Decimal(str(v))) if v not in (None, '') else None
    except Exception:
        return None


def _serialize_resolved(resolved):
    """Resolved carries ORM objects; store ids so the state stays JSON/checkpoint-safe."""
    return {
        'template_id': resolved['template'].id if resolved.get('template') else None,
        'tier_id': resolved['tier'].id if resolved.get('tier') else None,
        'sections': resolved['sections'],
        'addon_variant_ids': resolved['addon_variant_ids'],
    }


def _deserialize_resolved(org, data):
    from menus.models import MenuTemplate, MenuTemplatePriceTier

    template = MenuTemplate.objects.for_org(org).filter(pk=data.get('template_id')).first() \
        if data.get('template_id') else None
    tier = MenuTemplatePriceTier.objects.filter(
        pk=data.get('tier_id'), menu__organisation=org,
    ).first() if data.get('tier_id') else None
    return {
        'template': template, 'tier': tier,
        'sections': data['sections'], 'addon_variant_ids': data['addon_variant_ids'],
    }


def _stub_prose(params):
    occasion = params.get('occasion') or 'your event'
    return {
        'intro': f"Thank you for the opportunity to cater {occasion}.",
        'section_descriptions': {},
        'whats_included': ['Menu as listed', 'Service and setup'],
        'day_of_outline': 'We will confirm the run of show with you closer to the date.',
        'closing': 'We would be delighted to bring this event to life for you.',
    }
