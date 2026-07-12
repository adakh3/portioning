"""The follow-up agent loop: find stale leads, draft follow-ups for review.

This is the code the scheduled management command calls. It is deliberately
side-effect-light: it only ever creates *pending* FollowUpDraft rows for a human
to approve — nothing is sent.
"""
import logging
from datetime import timedelta

from django.utils import timezone

from bookings.activity import log_activity
from bookings.models import FollowUpDraft, Lead, OrgSettings
from bookings.services.followup_drafter import draft_followup

logger = logging.getLogger(__name__)


def find_stale_leads(org, settings):
    """Leads worth drafting a follow-up for, per the shared stale definition."""
    cutoff = timezone.now() - timedelta(hours=settings.followup_stale_hours)
    return (
        Lead.objects.for_org(org)
        .stale(cutoff)
        .exclude(contact_phone='')          # can't WhatsApp without a number
        .exclude(followup_drafts__status='pending')  # don't pile up unreviewed drafts
    )


def run_for_org(org, dry_run=False):
    """Generate follow-up drafts for one org. Returns a summary dict."""
    settings = OrgSettings.for_org(org)
    if not settings.ai_followups_configured:
        return {'org': org.pk, 'skipped': 'not configured', 'created': 0}

    created = skipped = 0

    for lead in find_stale_leads(org, settings).distinct():
        # Per-lead cap: never bug a single lead more than N times.
        if lead.followup_drafts.count() >= settings.followup_max_drafts_per_lead:
            skipped += 1
            continue

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
