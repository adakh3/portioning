"""HTTP endpoints for the AI Proposal Builder (REL-413).

Thin wrappers over ``agents.proposal`` — start (lead → clarifying questions),
answer (form answers → drafted quote), regenerate (fresh attempt), and a read
endpoint for the draft. All org-scoped via the standard helpers and gated on the
org's ``proposal_agent_configured`` (toggle + a configured model). Nothing here
auto-sends: it only produces a draft Quote a human then reviews and sends.
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.mixins import get_org_object_or_404, get_request_org

from agents.models import ProposalDraft
from agents.proposal import (ProposalRunError, regenerate_proposal, resume_proposal,
                             start_proposal)
from agents.serializers import ProposalDraftSerializer
from bookings.models import Lead, OrgSettings


def _require_configured(request):
    """Return (org, None) when the proposal agent is usable, else (None, Response)."""
    org = get_request_org(request)
    if org is None:
        return None, Response({'detail': 'No organisation.'}, status=status.HTTP_400_BAD_REQUEST)
    if not OrgSettings.for_org(org).proposal_agent_configured:
        return None, Response(
            {'detail': 'The AI proposal builder is not enabled for this organisation.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return org, None


class LeadDraftProposalView(APIView):
    """POST /api/bookings/leads/<pk>/draft-proposal/ — start a proposal for a lead.

    Returns the draft parked at the clarifying form (status questions_pending)."""

    def post(self, request, pk):
        org, err = _require_configured(request)
        if err:
            return err
        lead = get_org_object_or_404(Lead, request, pk=pk)
        draft = start_proposal(organisation=org, lead=lead)
        code = status.HTTP_201_CREATED if draft.status != ProposalDraft.FAILED else status.HTTP_502_BAD_GATEWAY
        return Response(ProposalDraftSerializer(draft).data, status=code)


class ProposalDraftDetailView(APIView):
    """GET /api/bookings/proposal-drafts/<pk>/ — read a draft (poll/resume UI)."""

    def get(self, request, pk):
        org = get_request_org(request)
        draft = get_org_object_or_404(ProposalDraft, request, pk=pk)
        return Response(ProposalDraftSerializer(draft).data)


class ProposalDraftAnswerView(APIView):
    """POST /api/bookings/proposal-drafts/<pk>/answer/ {"answers": {...}} — resume
    the run with the caterer's answers; returns the drafted quote id."""

    def post(self, request, pk):
        org, err = _require_configured(request)
        if err:
            return err
        # Ensure the draft is this org's before touching the agent.
        get_org_object_or_404(ProposalDraft, request, pk=pk)
        try:
            draft = resume_proposal(
                organisation=org, draft_id=pk, answers=request.data.get('answers') or {},
            )
        except ProposalRunError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_409_CONFLICT)
        code = status.HTTP_200_OK if draft.status == ProposalDraft.DRAFTED else status.HTTP_502_BAD_GATEWAY
        return Response(ProposalDraftSerializer(draft).data, status=code)


class ProposalDraftRegenerateView(APIView):
    """POST /api/bookings/proposal-drafts/<pk>/regenerate/ — fresh attempt for the
    same lead, reusing the prior answers."""

    def post(self, request, pk):
        org, err = _require_configured(request)
        if err:
            return err
        get_org_object_or_404(ProposalDraft, request, pk=pk)
        try:
            draft = regenerate_proposal(organisation=org, draft_id=pk)
        except ProposalRunError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(ProposalDraftSerializer(draft).data)
