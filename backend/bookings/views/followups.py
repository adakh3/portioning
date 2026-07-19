from django.db.models import Q
from django.conf import settings as django_settings
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response

from bookings.activity import log_activity
from bookings.models import FollowUpDraft, Lead, OrgSettings, WhatsAppMessage
from bookings.permissions import is_salesperson
from bookings.serializers.followups import FollowUpDraftSerializer
from bookings.services.followup_scheduler import find_stale_leads, lead_last_touch, run_scheduled
from bookings.services.followup_drafter import draft_followup
from bookings.services.whatsapp import WhatsAppService
from bookings.views.dashboard import parse_period_window
from users.mixins import (
    get_request_org, is_superuser_without_org, get_org_object_or_404,
)


def _scoped_drafts(request):
    """Follow-up drafts the requester may see AND act on: org-scoped, and
    salespeople only ever touch drafts for their own leads (assigned to them
    or created by them) — same rule as the lead list. Approve/dismiss resolve
    drafts through this, so the scope is also the permission boundary."""
    qs = FollowUpDraft.objects.select_related('lead', 'lead__assigned_to', 'reviewed_by').all()
    if not is_superuser_without_org(request):
        org = get_request_org(request)
        if org is None:
            return qs.none()
        qs = qs.filter(organisation=org)
    if request.user.is_authenticated and is_salesperson(request.user):
        qs = qs.filter(
            Q(lead__assigned_to=request.user) | Q(lead__created_by=request.user)
        )
    return qs


def _approve_draft(draft, user):
    """Send a draft's message via WhatsApp and mark it sent. Returns (ok, error)."""
    org = draft.organisation
    try:
        msg = WhatsAppService(org).send_message(draft.lead, draft.body, sent_by=user)
    except ValueError as exc:
        return False, str(exc)

    draft.status = 'sent'
    draft.whatsapp_message = msg
    draft.reviewed_by = user
    draft.reviewed_at = timezone.now()
    draft.save(update_fields=['status', 'whatsapp_message', 'reviewed_by', 'reviewed_at', 'updated_at'])
    log_activity(
        draft.lead, 'updated', user=user,
        field_name='followup_draft',
        description='Approved & sent an AI-drafted follow-up',
    )
    return True, None


class FollowUpDraftListView(generics.ListAPIView):
    """GET /api/bookings/followup-drafts/ — the review queue (pending by default)."""
    serializer_class = FollowUpDraftSerializer

    def get_queryset(self):
        qs = _scoped_drafts(self.request)
        status_filter = self.request.query_params.get('status', 'pending')
        if status_filter:
            qs = qs.filter(status=status_filter)
        lead_filter = self.request.query_params.get('lead')
        if lead_filter:
            qs = qs.filter(lead_id=lead_filter)
        return qs


class LeadFollowUpDraftListView(generics.ListAPIView):
    """GET /api/bookings/leads/<pk>/followup-drafts/ — drafts for one lead."""
    serializer_class = FollowUpDraftSerializer

    def get_queryset(self):
        get_org_object_or_404(Lead, self.request, pk=self.kwargs['pk'])
        return FollowUpDraft.objects.select_related('lead', 'lead__assigned_to', 'reviewed_by').filter(
            lead_id=self.kwargs['pk'],
        )


class FollowUpDraftApproveView(generics.GenericAPIView):
    """POST /api/bookings/followup-drafts/<pk>/approve/ — edit (optional) + send."""

    def post(self, request, pk):
        draft = _scoped_drafts(request).filter(pk=pk).first()
        if draft is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if draft.status != 'pending':
            return Response({'detail': 'Draft is not pending.'}, status=status.HTTP_400_BAD_REQUEST)

        # Allow the reviewer to tweak the wording before it goes out.
        edited_body = request.data.get('body')
        if edited_body is not None:
            draft.body = edited_body
            draft.save(update_fields=['body', 'updated_at'])

        user = request.user if request.user.is_authenticated else None
        ok, error = _approve_draft(draft, user)
        if not ok:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(FollowUpDraftSerializer(draft).data)


class FollowUpDraftDismissView(generics.GenericAPIView):
    """POST /api/bookings/followup-drafts/<pk>/dismiss/ — discard without sending."""

    def post(self, request, pk):
        draft = _scoped_drafts(request).filter(pk=pk).first()
        if draft is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if draft.status != 'pending':
            return Response({'detail': 'Draft is not pending.'}, status=status.HTTP_400_BAD_REQUEST)
        user = request.user if request.user.is_authenticated else None
        draft.status = 'dismissed'
        draft.reviewed_by = user
        draft.reviewed_at = timezone.now()
        draft.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'updated_at'])
        return Response(FollowUpDraftSerializer(draft).data)


class FollowUpDraftBulkApproveView(generics.GenericAPIView):
    """POST /api/bookings/followup-drafts/bulk-approve/ — approve+send many at once.

    Body: optional {"ids": [..]} to limit; otherwise approves all pending drafts.
    """

    def post(self, request):
        qs = _scoped_drafts(request).filter(status='pending')
        ids = request.data.get('ids')
        if ids:
            qs = qs.filter(id__in=ids)

        user = request.user if request.user.is_authenticated else None
        sent, failed = [], []
        for draft in qs:
            ok, error = _approve_draft(draft, user)
            (sent if ok else failed).append(
                draft.id if ok else {'id': draft.id, 'error': error}
            )
        return Response({'sent': sent, 'failed': failed})


class FollowUpDraftCountView(generics.GenericAPIView):
    """GET /api/bookings/followup-drafts/count/ — pending count for the nav badge."""

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({'pending': 0})
        return Response({'pending': _scoped_drafts(request).filter(status='pending').count()})


class CronRunFollowupsView(generics.GenericAPIView):
    """POST /api/bookings/cron/run-followups/ — the scheduled-generation
    trigger, hit hourly by a GitHub Actions cron. No user auth: a shared
    secret header gates it, and run_scheduled() itself enforces the once-per-
    org-local-day guard, so extra calls are harmless no-ops."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        secret = django_settings.CRON_SECRET
        if not secret:
            return Response({'detail': 'Cron endpoint not configured.'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if request.headers.get('X-Cron-Secret') != secret:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        summaries = run_scheduled()
        return Response({
            'orgs_run': len(summaries),
            'created': sum(s.get('created', 0) for s in summaries),
        })


class FollowUpStatsView(generics.GenericAPIView):
    """GET /api/bookings/followup-drafts/stats/?period=...&date_from=&date_to=

    Dashboard numbers: 'to_review' (pending drafts, live) and 'due' (leads the
    cadence logic would draft for now, live) ignore the window; 'sent' counts
    drafts sent within it. Salespeople get their own numbers; everyone else
    gets team totals plus a per-rep breakdown (to_review/due attributed to the
    lead's assignee, sent to whoever actually pressed send).
    """

    def get(self, request):
        org = get_request_org(request)
        if org is None:
            return Response({'detail': 'No organisation.'}, status=status.HTTP_400_BAD_REQUEST)
        settings = OrgSettings.for_org(org)
        since, until = parse_period_window(request)

        sent = _scoped_drafts(request).filter(status='sent')
        if since:
            sent = sent.filter(reviewed_at__gte=since)
        if until:
            sent = sent.filter(reviewed_at__lt=until)

        pending = _scoped_drafts(request).filter(status='pending')
        due = _eligible_stale_leads(request, org, settings)

        payload = {
            'to_review': pending.count(),
            'due': due.count(),
            'sent': sent.count(),
        }

        if not is_salesperson(request.user):
            per_user = {}

            def row(user):
                key = user.pk if user else None
                if key not in per_user:
                    name = (
                        f"{user.first_name} {user.last_name}".strip() or user.email
                    ) if user else 'Unassigned'
                    per_user[key] = {
                        'user_id': key, 'name': name,
                        'to_review': 0, 'due': 0, 'sent': 0,
                    }
                return per_user[key]

            for draft in pending.select_related('lead__assigned_to'):
                row(draft.lead.assigned_to)['to_review'] += 1
            for lead in due:
                row(lead.assigned_to)['due'] += 1
            for draft in sent.select_related('reviewed_by'):
                row(draft.reviewed_by)['sent'] += 1

            payload['breakdown'] = sorted(
                per_user.values(),
                key=lambda r: (r['user_id'] is None, r['name'].lower()),
            )

        return Response(payload)


class FollowUpDraftMarkSentView(generics.GenericAPIView):
    """POST /api/bookings/followup-drafts/<pk>/mark-sent/ — the rep sent the
    message themselves via a WhatsApp shortcut (their own device). Records the
    send so the scheduler's ledger (sent count, spacing, days-quiet) stays
    truthful without Twilio."""

    def post(self, request, pk):
        draft = _scoped_drafts(request).filter(pk=pk).first()
        if draft is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if draft.status != 'pending':
            return Response({'detail': 'Draft is not pending.'}, status=status.HTTP_400_BAD_REQUEST)

        # The rep may have edited the text before opening WhatsApp.
        edited_body = request.data.get('body')
        if edited_body is not None:
            draft.body = edited_body

        user = request.user if request.user.is_authenticated else None
        WhatsAppMessage.objects.create(
            organisation=draft.organisation,
            lead=draft.lead,
            to_phone=f'whatsapp:{draft.lead.contact_phone}',
            from_phone='manual',                # sent from the rep's own device
            body=draft.body,
            direction='outbound',
            status='sent',
            sent_by=user,
        )
        draft.status = 'sent'
        draft.reviewed_by = user
        draft.reviewed_at = timezone.now()
        draft.save(update_fields=['body', 'status', 'reviewed_by', 'reviewed_at', 'updated_at'])
        log_activity(
            draft.lead, 'updated', user=user,
            field_name='followup_draft',
            description='Sent an AI follow-up via WhatsApp (from own device)',
        )
        return Response(FollowUpDraftSerializer(draft).data)


class LeadLogReplyView(generics.GenericAPIView):
    """POST /api/bookings/leads/<pk>/log-reply/ — record that the customer
    replied on WhatsApp (shortcut mode: the reply lives on the rep's phone).
    The inbound marker keeps the reply-pause rule and days-quiet honest."""

    def post(self, request, pk):
        lead = get_org_object_or_404(Lead, request, pk=pk)
        user = request.user if request.user.is_authenticated else None
        WhatsAppMessage.objects.create(
            organisation=lead.organisation,
            lead=lead,
            to_phone='manual',
            from_phone=f'whatsapp:{lead.contact_phone}',
            body='(reply logged manually — content is on the salesperson\'s phone)',
            direction='inbound',
            status='received',
        )
        log_activity(
            lead, 'updated', user=user,
            field_name='whatsapp',
            description='Customer replied on WhatsApp (logged manually)',
        )
        return Response({'logged': True})


def _eligible_stale_leads(request, org, settings):
    """Leads the on-demand generator may draft for — the agent's eligibility
    rules (single source of truth: find_stale_leads + the per-lead cap), plus
    the requester's role scope: salespeople only ever act on their own leads.
    """
    qs = find_stale_leads(org, settings)
    if is_salesperson(request.user):
        qs = qs.filter(Q(assigned_to=request.user) | Q(created_by=request.user))
    return qs.select_related('assigned_to').distinct()


def _days_stale(lead):
    return max((timezone.now() - lead_last_touch(lead)).days, 0)


class FollowUpPreviewView(generics.GenericAPIView):
    """GET /api/bookings/followup-drafts/preview/ — leads the generator would
    draft for, so the user can review and deselect before confirming."""

    def get(self, request):
        org = get_request_org(request)
        if org is None:
            return Response({'detail': 'No organisation.'}, status=status.HTTP_400_BAD_REQUEST)
        settings = OrgSettings.for_org(org)

        leads = sorted(
            _eligible_stale_leads(request, org, settings),
            key=lambda l: l.updated_at,          # oldest touch first = most stale first
        )
        rows = [{
            'id': lead.pk,
            'contact_name': lead.contact_name,
            'days_stale': _days_stale(lead),
            'status': lead.status,
            'event_date': lead.event_date,
            'budget': lead.budget,
            'assigned_to': lead.assigned_to_id,
            'assigned_to_name': (
                f"{lead.assigned_to.first_name} {lead.assigned_to.last_name}".strip()
                if lead.assigned_to else None
            ),
        } for lead in leads]
        return Response({
            'configured': settings.ai_followups_configured,
            'first_gap_days': settings.followup_gap_first_days,
            'leads': rows,
        })


class FollowUpGenerateView(generics.GenericAPIView):
    """POST /api/bookings/followup-drafts/generate/ {"lead": <id>} — draft for
    ONE lead. The frontend loops selected leads through this for live progress.

    Eligibility is re-checked here, not trusted from the preview: a lead touched
    (or drafted) between preview and confirm comes back 'ineligible' instead of
    being double-drafted.
    """

    def post(self, request):
        org = get_request_org(request)
        if org is None:
            return Response({'detail': 'No organisation.'}, status=status.HTTP_400_BAD_REQUEST)
        settings = OrgSettings.for_org(org)
        if not settings.ai_followups_configured:
            return Response(
                {'detail': 'AI follow-ups are not configured.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lead = get_org_object_or_404(Lead, request, pk=request.data.get('lead'))
        if not _eligible_stale_leads(request, org, settings).filter(pk=lead.pk).exists():
            return Response({
                'status': 'ineligible',
                'detail': 'Lead is no longer eligible (touched recently, has a pending draft, or hit the draft cap).',
            })

        result = draft_followup(lead)
        if result is None:
            return Response(
                {'status': 'failed', 'detail': 'The AI call failed — try again.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        if not result.get('should_follow_up'):
            return Response({'status': 'skipped', 'reasoning': result.get('reasoning', '')})

        draft = FollowUpDraft.objects.create(
            organisation=org,
            lead=lead,
            body=result['message'],
            reasoning=result.get('reasoning', ''),
            model_used=result.get('model_used', ''),
        )
        log_activity(
            lead, 'updated', user=request.user if request.user.is_authenticated else None,
            field_name='followup_draft',
            description='AI drafted a follow-up for review',
        )
        return Response({'status': 'created', 'draft': FollowUpDraftSerializer(draft).data})
