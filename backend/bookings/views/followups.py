from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response

from bookings.activity import log_activity
from bookings.models import FollowUpDraft, Lead
from bookings.serializers.followups import FollowUpDraftSerializer
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
