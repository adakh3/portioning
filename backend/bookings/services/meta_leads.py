"""Turn Meta lead-ad submissions into CRM leads (REL-507).

Two entry points share one mapping/dedup path:
* ``ingest_from_webhook`` — called inline from the webhook with the change value
  (fetches the answers from the Graph API by leadgen id).
* ``backfill_all`` — the hourly cron sweep; lists each connected Page's forms and
  their submissions and ingests anything we don't already have (the 90-day
  retention safety net for anything the webhook missed).

Idempotency is keyed on ``Lead.meta_leadgen_id``; dedup against an existing open
lead is by normalized email/phone.
"""

import logging
from datetime import datetime

from django.db import IntegrityError, transaction
from django.db.models import Q

from bookings.activity import log_activity
from bookings.models import ConnectedMetaPage, Lead, MetaIngestedLead
from bookings.phones import normalize_phone
from bookings.services import meta
from bookings.services.leads import default_status_for, terminal_statuses_for

logger = logging.getLogger(__name__)

# Lead-form answer keys we map to structured Lead fields; everything else is
# appended to notes verbatim (structured extraction is REL-509, not here).
_STANDARD_KEYS = {'full_name', 'first_name', 'last_name', 'email', 'phone_number'}


def ingest_from_webhook(page: ConnectedMetaPage, value: dict):
    """Handle one `leadgen` webhook change value for a connected Page."""
    leadgen_id = str(value.get('leadgen_id') or '')
    if not leadgen_id:
        return None
    return ingest_lead(page, leadgen_id)


def ingest_lead(page: ConnectedMetaPage, leadgen_id: str):
    """Fetch a single submission by id and create/dedup a Lead."""
    # Cheap pre-check to skip the Graph round trip on an obvious retry; the
    # atomic guard in _build_lead is what actually enforces idempotency.
    if MetaIngestedLead.objects.for_org(page.organisation).filter(leadgen_id=leadgen_id).exists():
        return None
    raw = meta.fetch_lead(leadgen_id, page.page_access_token)
    lead, _created = _build_lead(page, raw)
    return lead


def backfill_page(page: ConnectedMetaPage) -> int:
    """Ingest every not-yet-seen submission across a Page's forms. Returns the
    number of new Leads created."""
    created = 0
    for form_id in meta.list_lead_forms(page.page_id, page.page_access_token):
        for raw in meta.list_form_leads(form_id, page.page_access_token):
            _lead, was_created = _build_lead(page, raw)
            if was_created:
                created += 1
    return created


def backfill_all() -> int:
    """Sweep every connected Page across all orgs (cron entry point)."""
    total = 0
    # unscoped: the cron runs platform-wide, not within one org's request.
    for page in ConnectedMetaPage.objects.unscoped().select_related('organisation'):
        try:
            total += backfill_page(page)
        except Exception as exc:
            logger.warning('Meta lead backfill failed for page %s: %s', page.page_id, exc)
    return total


# ── mapping + dedup ──

def _build_lead(page: ConnectedMetaPage, raw: dict):
    """Create a Lead from a raw Graph lead object, or dedup. Returns (lead, created).

    The (org, leadgen_id) ledger row is the idempotency primitive: claiming it
    atomically means the very first delivery wins and every retry / backfill
    re-sighting / concurrent race is skipped — covering the merge path too, so
    the backfill never re-logs a duplicate activity.
    """
    org = page.organisation
    leadgen_id = str(raw.get('id') or '')

    try:
        with transaction.atomic():
            ref = MetaIngestedLead.objects.create(organisation=org, leadgen_id=leadgen_id)
    except IntegrityError:
        return None, False  # already ingested (retry / backfill overlap / race)

    answers = _answers(raw.get('field_data'))
    first = answers.pop('first_name', '')
    last = answers.pop('last_name', '')
    full = answers.pop('full_name', '') or ' '.join(p for p in (first, last) if p)
    email = answers.pop('email', '').strip()
    phone = answers.pop('phone_number', '')

    # Any remaining answers (event date, guest count, …) go to notes verbatim.
    extras = [f'{_label(k)}: {v}' for k, v in answers.items() if v]
    notes = 'From Meta lead form.'
    if extras:
        notes += '\n\n' + '\n'.join(extras)

    dup = _find_open_duplicate(org, email, phone)
    if dup is not None:
        log_activity(
            dup, 'updated',
            description='New Meta lead-form submission received for this contact.',
        )
        ref.lead = dup
        ref.save(update_fields=['lead'])
        return dup, False

    lead = Lead(
        organisation=org,
        contact_name=full,
        contact_first_name=first,
        contact_last_name=last,
        contact_email=email,
        contact_phone=phone,
        source=_source_for(raw.get('platform')),
        lead_date=_parse_created_date(raw.get('created_time')),
        notes=notes,
        meta_leadgen_id=leadgen_id,
    )
    default = default_status_for(org)
    if default:
        lead.status = default
    lead.save()
    ref.lead = lead
    ref.save(update_fields=['lead'])
    log_activity(lead, 'created', description=f'Created lead "{lead.contact_name}" from a Meta lead form')
    return lead, True


def _answers(field_data) -> dict:
    """Flatten Meta's [{'name','values':[...]}] into {name: first_value}."""
    out = {}
    for field in field_data or []:
        name = (field.get('name') or '').strip().lower()
        values = field.get('values') or []
        if name:
            out[name] = (values[0] if values else '') or ''
    return out


def _label(key: str) -> str:
    return key.replace('_', ' ').strip().capitalize()


def _source_for(platform) -> str:
    """Meta's `platform` is 'ig' for Instagram lead ads, 'fb' otherwise."""
    return 'instagram' if str(platform or '').lower() == 'ig' else 'facebook'


def _parse_created_date(created_time):
    """Meta timestamps look like '2026-08-16T10:00:00+0000'."""
    if not created_time:
        return None
    try:
        return datetime.fromisoformat(str(created_time).replace('+0000', '+00:00')).date()
    except ValueError:
        return None


def _find_open_duplicate(org, email, phone):
    """An existing non-closed lead in the org matching email or phone, or None."""
    if not (email or phone):
        return None
    cond = Q()
    if email:
        cond |= Q(contact_email__iexact=email.strip())
    normalized = normalize_phone(phone, org.country) if phone else ''
    if normalized:
        cond |= Q(contact_phone=normalized)
    if not cond:
        return None
    return (
        Lead.objects.for_org(org)
        .exclude(status__in=terminal_statuses_for(org))
        .filter(cond)
        .order_by('-created_at')
        .first()
    )
