"""The follow-up scheduler: decide WHO gets a follow-up and WHEN.

Deliberately not an "agent" — everything here is deterministic query logic
(eligibility, cadence, caps). The only AI is in followup_drafter, which this
scheduler hands one approved lead at a time.

This is the code the scheduled management command calls. It is deliberately
side-effect-light: it only ever creates *pending* FollowUpDraft rows for a human
to approve — nothing is sent.
"""
import logging
from datetime import timedelta

from django.db.models import Count, Max, OuterRef, Q, Subquery
from django.utils import timezone

from bookings.activity import log_activity
from bookings.models import FollowUpDraft, Lead, OrgSettings, WhatsAppMessage
from bookings.services.followup_drafter import draft_followup

logger = logging.getLogger(__name__)


def find_stale_leads(org, settings):
    """Leads worth drafting a follow-up for — ALL the eligibility rules, in one
    place, enforced by queries rather than by trusting the model to infer them
    from message history.

    Escalating per-org cadence: the FIRST follow-up after
    `followup_gap_first_days` of quiet, the SECOND `followup_gap_second_days`
    after that, the THIRD (and any later) `followup_gap_final_days` apart.
    "Quiet" at every stage means all three clocks have passed the stage's gap:
    the lead record untouched, nothing sent by us, and — crucially — no reply
    from the lead. A fresh reply therefore PAUSES the agent (a human should
    answer), but an unanswered reply older than the gap re-enters the cadence
    instead of shelving the lead forever.

    Also: active lead, has a phone, event date not already in the past,
    no pending draft, and fewer than
    `followup_max_drafts_per_lead` follow-ups actually SENT (dismissed drafts
    don't burn the budget).
    """
    now = timezone.now()
    cutoffs = [
        now - timedelta(days=settings.followup_gap_first_days),
        now - timedelta(days=settings.followup_gap_second_days),
        now - timedelta(days=settings.followup_gap_final_days),
    ]

    latest_inbound_at = (
        WhatsAppMessage.objects.filter(lead=OuterRef('pk'), direction='inbound')
        .order_by('-created_at').values('created_at')[:1]
    )

    def quiet_since(cutoff):
        return (
            Q(updated_at__lt=cutoff)
            & (Q(last_followup_sent_at__isnull=True) | Q(last_followup_sent_at__lt=cutoff))
            & (Q(last_inbound_at__isnull=True) | Q(last_inbound_at__lt=cutoff))
        )

    stage_gate = (
        (Q(sent_followups=0) & quiet_since(cutoffs[0]))
        | (Q(sent_followups=1) & quiet_since(cutoffs[1]))
        | (Q(sent_followups__gte=2) & quiet_since(cutoffs[2]))
    )

    return (
        Lead.objects.for_org(org)
        .active()
        .exclude(contact_phone='')          # can't WhatsApp without a number
        .exclude(event_date__lt=now.date())  # the event already happened — nothing to chase
        .exclude(followup_drafts__status='pending')  # don't pile up unreviewed drafts
        .annotate(
            sent_followups=Count(
                'followup_drafts', filter=Q(followup_drafts__status='sent'), distinct=True,
            ),
            last_followup_sent_at=Max(
                'followup_drafts__reviewed_at', filter=Q(followup_drafts__status='sent'),
            ),
            last_inbound_at=Subquery(latest_inbound_at),
        )
        .filter(sent_followups__lt=settings.followup_max_drafts_per_lead)
        .filter(stage_gate)
    )


def run_for_org(org, dry_run=False):
    """Generate follow-up drafts for one org. Returns a summary dict."""
    settings = OrgSettings.for_org(org)
    if not settings.ai_followups_configured:
        return {'org': org.pk, 'skipped': 'not configured', 'created': 0}

    created = skipped = 0

    for lead in find_stale_leads(org, settings).distinct():
        if dry_run:
            created += 1
            continue

        result = draft_followup(lead)
        if not result or not result.get('should_follow_up'):
            skipped += 1
            continue

        draft = FollowUpDraft.objects.create(
            organisation=org,
            lead=lead,
            body=result['message'],
            reasoning=result.get('reasoning', ''),
            model_used=result.get('model_used', ''),
        )
        log_activity(
            lead, 'updated',
            field_name='followup_draft',
            description='AI drafted a follow-up for review',
        )
        created += 1
        logger.info("Created follow-up draft %s for lead %s", draft.pk, lead.pk)

    return {'org': org.pk, 'created': created, 'skipped': skipped}


def run_all(dry_run=False):
    """Generate drafts for every org with AI follow-ups configured."""
    summaries = []
    org_ids = (
        OrgSettings.objects.filter(ai_followups_enabled=True)
        .values_list('organisation_id', flat=True)
    )
    for settings in OrgSettings.objects.filter(organisation_id__in=list(org_ids)).select_related('organisation'):
        summaries.append(run_for_org(settings.organisation, dry_run=dry_run))
    return summaries
