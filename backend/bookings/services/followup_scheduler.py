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
    "Quiet" at every stage means all four clocks have passed the stage's gap:
    the lead record untouched, no follow-up sent by us, no OTHER outbound
    WhatsApp from us (a quote share counts as contact — don't chase minutes
    after it), and — crucially — no reply from the lead. A fresh reply
    therefore PAUSES the agent (a human should answer), but an unanswered
    reply older than the gap re-enters the cadence instead of shelving the
    lead forever.

    Also: active lead, has a phone, event date not already in the past,
    no pending draft, and fewer than `followup_max_drafts_per_lead` follow-ups
    REVIEWED (sent or dismissed). A dismissal is treated exactly like a send
    for the cadence — that stage is skipped, the next gap starts from the
    dismissal, and it burns the cap — so a cron can never recreate a
    follow-up someone already threw away.
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
    latest_outbound_at = (
        WhatsAppMessage.objects.filter(lead=OuterRef('pk'), direction='outbound')
        .order_by('-created_at').values('created_at')[:1]
    )

    def quiet_since(cutoff):
        return (
            Q(updated_at__lt=cutoff)
            & (Q(last_reviewed_at__isnull=True) | Q(last_reviewed_at__lt=cutoff))
            & (Q(last_outbound_at__isnull=True) | Q(last_outbound_at__lt=cutoff))
            & (Q(last_inbound_at__isnull=True) | Q(last_inbound_at__lt=cutoff))
        )

    stage_gate = (
        (Q(reviewed_followups=0) & quiet_since(cutoffs[0]))
        | (Q(reviewed_followups=1) & quiet_since(cutoffs[1]))
        | (Q(reviewed_followups__gte=2) & quiet_since(cutoffs[2]))
    )

    # Terminal statuses are org-customizable: exclude the built-in values AND
    # any custom status the org flagged as won/lost.
    from bookings.models.choices import LeadStatusOption
    from bookings.models.leads import TERMINAL_STATUSES
    terminal = set(TERMINAL_STATUSES) | set(
        LeadStatusOption.objects.filter(
            organisation=org,
        ).filter(Q(is_won=True) | Q(is_lost=True)).values_list('value', flat=True)
    )

    return (
        Lead.objects.for_org(org)
        .exclude(status__in=terminal)
        .exclude(contact_phone='')          # can't WhatsApp without a number
        .exclude(event_date__lt=now.date())  # the event already happened — nothing to chase
        .exclude(followup_drafts__status='pending')  # don't pile up unreviewed drafts
        .annotate(
            reviewed_followups=Count(
                'followup_drafts',
                filter=Q(followup_drafts__status__in=('sent', 'dismissed')), distinct=True,
            ),
            last_reviewed_at=Max(
                'followup_drafts__reviewed_at',
                filter=Q(followup_drafts__status__in=('sent', 'dismissed')),
            ),
            last_inbound_at=Subquery(latest_inbound_at),
            last_outbound_at=Subquery(latest_outbound_at),
        )
        .filter(reviewed_followups__lt=settings.followup_max_drafts_per_lead)
        .filter(stage_gate)
    )


def last_touch_from_parts(updated_at, last_reviewed=None, last_message=None):
    """The freshest of the quiet-clock timestamps, given the parts already in
    hand. Split out from lead_last_touch so callers that have *annotated* those
    two aggregates onto a queryset (the review-queue list) don't re-query them
    per row — the divergence-proof single source of "which stamps count"."""
    stamps = [updated_at]
    if last_reviewed:
        stamps.append(last_reviewed)
    if last_message:
        stamps.append(last_message)
    return max(stamps)


def lead_last_touch(lead):
    """The freshest of the four quiet-clocks the cadence runs on: record
    edits, our last reviewed follow-up (sent OR dismissed — a dismissal skips
    that stage, it doesn't re-arm it), any outbound WhatsApp from us (e.g. a
    quote share), the lead's last reply. Display code uses this so 'days
    quiet' always matches what the scheduler actually measures. Fires two
    aggregate queries — for lists, annotate instead and use
    last_touch_from_parts (see followup views)."""
    last_reviewed = lead.followup_drafts.filter(status__in=('sent', 'dismissed')).aggregate(
        m=Max('reviewed_at'))['m']
    last_message = WhatsAppMessage.objects.filter(lead=lead).aggregate(
        m=Max('created_at'))['m']
    return last_touch_from_parts(lead.updated_at, last_reviewed, last_message)


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


RUN_HOUR = 7  # org-local hour after which the daily scheduled run may fire


def run_scheduled(now=None):
    """The cron entrypoint — safe to call every hour. For each org with AI
    follow-ups configured AND auto-generation on, runs once per org-local day,
    the first time it's called after RUN_HOUR local. Late calls self-heal (a
    3pm first call still runs); repeat calls the same day are no-ops.
    """
    from zoneinfo import ZoneInfo
    now = now or timezone.now()
    summaries = []
    org_settings = OrgSettings.objects.filter(
        ai_followups_enabled=True, followup_auto_generate=True,
    ).select_related('organisation')
    for settings in org_settings:
        try:
            tz = ZoneInfo(settings.timezone or 'UTC')
        except (KeyError, ValueError):
            tz = ZoneInfo('UTC')
        local_now = now.astimezone(tz)
        if local_now.hour < RUN_HOUR:
            continue
        last = settings.followup_last_auto_run_at
        if last and last.astimezone(tz).date() == local_now.date():
            continue  # already ran today (org-local)
        summary = run_for_org(settings.organisation)
        settings.followup_last_auto_run_at = now
        settings.save(update_fields=['followup_last_auto_run_at'])
        summaries.append(summary)
    return summaries


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
