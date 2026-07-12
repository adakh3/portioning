"""AI follow-up drafts: stale detection, agent loop, review/approve API."""
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.models import FollowUpDraft, Lead, OrgSettings, WhatsAppMessage
from bookings.services import followup_agent
from bookings.tests import _authenticated_client
from tests.base import get_test_user
from users.models import Organisation, User

# Twilio account + LLM config are platform-level (env), not per-org. Tests
# that need a "configured" org set the org's WhatsApp number here and supply the
# platform credentials via @platform_creds.
platform_creds = override_settings(
    TWILIO_ACCOUNT_SID='AC123',
    TWILIO_AUTH_TOKEN='twilio-secret',
    LLM_FOLLOWUP_DRAFTER='openai:gpt-test',
    OPENAI_API_KEY='sk-openai-test',
)


def _configure_ai(org):
    s = OrgSettings.for_org(org)
    s.ai_followups_enabled = True
    s.whatsapp_enabled = True
    s.twilio_whatsapp_number = '+14155238886'
    s.save()
    return s


def _stale_lead(org, **kwargs):
    kwargs.setdefault('contact_name', 'Sam')
    kwargs.setdefault('contact_phone', '+15551234567')
    kwargs.setdefault('status', 'contacted')
    lead = Lead.objects.create(organisation=org, **kwargs)
    old = timezone.now() - timedelta(days=30)
    Lead.objects.filter(pk=lead.pk).update(updated_at=old)
    lead.refresh_from_db()
    return lead


DRAFT_OK = {'should_follow_up': True, 'message': 'Hi Sam, just checking in!',
            'reasoning': 'No reply in a month.', 'model_used': 'claude-haiku-4-5'}
DRAFT_SKIP = {'should_follow_up': False, 'message': '', 'reasoning': 'Just messaged.'}


class StaleQuerysetTests(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation

    def test_stale_excludes_terminal_and_recent(self):
        stale = _stale_lead(self.org)
        _stale_lead(self.org, status='won')          # terminal — excluded
        _stale_lead(self.org, status='lost')         # terminal — excluded
        Lead.objects.create(organisation=self.org, contact_name='Fresh', status='new')  # recent

        cutoff = timezone.now() - timedelta(hours=168)
        ids = set(Lead.objects.for_org(self.org).stale(cutoff).values_list('id', flat=True))
        self.assertEqual(ids, {stale.id})


@platform_creds
class FollowupAgentTests(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        _configure_ai(self.org)

    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_OK)
    def test_creates_pending_draft_for_stale_lead(self, mock_draft):
        lead = _stale_lead(self.org)
        summary = followup_agent.run_for_org(self.org)
        self.assertEqual(summary['created'], 1)
        draft = FollowUpDraft.objects.get(lead=lead)
        self.assertEqual(draft.status, 'pending')
        self.assertEqual(draft.body, DRAFT_OK['message'])
        self.assertEqual(draft.model_used, 'claude-haiku-4-5')

    @override_settings(TWILIO_ACCOUNT_SID='', TWILIO_AUTH_TOKEN='')
    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_OK)
    def test_drafts_even_without_twilio(self, mock_draft):
        # Twilio not configured: the agent still drafts (delivery is separate).
        lead = _stale_lead(self.org)
        summary = followup_agent.run_for_org(self.org)
        self.assertEqual(summary['created'], 1)
        self.assertTrue(FollowUpDraft.objects.filter(lead=lead, status='pending').exists())

    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_SKIP)
    def test_agent_can_skip(self, mock_draft):
        _stale_lead(self.org)
        followup_agent.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.count(), 0)

    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_OK)
    def test_respects_per_lead_cap(self, mock_draft):
        s = OrgSettings.for_org(self.org)
        s.followup_max_drafts_per_lead = 2
        s.save()
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(organisation=self.org, lead=lead, body='1', status='dismissed')
        FollowUpDraft.objects.create(organisation=self.org, lead=lead, body='2', status='dismissed')
        followup_agent.run_for_org(self.org)
        # cap of 2 already reached → no new draft
        self.assertEqual(FollowUpDraft.objects.filter(lead=lead, status='pending').count(), 0)

    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_OK)
    def test_skips_lead_with_existing_pending_draft(self, mock_draft):
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(organisation=self.org, lead=lead, body='waiting', status='pending')
        followup_agent.run_for_org(self.org)
        mock_draft.assert_not_called()

    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_OK)
    def test_skips_lead_without_phone(self, mock_draft):
        _stale_lead(self.org, contact_phone='')
        followup_agent.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.count(), 0)

    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_OK)
    def test_dry_run_writes_nothing(self, mock_draft):
        _stale_lead(self.org)
        summary = followup_agent.run_for_org(self.org, dry_run=True)
        self.assertEqual(summary['created'], 1)
        self.assertEqual(FollowUpDraft.objects.count(), 0)
        mock_draft.assert_not_called()

    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_OK)
    def test_unconfigured_org_skipped(self, mock_draft):
        other = Organisation.objects.create(name='NoAI', slug='no-ai', country='PK')
        _stale_lead(other)
        summary = followup_agent.run_for_org(other)
        self.assertEqual(summary.get('skipped'), 'not configured')
        self.assertEqual(FollowUpDraft.objects.count(), 0)

    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_OK)
    def test_run_all_only_configured_orgs(self, mock_draft):
        _stale_lead(self.org)
        other = Organisation.objects.create(name='NoAI', slug='no-ai', country='PK')
        _stale_lead(other)
        summaries = followup_agent.run_all()
        org_ids = {s['org'] for s in summaries}
        self.assertIn(self.org.id, org_ids)
        self.assertNotIn(other.id, org_ids)


def _fake_send(view_path='bookings.views.followups.WhatsAppService'):
    """Patch WhatsAppService so approve doesn't call Twilio; returns a real msg."""
    return patch(view_path)


@platform_creds
class FollowupApiTests(TestCase):
    BASE = '/api/bookings/followup-drafts/'

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        _configure_ai(self.org)
        self.client = _authenticated_client()
        self.lead = _stale_lead(self.org)
        self.draft = FollowUpDraft.objects.create(
            organisation=self.org, lead=self.lead, body='Hi Sam!', status='pending',
        )

    def test_queue_lists_pending(self):
        res = self.client.get(f'{self.BASE}?page_size=all')
        self.assertEqual(res.status_code, 200)
        ids = [d['id'] for d in res.json()]
        self.assertIn(self.draft.id, ids)

    def test_count(self):
        res = self.client.get(f'{self.BASE}count/')
        self.assertEqual(res.json()['pending'], 1)

    def test_lead_scoped_list(self):
        res = self.client.get(f'/api/bookings/leads/{self.lead.id}/followup-drafts/?page_size=all')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 1)

    def test_approve_sends_and_marks_sent(self):
        with _fake_send() as MockSvc:
            msg = WhatsAppMessage.objects.create(
                organisation=self.org, lead=self.lead, to_phone='x', from_phone='y',
                body='Hi Sam!', direction='outbound', status='sent',
            )
            MockSvc.return_value.send_message.return_value = msg
            res = self.client.post(f'{self.BASE}{self.draft.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'sent')
        self.assertEqual(self.draft.whatsapp_message_id, msg.id)
        self.assertEqual(self.draft.reviewed_by, self.user)

    def test_approve_with_edited_body(self):
        with _fake_send() as MockSvc:
            MockSvc.return_value.send_message.return_value = WhatsAppMessage.objects.create(
                organisation=self.org, lead=self.lead, to_phone='x', from_phone='y',
                body='edited', direction='outbound', status='sent',
            )
            self.client.post(f'{self.BASE}{self.draft.id}/approve/', {'body': 'Edited text'}, format='json')
            sent_body = MockSvc.return_value.send_message.call_args.args[1]
        self.assertEqual(sent_body, 'Edited text')
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.body, 'Edited text')

    @override_settings(TWILIO_ACCOUNT_SID='', TWILIO_AUTH_TOKEN='')
    def test_approve_without_whatsapp_fails_gracefully(self):
        # Draft exists but Twilio isn't configured: approve returns a clear
        # error and the draft stays pending (nothing lost).
        res = self.client.post(f'{self.BASE}{self.draft.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('WhatsApp', res.json()['detail'])
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'pending')

    def test_approve_non_pending_rejected(self):
        self.draft.status = 'dismissed'
        self.draft.save()
        res = self.client.post(f'{self.BASE}{self.draft.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_dismiss(self):
        res = self.client.post(f'{self.BASE}{self.draft.id}/dismiss/', {}, format='json')
        self.assertEqual(res.status_code, 200)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'dismissed')

    def test_bulk_approve(self):
        lead2 = _stale_lead(self.org, contact_name='Jo')
        draft2 = FollowUpDraft.objects.create(
            organisation=self.org, lead=lead2, body='Hi Jo!', status='pending',
        )
        with _fake_send() as MockSvc:
            MockSvc.return_value.send_message.side_effect = lambda lead, body, sent_by=None: (
                WhatsAppMessage.objects.create(
                    organisation=self.org, lead=lead, to_phone='x', from_phone='y',
                    body=body, direction='outbound', status='sent',
                )
            )
            res = self.client.post(f'{self.BASE}bulk-approve/', {}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(set(res.json()['sent']), {self.draft.id, draft2.id})
        self.assertEqual(FollowUpDraft.objects.filter(status='sent').count(), 2)

    def test_org_isolation(self):
        other = Organisation.objects.create(name='Other', slug='other', country='PK')
        other_lead = Lead.objects.create(organisation=other, contact_name='Z', contact_phone='+1')
        other_draft = FollowUpDraft.objects.create(
            organisation=other, lead=other_lead, body='secret', status='pending',
        )
        ids = [d['id'] for d in self.client.get(f'{self.BASE}?page_size=all').json()]
        self.assertNotIn(other_draft.id, ids)
        res = self.client.post(f'{self.BASE}{other_draft.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 404)


@platform_creds
class ManagementCommandTests(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        _configure_ai(self.org)

    @patch('bookings.services.followup_agent.draft_followup', return_value=DRAFT_OK)
    def test_dry_run_command_writes_nothing(self, mock_draft):
        _stale_lead(self.org)
        call_command('run_followup_agent', '--dry-run')
        self.assertEqual(FollowUpDraft.objects.count(), 0)


class OrgSettingsConfiguredTests(TestCase):
    @platform_creds
    def test_configured_requires_org_opt_in(self):
        org = get_test_user().organisation
        s = OrgSettings.for_org(org)
        self.assertFalse(s.ai_followups_configured)   # not opted in yet
        s.ai_followups_enabled = True
        s.save()
        self.assertTrue(OrgSettings.for_org(org).ai_followups_configured)

    @override_settings(LLM_FOLLOWUP_DRAFTER='openai:gpt-test', OPENAI_API_KEY='')
    def test_not_configured_without_provider_key(self):
        org = get_test_user().organisation
        _configure_ai(org)  # opted in, but no key for the configured provider
        self.assertFalse(OrgSettings.for_org(org).ai_followups_configured)

    @override_settings(LLM_FOLLOWUP_DRAFTER='anthropic:claude-test',
                       ANTHROPIC_API_KEY='sk-ant-test', OPENAI_API_KEY='')
    def test_configured_checks_the_selected_providers_key(self):
        # Only the provider named in LLM_FOLLOWUP_DRAFTER needs a key —
        # the other provider's key can be absent.
        org = get_test_user().organisation
        _configure_ai(org)
        self.assertTrue(OrgSettings.for_org(org).ai_followups_configured)

    @override_settings(TWILIO_ACCOUNT_SID='', TWILIO_AUTH_TOKEN='',
                       LLM_FOLLOWUP_DRAFTER='openai:gpt-test', OPENAI_API_KEY='sk-openai-test')
    def test_drafting_decoupled_from_twilio(self):
        # Twilio absent, but drafting is still allowed — delivery is a separate
        # concern handled at approve-time.
        org = get_test_user().organisation
        _configure_ai(org)
        s = OrgSettings.for_org(org)
        self.assertFalse(s.twilio_configured)
        self.assertTrue(s.ai_followups_configured)
