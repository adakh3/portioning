"""Endpoint wiring for the proposal agent: gating, org-scoping, status codes.

The graph itself is covered by test_proposal_run; here the agent runner is mocked
so these tests stay fast and focus on the HTTP surface (auth, org boundary, the
proposal_agent_configured gate).
"""
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from agents.models import AgentThread, ProposalDraft
from bookings.models import Lead, OrgSettings
from users.models import Organisation, User

CONFIGURED = dict(LLM_PROPOSAL_QUESTIONS='openai:gpt-test', OPENAI_API_KEY='sk-x')


def _enable(org):
    s = OrgSettings.for_org(org)
    s.proposal_agent_enabled = True
    s.save()


def _draft(org, lead, **kw):
    n = AgentThread.objects.filter(agent='proposal').count() + 1
    thread = AgentThread.objects.create(
        organisation=org, agent='proposal', thread_key=f'proposal:{org.id}:{lead.id}:{n}',
        status=AgentThread.AWAITING_INPUT,
    )
    return ProposalDraft.objects.create(organisation=org, lead=lead, agent_thread=thread, **kw)


class ProposalEndpointTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Org A', slug='org-a')
        self.user = User.objects.create(email='a@x.test', role='owner', organisation=self.org)
        self.lead = Lead.objects.create(organisation=self.org, contact_name='Sam')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_start_gated_off_when_not_configured(self):
        # Toggle off (and no model) → 400, agent never invoked.
        with patch('bookings.views.proposals.start_proposal') as start:
            res = self.client.post(f'/api/bookings/leads/{self.lead.id}/draft-proposal/')
        self.assertEqual(res.status_code, 400)
        start.assert_not_called()

    @override_settings(**CONFIGURED)
    def test_start_returns_questions_when_configured(self):
        _enable(self.org)
        draft = _draft(self.org, self.lead, status=ProposalDraft.QUESTIONS_PENDING,
                       questions=[{'id': 'event_date', 'text': 'When?'}])
        with patch('bookings.views.proposals.start_proposal', return_value=draft) as start:
            res = self.client.post(f'/api/bookings/leads/{self.lead.id}/draft-proposal/')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], ProposalDraft.QUESTIONS_PENDING)
        self.assertEqual(res.data['questions'][0]['id'], 'event_date')
        start.assert_called_once()

    @override_settings(**CONFIGURED)
    def test_answer_resumes_and_returns_drafted(self):
        _enable(self.org)
        draft = _draft(self.org, self.lead, status=ProposalDraft.QUESTIONS_PENDING)
        drafted = _draft(self.org, self.lead, status=ProposalDraft.DRAFTED)
        with patch('bookings.views.proposals.resume_proposal', return_value=drafted) as resume:
            res = self.client.post(
                f'/api/bookings/proposal-drafts/{draft.id}/answer/',
                {'answers': {'event_date': '2026-09-12'}}, format='json',
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], ProposalDraft.DRAFTED)
        resume.assert_called_once()

    @override_settings(**CONFIGURED)
    def test_draft_is_org_scoped(self):
        # A draft belonging to org B is invisible to org A (404), agent never called.
        other = Organisation.objects.create(name='Org B', slug='org-b')
        other_lead = Lead.objects.create(organisation=other, contact_name='Rival')
        b_draft = _draft(other, other_lead, status=ProposalDraft.QUESTIONS_PENDING)
        _enable(self.org)
        with override_settings(**CONFIGURED):
            with patch('bookings.views.proposals.resume_proposal') as resume:
                res = self.client.post(
                    f'/api/bookings/proposal-drafts/{b_draft.id}/answer/',
                    {'answers': {}}, format='json',
                )
        self.assertEqual(res.status_code, 404)
        resume.assert_not_called()

    def test_quote_prose_fields_are_read_only(self):
        # Agent-authored: a client must not be able to write proposal prose/assumptions
        # (a forged non-list assumptions would crash the editor panel).
        from bookings.serializers.quotes import QuoteSerializer
        s = QuoteSerializer()
        self.assertTrue(s.fields['proposal_prose'].read_only)
        self.assertTrue(s.fields['proposal_assumptions'].read_only)

    @override_settings(**CONFIGURED)
    def test_detail_read_is_org_scoped(self):
        other = Organisation.objects.create(name='Org B', slug='org-b')
        other_lead = Lead.objects.create(organisation=other, contact_name='Rival')
        b_draft = _draft(other, other_lead, status=ProposalDraft.DRAFTED)
        res = self.client.get(f'/api/bookings/proposal-drafts/{b_draft.id}/')
        self.assertEqual(res.status_code, 404)
