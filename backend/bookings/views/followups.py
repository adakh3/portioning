from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response

from bookings.activity import log_activity
from bookings.models import FollowUpDraft, Lead, OrgSettings
from bookings.permissions import is_salesperson
from bookings.serializers.followups import FollowUpDraftSerializer
from bookings.services.followup_agent import find_stale_leads
from bookings.services.followup_drafter import draft_followup
from bookings.services.whatsapp import WhatsAppService
from users.mixins import (
    get_request_org, is_superuser_without_org, get_org_object_or_404,
)


def _scoped_drafts(request):
    """All follow-up drafts visible to the requester, org-scoped."""
    qs = FollowUpDraft.objects.select_related('lead', 'reviewed_by').all()
    if not is_superuser_without_org(request):
        org = get_request_org(request)
        if org is None:
            return qs.none()
        qs = qs.filter(organisation=org)
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
        return FollowUpDraft.objects.select_related('lead', 'reviewed_by').filter(
            lead_id=self.kwargs['pk'],
        )


class FollowUpDraftApproveView(generics.GenericAPIView):
    """POST /api/bookings/followup-drafts/<pk>/approve/ — edit (optional) + send."""

    def post(self, request, pk):
        draft = get_org_object_or_404(FollowUpDraft, request, pk=pk)
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
        draft = get_org_object_or_404(FollowUpDraft, request, pk=pk)
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
    return max((timezone.now() - lead.updated_at).days, 0)


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
            'stale_hours': settings.followup_stale_hours,
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
