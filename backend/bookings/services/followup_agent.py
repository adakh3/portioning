"""The follow-up agent loop: find stale leads, draft follow-ups for review.

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
    from message history:

      - active lead (not won/lost), untouched for `followup_stale_hours`
      - has a phone number; no pending (unreviewed) draft
      - fewer than `followup_max_drafts_per_lead` follow-ups actually SENT —
        dismissed drafts don't burn the budget
      - spacing: the last SENT follow-up is older than the stale threshold,
        so the same knob paces quiet-gap and follow-up-gap alike
      - the lead is not waiting on us: if the latest thread message is theirs,
        a human should answer — the agent never chases someone who spoke last
    """
    cutoff = timezone.now() - timedelta(hours=settings.followup_stale_hours)
    latest_message_direction = (
        WhatsAppMessage.objects.filter(lead=OuterRef('pk'))
        .order_by('-created_at').values('direction')[:1]
    )
    return (
        Lead.objects.for_org(org)
        .stale(cutoff)
        .exclude(contact_phone='')          # can't WhatsApp without a number
        .exclude(followup_drafts__status='pending')  # don't pile up unreviewed drafts
        .annotate(
            sent_followups=Count(
                'followup_drafts', filter=Q(followup_drafts__status='sent'), distinct=True,
            ),
            last_followup_sent_at=Max(
                'followup_drafts__reviewed_at', filter=Q(followup_drafts__status='sent'),
            ),
            latest_message_direction=Subquery(latest_message_direction),
        )
        .filter(sent_followups__lt=settings.followup_max_drafts_per_lead)
        .filter(Q(last_followup_sent_at__isnull=True) | Q(last_followup_sent_at__lt=cutoff))
        # NB: exclude() would also drop leads with NO messages (NULL != 'inbound'
        # is NULL in SQL) — filter the two acceptable states explicitly.
        .filter(
            Q(latest_message_direction__isnull=True)
            | Q(latest_message_direction='outbound')
        )
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
