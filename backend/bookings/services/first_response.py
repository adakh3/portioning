"""Speed-to-lead: draft an AI first response the moment a new lead arrives (REL-515).

The highest-leverage message we send is the first one, and with Meta lead-ads
ingestion (REL-507) leads land around the clock with nobody watching. This module
drafts that first reply into the SAME approve-and-send queue as follow-ups
(a `FollowUpDraft` with `kind='first_response'`) — a human always approves; nothing
is auto-sent.

Two things stay deliberately separate from the drafting:
* **Marking.** Both creation paths (manual `LeadListCreateView.perform_create` and
  Meta `meta_leads`) only ever *flag* a new lead (`Lead.needs_first_response`).
  The Meta webhook must never call the LLM inline, so marking is all they do.
* **Drafting.** A frequent cron (every ~10 min, separate from the once-daily 7am
  follow-up gate) picks up flagged leads and drafts. "No prior draft of any kind"
  is the real idempotency guard — the flag just keeps the candidate scan cheap.
"""
import logging
from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone

from bookings.activity import log_activity
from bookings.models import FollowUpDraft, Lead, OrgSettings
from bookings.services import email as email_service
from bookings.services.followup_drafter import draft_first_response
from bookings.services.followup_scheduler import choose_channel

logger = logging.getLogger(__name__)

# A flagged lead the cron never got to within this window is dropped rather than
# drafted: a "first response" hours or days late is not speed-to-lead, and
# retro-drafting a backlog when the toggle is first switched on would spam it.
# (Belt-and-braces on top of marking-at-creation, which already means a lead
# created before the feature was enabled is never flagged at all.)
FIRST_RESPONSE_MAX_AGE = timedelta(hours=48)


def mark_lead_for_first_response(lead):
    """Flag a freshly-created lead for a first-response draft, if its org opted in.

    Called from both lead-creation paths. Cheap and side-effect-light: one
    settings read, and a single-field save only when we actually flip the flag.
    Safe to call on a lead that has no contact details yet — the cron re-checks
    reachability at draft time.
    """
    enabled = (
        OrgSettings.objects.filter(organisation_id=lead.organisation_id)
        .values_list('first_response_enabled', flat=True)
        .first()
    )
    if enabled and not lead.needs_first_response:
        lead.needs_first_response = True
        lead.save(update_fields=['needs_first_response'])


def eligible_leads(org):
    """Flagged leads still eligible for a first response, by query — the single
    source of the eligibility rules.

    A lead qualifies when it is flagged, active (non-terminal), created within
    the max-age window, and has NO prior draft of any kind and NO prior outbound
    message. The last two are what make a second cron tick a no-op (idempotency)
    and stop a first response landing on a lead we have already contacted.
    Reachability is decided per-lead by `choose_channel` in the run loop, since
    it depends on the org's live mailbox state.
    """
    from bookings.models.choices import LeadStatusOption
    from bookings.models.leads import TERMINAL_STATUSES

    terminal = set(TERMINAL_STATUSES) | set(
        LeadStatusOption.objects.filter(organisation=org)
        .filter(Q(is_won=True) | Q(is_lost=True))
        .values_list('value', flat=True)
    )
    cutoff = timezone.now() - FIRST_RESPONSE_MAX_AGE

    return (
        Lead.objects.for_org(org)
        .filter(needs_first_response=True)
        .exclude(status__in=terminal)
        .filter(created_at__gte=cutoff)
        .annotate(
            _draft_count=Count('followup_drafts', distinct=True),
            _outbound_count=Count(
                'whatsapp_messages',
                filter=Q(whatsapp_messages__direction='outbound'), distinct=True,
            ),
        )
        .filter(_draft_count=0, _outbound_count=0)
    )


def run_for_org(org):
    """Draft first responses for one org's flagged leads. Returns a summary dict.

    The flag is cleared on every DEFINITIVE outcome — a draft created, or the
    model declining — so we never re-call the LLM for the same lead. It is left
    set only on a *transient* miss (mailbox momentarily unusable, or the LLM call
    failing) so the next tick retries, until the max-age window drops the lead.
    """
    settings = OrgSettings.for_org(org)
    if not settings.first_response_configured:
        return {'org': org.pk, 'skipped': 'not configured', 'created': 0}

    created = skipped = 0
    mailbox_usable = email_service.mailbox_is_usable(org)

    for lead in eligible_leads(org):
        channel = choose_channel(lead, mailbox_usable=mailbox_usable)
        if channel is None:
            # Unreachable right now (no phone, no working email). Leave the flag:
            # a number/address may still be added inside the window.
            skipped += 1
            continue

        result = draft_first_response(lead, channel=channel)
        if result is None:
            # Transient LLM failure — keep the flag so the next tick retries.
            skipped += 1
            continue

        # Definitive outcome from here: don't ask the model about this lead again.
        Lead.objects.filter(pk=lead.pk).update(needs_first_response=False)

        if not result.get('should_follow_up'):
            skipped += 1
            continue

        draft = FollowUpDraft.objects.create(
            organisation=org,
            lead=lead,
            kind=FollowUpDraft.KIND_FIRST_RESPONSE,
            channel=channel,
            subject=result.get('subject', ''),
            body=result['message'],
            reasoning=result.get('reasoning', ''),
            model_used=result.get('model_used', ''),
        )
        log_activity(
            lead, 'updated',
            field_name='followup_draft',
            description='AI drafted a first response for review',
        )
        created += 1
        logger.info("Created first-response draft %s for lead %s", draft.pk, lead.pk)

    return {'org': org.pk, 'created': created, 'skipped': skipped}


def run_all():
    """Draft first responses for every org that has the feature on (cron entry).

    Safe to call every few minutes: each lead is drafted at most once (the flag
    plus the no-prior-draft guard), and orgs without the toggle are skipped.
    """
    summaries = []
    org_settings = (
        OrgSettings.objects.filter(first_response_enabled=True)
        .select_related('organisation')
    )
    for settings in org_settings:
        summaries.append(run_for_org(settings.organisation))
    return summaries
