"""AI follow-up drafts: stale detection, agent loop, review/approve API."""
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.models import FollowUpDraft, Lead, OrgSettings, WhatsAppMessage
from bookings.services import followup_scheduler
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
class FollowupSchedulerTests(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        _configure_ai(self.org)

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_creates_pending_draft_for_stale_lead(self, mock_draft):
        lead = _stale_lead(self.org)
        summary = followup_scheduler.run_for_org(self.org)
        self.assertEqual(summary['created'], 1)
        draft = FollowUpDraft.objects.get(lead=lead)
        self.assertEqual(draft.status, 'pending')
        self.assertEqual(draft.body, DRAFT_OK['message'])
        self.assertEqual(draft.model_used, 'claude-haiku-4-5')

    @override_settings(TWILIO_ACCOUNT_SID='', TWILIO_AUTH_TOKEN='')
    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_drafts_even_without_twilio(self, mock_draft):
        # Twilio not configured: the agent still drafts (delivery is separate).
        lead = _stale_lead(self.org)
        summary = followup_scheduler.run_for_org(self.org)
        self.assertEqual(summary['created'], 1)
        self.assertTrue(FollowUpDraft.objects.filter(lead=lead, status='pending').exists())

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_SKIP)
    def test_agent_can_skip(self, mock_draft):
        _stale_lead(self.org)
        followup_scheduler.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.count(), 0)

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_cap_counts_only_sent_followups(self, mock_draft):
        s = OrgSettings.for_org(self.org)
        s.followup_max_drafts_per_lead = 2
        s.save()
        lead = _stale_lead(self.org)
        long_ago = timezone.now() - timedelta(days=30)
        for body in ('1', '2'):
            FollowUpDraft.objects.create(
                organisation=self.org, lead=lead, body=body,
                status='sent', reviewed_at=long_ago,
            )
        followup_scheduler.run_for_org(self.org)
        # 2 follow-ups SENT already → quit; no new draft
        self.assertEqual(FollowUpDraft.objects.filter(lead=lead, status='pending').count(), 0)

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_dismissed_drafts_do_not_burn_the_budget(self, mock_draft):
        s = OrgSettings.for_org(self.org)
        s.followup_max_drafts_per_lead = 2
        s.save()
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(organisation=self.org, lead=lead, body='1', status='dismissed')
        FollowUpDraft.objects.create(organisation=self.org, lead=lead, body='2', status='dismissed')
        followup_scheduler.run_for_org(self.org)
        # dismissed drafts don't count toward the sent cap → a fresh draft is made
        self.assertEqual(FollowUpDraft.objects.filter(lead=lead, status='pending').count(), 1)

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_spacing_no_new_draft_soon_after_a_send(self, mock_draft):
        # A follow-up sent yesterday: the lead record is stale, but the send
        # clock isn't — no new draft until the threshold passes again.
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, body='sent recently',
            status='sent', reviewed_at=timezone.now() - timedelta(days=1),
        )
        followup_scheduler.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.filter(lead=lead, status='pending').count(), 0)
        mock_draft.assert_not_called()

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_no_followups_after_the_event_date(self, mock_draft):
        _stale_lead(self.org, contact_name='Past Event',
                    event_date=timezone.now().date() - timedelta(days=2))
        followup_scheduler.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.count(), 0)
        mock_draft.assert_not_called()

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_escalating_gaps_second_stage_waits_longer(self, mock_draft):
        # First follow-up sent 5 days ago: past the 3-day first gap but inside
        # the 7-day second gap — the cadence says wait.
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, body='fu1', status='sent',
            reviewed_at=timezone.now() - timedelta(days=5),
        )
        followup_scheduler.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.filter(status='pending').count(), 0)
        # ...and once 8 days have passed, stage two opens.
        FollowUpDraft.objects.filter(lead=lead).update(
            reviewed_at=timezone.now() - timedelta(days=8))
        followup_scheduler.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.filter(status='pending').count(), 1)

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_unanswered_reply_reenters_the_cadence(self, mock_draft):
        # The lead replied, nobody answered for longer than the first gap:
        # the lead is eligible again (the draft will acknowledge the reply).
        lead = _stale_lead(self.org)
        msg = WhatsAppMessage.objects.create(
            organisation=self.org, lead=lead, direction='inbound', body='ok thanks',
        )
        WhatsAppMessage.objects.filter(pk=msg.pk).update(
            created_at=timezone.now() - timedelta(days=4))
        followup_scheduler.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.filter(lead=lead, status='pending').count(), 1)

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_never_chases_a_lead_who_spoke_last(self, mock_draft):
        lead = _stale_lead(self.org)
        WhatsAppMessage.objects.create(
            organisation=self.org, lead=lead, direction='outbound', body='Us: hello',
        )
        WhatsAppMessage.objects.create(
            organisation=self.org, lead=lead, direction='inbound', body='Lead: one sec',
        )
        followup_scheduler.run_for_org(self.org)
        # the lead spoke last — a human should reply, never the agent
        self.assertEqual(FollowUpDraft.objects.filter(lead=lead).count(), 0)
        mock_draft.assert_not_called()

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_skips_lead_with_existing_pending_draft(self, mock_draft):
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(organisation=self.org, lead=lead, body='waiting', status='pending')
        followup_scheduler.run_for_org(self.org)
        mock_draft.assert_not_called()

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_skips_lead_without_phone(self, mock_draft):
        _stale_lead(self.org, contact_phone='')
        followup_scheduler.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.count(), 0)

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_dry_run_writes_nothing(self, mock_draft):
        _stale_lead(self.org)
        summary = followup_scheduler.run_for_org(self.org, dry_run=True)
        self.assertEqual(summary['created'], 1)
        self.assertEqual(FollowUpDraft.objects.count(), 0)
        mock_draft.assert_not_called()

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_unconfigured_org_skipped(self, mock_draft):
        other = Organisation.objects.create(name='NoAI', slug='no-ai', country='PK')
        _stale_lead(other)
        summary = followup_scheduler.run_for_org(other)
        self.assertEqual(summary.get('skipped'), 'not configured')
        self.assertEqual(FollowUpDraft.objects.count(), 0)

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_run_all_only_configured_orgs(self, mock_draft):
        _stale_lead(self.org)
        other = Organisation.objects.create(name='NoAI', slug='no-ai', country='PK')
        _stale_lead(other)
        summaries = followup_scheduler.run_all()
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

    @patch('bookings.services.followup_scheduler.draft_followup', return_value=DRAFT_OK)
    def test_dry_run_command_writes_nothing(self, mock_draft):
        _stale_lead(self.org)
        call_command('run_followups', '--dry-run')
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


@platform_creds
class FollowUpPreviewTests(TestCase):
    """GET /followup-drafts/preview/ — eligibility + role scoping."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        _configure_ai(self.org)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_preview_lists_only_eligible_leads(self):
        eligible = _stale_lead(self.org, contact_name='Eligible')
        _stale_lead(self.org, contact_name='NoPhone', contact_phone='')
        _stale_lead(self.org, contact_name='Won', status='won')
        Lead.objects.create(organisation=self.org, contact_name='Fresh',
                            contact_phone='+15550000001', status='new')
        pending = _stale_lead(self.org, contact_name='HasPending')
        FollowUpDraft.objects.create(organisation=self.org, lead=pending, body='x')

        res = self.client.get('/api/bookings/followup-drafts/preview/')
        self.assertEqual(res.status_code, 200)
        rows = res.json()['leads']
        self.assertEqual([r['id'] for r in rows], [eligible.id])
        row = rows[0]
        self.assertEqual(row['contact_name'], 'Eligible')
        self.assertGreaterEqual(row['days_stale'], 29)
        self.assertIn('status', row)
        self.assertIn('event_date', row)
        self.assertIn('budget', row)
        self.assertIn('assigned_to_name', row)

    def test_preview_excludes_leads_at_the_draft_cap(self):
        s = OrgSettings.for_org(self.org)
        s.followup_max_drafts_per_lead = 1
        s.save()
        capped = _stale_lead(self.org, contact_name='Capped')
        FollowUpDraft.objects.create(
            organisation=self.org, lead=capped, body='old', status='sent',
            reviewed_at=timezone.now() - timedelta(days=30),
        )
        res = self.client.get('/api/bookings/followup-drafts/preview/')
        self.assertEqual(res.json()['leads'], [])

    def test_preview_sorted_most_stale_first(self):
        newer = _stale_lead(self.org, contact_name='Newer')
        older = _stale_lead(self.org, contact_name='Older')
        Lead.objects.filter(pk=older.pk).update(
            updated_at=timezone.now() - timedelta(days=90))
        res = self.client.get('/api/bookings/followup-drafts/preview/')
        self.assertEqual([r['id'] for r in res.json()['leads']],
                         [older.id, newer.id])

    def test_salesperson_sees_only_their_own_leads(self):
        rep = User.objects.create(
            email='rep@preview.test', first_name='Rep', last_name='One',
            role='salesperson', organisation=self.org,
        )
        mine = _stale_lead(self.org, contact_name='Mine', assigned_to=rep)
        _stale_lead(self.org, contact_name='NotMine')
        client = APIClient()
        client.force_authenticate(user=rep)
        res = client.get('/api/bookings/followup-drafts/preview/')
        self.assertEqual([r['id'] for r in res.json()['leads']], [mine.id])

    def test_preview_is_org_scoped(self):
        other_org = Organisation.objects.create(name='Other Preview Co', slug='other-preview-co')
        _stale_lead(other_org, contact_name='Foreign')
        res = self.client.get('/api/bookings/followup-drafts/preview/')
        names = [r['contact_name'] for r in res.json()['leads']]
        self.assertNotIn('Foreign', names)

    def test_preview_reports_configuration(self):
        res = self.client.get('/api/bookings/followup-drafts/preview/')
        body = res.json()
        self.assertTrue(body['configured'])
        self.assertEqual(body['first_gap_days'],
                         OrgSettings.for_org(self.org).followup_gap_first_days)


@platform_creds
class FollowUpGenerateTests(TestCase):
    """POST /followup-drafts/generate/ — one lead per call, re-validated."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        _configure_ai(self.org)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _generate(self, lead):
        return self.client.post('/api/bookings/followup-drafts/generate/',
                                {'lead': lead.pk}, format='json')

    @patch('bookings.views.followups.draft_followup', return_value=DRAFT_OK)
    def test_creates_draft_for_selected_lead(self, mock_draft):
        lead = _stale_lead(self.org)
        res = self._generate(lead)
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body['status'], 'created')
        self.assertEqual(body['draft']['body'], DRAFT_OK['message'])
        self.assertEqual(FollowUpDraft.objects.filter(lead=lead, status='pending').count(), 1)

    @patch('bookings.views.followups.draft_followup', return_value=DRAFT_SKIP)
    def test_reports_ai_skip_with_reasoning(self, mock_draft):
        lead = _stale_lead(self.org)
        res = self._generate(lead)
        body = res.json()
        self.assertEqual(body['status'], 'skipped')
        self.assertEqual(body['reasoning'], DRAFT_SKIP['reasoning'])
        self.assertFalse(FollowUpDraft.objects.filter(lead=lead).exists())

    @patch('bookings.views.followups.draft_followup', return_value=DRAFT_OK)
    def test_revalidates_eligibility_at_generate_time(self, mock_draft):
        # Lead was in the preview, but got touched before confirm — no draft.
        lead = _stale_lead(self.org)
        Lead.objects.filter(pk=lead.pk).update(updated_at=timezone.now())
        res = self._generate(lead)
        self.assertEqual(res.json()['status'], 'ineligible')
        mock_draft.assert_not_called()

    @patch('bookings.views.followups.draft_followup', return_value=DRAFT_OK)
    def test_salesperson_cannot_generate_for_others_lead(self, mock_draft):
        rep = User.objects.create(
            email='rep@gen.test', first_name='Rep', last_name='Two',
            role='salesperson', organisation=self.org,
        )
        others_lead = _stale_lead(self.org)  # unassigned — not the rep's
        client = APIClient()
        client.force_authenticate(user=rep)
        res = client.post('/api/bookings/followup-drafts/generate/',
                          {'lead': others_lead.pk}, format='json')
        self.assertEqual(res.json()['status'], 'ineligible')
        mock_draft.assert_not_called()

    def test_rejects_other_orgs_lead(self):
        other_org = Organisation.objects.create(name='Other Gen Co', slug='other-gen-co')
        foreign = _stale_lead(other_org)
        res = self._generate(foreign)
        self.assertEqual(res.status_code, 404)

    @override_settings(OPENAI_API_KEY='')
    def test_rejects_when_not_configured(self):
        lead = _stale_lead(self.org)
        res = self._generate(lead)
        self.assertEqual(res.status_code, 400)

    @patch('bookings.views.followups.draft_followup', return_value=None)
    def test_reports_llm_failure(self, mock_draft):
        lead = _stale_lead(self.org)
        res = self._generate(lead)
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.json()['status'], 'failed')


class DrafterContextTests(TestCase):
    """What the AI is told about a lead."""

    def setUp(self):
        self.org = get_test_user().organisation

    def test_context_includes_title_when_set(self):
        from bookings.services.followup_drafter import _build_context
        lead = _stale_lead(self.org, contact_name='Batool Rizvi', contact_title='Ms')
        ctx = _build_context(lead)
        self.assertIn('Contact title: Ms', ctx)
        self.assertIn('Contact name: Batool Rizvi', ctx)

    def test_context_omits_title_when_absent(self):
        from bookings.services.followup_drafter import _build_context
        lead = _stale_lead(self.org, contact_name='Sam Jones')
        self.assertNotIn('Contact title', _build_context(lead))

    def test_context_carries_the_followup_ledger_not_the_status(self):
        from bookings.services.followup_drafter import _build_context
        lead = _stale_lead(self.org, contact_name='Sam Jones')
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, body='x', status='sent',
            reviewed_at=timezone.now() - timedelta(days=9),
        )
        ctx = _build_context(lead)
        self.assertIn('Follow-ups already sent to this lead: 1', ctx)
        self.assertIn('Most recent follow-up sent:', ctx)
        self.assertIn('The lead has never replied on WhatsApp.', ctx)
        # pipeline status is aspiration, not fact — it is no longer shared
        self.assertNotIn('pipeline status', ctx)

    def test_context_includes_the_business_name(self):
        from bookings.services.followup_drafter import _build_context
        lead = _stale_lead(self.org, contact_name='Sam Jones')
        self.assertIn(f'Our business name: {self.org.name}', _build_context(lead))


@platform_creds
class DraftRoleScopeTests(TestCase):
    """Salespeople only see and act on drafts for their own leads."""

    def setUp(self):
        self.owner = get_test_user()
        self.org = self.owner.organisation
        _configure_ai(self.org)
        self.rep = User.objects.create(
            email='rep@scope.test', first_name='Rep', last_name='Scope',
            role='salesperson', organisation=self.org,
        )
        mine = _stale_lead(self.org, contact_name='Mine', assigned_to=self.rep)
        other = _stale_lead(self.org, contact_name='NotMine')
        self.my_draft = FollowUpDraft.objects.create(
            organisation=self.org, lead=mine, body='mine')
        self.other_draft = FollowUpDraft.objects.create(
            organisation=self.org, lead=other, body='not mine')
        self.client = APIClient()
        self.client.force_authenticate(user=self.rep)

    def test_salesperson_list_and_count_show_only_their_drafts(self):
        res = self.client.get('/api/bookings/followup-drafts/')
        body = res.json()
        rows = body['results'] if isinstance(body, dict) else body
        self.assertEqual([d['id'] for d in rows], [self.my_draft.id])
        count = self.client.get('/api/bookings/followup-drafts/count/').json()
        self.assertEqual(count['pending'], 1)

    def test_salesperson_cannot_approve_or_dismiss_others_draft(self):
        res = self.client.post(f'/api/bookings/followup-drafts/{self.other_draft.id}/approve/')
        self.assertEqual(res.status_code, 404)
        res = self.client.post(f'/api/bookings/followup-drafts/{self.other_draft.id}/dismiss/')
        self.assertEqual(res.status_code, 404)
        self.other_draft.refresh_from_db()
        self.assertEqual(self.other_draft.status, 'pending')

    def test_salesperson_can_dismiss_their_own(self):
        res = self.client.post(f'/api/bookings/followup-drafts/{self.my_draft.id}/dismiss/')
        self.assertEqual(res.status_code, 200)

    def test_manager_sees_the_whole_orgs_drafts(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)
        res = client.get('/api/bookings/followup-drafts/')
        body = res.json()
        rows = body['results'] if isinstance(body, dict) else body
        self.assertEqual({d['id'] for d in rows}, {self.my_draft.id, self.other_draft.id})


class DrafterQuoteContextTests(TestCase):
    """The AI is told about quotes as facts — sent vs internal-draft."""

    def setUp(self):
        self.org = get_test_user().organisation

    def _lead_with_quote(self, status):
        from bookings.tests import make_account, make_contact, make_quote
        lead = _stale_lead(self.org, contact_name='Quoted Lead')
        account = make_account(org=self.org)
        contact = make_contact(account=account, org=self.org)
        make_quote(org=self.org, account=account, primary_contact=contact,
                   lead=lead, status=status)
        return lead

    def test_sent_quote_is_a_stated_fact(self):
        from bookings.services.followup_drafter import _build_context
        ctx = _build_context(self._lead_with_quote('sent'))
        self.assertIn('A quotation WAS SENT to the lead', ctx)

    def test_draft_quote_is_marked_unseen(self):
        from bookings.services.followup_drafter import _build_context
        ctx = _build_context(self._lead_with_quote('draft'))
        self.assertIn('NOT sent', ctx)
        self.assertIn('do not refer to it', ctx)

    def test_no_quote_no_quote_lines(self):
        from bookings.services.followup_drafter import _build_context
        lead = _stale_lead(self.org, contact_name='Unquoted')
        self.assertNotIn('Quotations', _build_context(lead))


class DraftSerializerSummaryTests(TestCase):
    """The review queue carries a compact lead summary per draft."""

    def test_draft_rows_include_lead_summary(self):
        org = get_test_user().organisation
        rep = User.objects.create(
            email='rep@summary.test', first_name='Rep', last_name='Sum',
            role='salesperson', organisation=org,
        )
        lead = _stale_lead(org, contact_name='Summ Lead', assigned_to=rep,
                           event_type='wedding',
                           event_date=timezone.now().date() + timedelta(days=60),
                           guest_estimate=250)
        FollowUpDraft.objects.create(organisation=org, lead=lead, body='hi')
        client = APIClient()
        client.force_authenticate(user=get_test_user())
        res = client.get('/api/bookings/followup-drafts/')
        body = res.json()
        row = (body['results'] if isinstance(body, dict) else body)[0]
        self.assertEqual(row['lead_event_type'], 'wedding')
        self.assertEqual(row['lead_guest_estimate'], 250)
        self.assertEqual(row['lead_assigned_to_name'], 'Rep Sum')
        self.assertGreaterEqual(row['lead_days_stale'], 29)


class DrafterOccasionTests(TestCase):
    """The event line carries the org's configured LABEL, not the raw value."""

    def setUp(self):
        self.org = get_test_user().organisation

    def test_event_line_uses_the_orgs_label(self):
        from bookings.models.choices import EventTypeOption
        from bookings.services.followup_drafter import _build_context
        EventTypeOption.objects.create(
            organisation=self.org, value='mehndi_mayoon',
            label='Mehndi / Mayoon / Qawali Night',
        )
        lead = _stale_lead(self.org, contact_name='Bisma Abbasi',
                           event_type='mehndi_mayoon')
        ctx = _build_context(lead)
        self.assertIn('Event type: Mehndi / Mayoon / Qawali Night', ctx)
        self.assertNotIn('mehndi_mayoon', ctx)

    def test_unknown_value_falls_back_to_raw(self):
        from bookings.services.followup_drafter import _build_context
        lead = _stale_lead(self.org, contact_name='Sam', event_type='zz_unmapped')
        self.assertIn('Event type: zz_unmapped', _build_context(lead))


class DaysQuietTests(TestCase):
    """'Days quiet' shows the same three-clock measure the scheduler uses."""

    def test_sent_followup_resets_the_display_clock(self):
        from bookings.services.followup_scheduler import lead_last_touch
        org = get_test_user().organisation
        lead = _stale_lead(org)  # record untouched for 30 days
        FollowUpDraft.objects.create(
            organisation=org, lead=lead, body='x', status='sent',
            reviewed_at=timezone.now() - timedelta(days=2),
        )
        quiet_days = (timezone.now() - lead_last_touch(lead)).days
        self.assertEqual(quiet_days, 2)


@platform_creds
class WhatsAppShortcutEndpointTests(TestCase):
    """Mark-sent, log-reply, quote-share: the manual (shortcut) channel keeps
    the ledger as truthful as the Twilio path would."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        _configure_ai(self.org)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_mark_sent_flips_draft_and_feeds_the_ledger(self):
        lead = _stale_lead(self.org)
        draft = FollowUpDraft.objects.create(organisation=self.org, lead=lead, body='original')
        res = self.client.post(
            f'/api/bookings/followup-drafts/{draft.id}/mark-sent/',
            {'body': 'edited before sending'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'sent')
        self.assertEqual(draft.body, 'edited before sending')
        msg = WhatsAppMessage.objects.get(lead=lead)
        self.assertEqual(msg.direction, 'outbound')
        self.assertEqual(msg.body, 'edited before sending')
        self.assertEqual(msg.from_phone, 'manual')
        # ledger effects: days-quiet resets, and the sent count blocks re-drafting
        from bookings.services.followup_scheduler import lead_last_touch
        self.assertEqual((timezone.now() - lead_last_touch(lead)).days, 0)

    def test_mark_sent_respects_role_scope(self):
        rep = User.objects.create(
            email='rep@shortcut.test', first_name='R', last_name='S',
            role='salesperson', organisation=self.org)
        others = _stale_lead(self.org)
        draft = FollowUpDraft.objects.create(organisation=self.org, lead=others, body='x')
        client = APIClient()
        client.force_authenticate(user=rep)
        res = client.post(f'/api/bookings/followup-drafts/{draft.id}/mark-sent/')
        self.assertEqual(res.status_code, 404)

    def test_log_reply_pauses_the_agent(self):
        lead = _stale_lead(self.org)
        res = self.client.post(f'/api/bookings/leads/{lead.id}/log-reply/')
        self.assertEqual(res.status_code, 200)
        msg = WhatsAppMessage.objects.get(lead=lead)
        self.assertEqual(msg.direction, 'inbound')
        # the lead spoke last → excluded from generation
        from bookings.services import followup_scheduler
        s = OrgSettings.for_org(self.org)
        self.assertNotIn(lead.id, [
            l.id for l in followup_scheduler.find_stale_leads(self.org, s)])

    def test_quote_share_flips_status_and_logs_on_both(self):
        from bookings.tests import make_account, make_contact, make_quote
        lead = _stale_lead(self.org)
        account = make_account(org=self.org)
        contact = make_contact(account=account, org=self.org)
        quote = make_quote(org=self.org, account=account, primary_contact=contact,
                           lead=lead, status='draft')
        res = self.client.post(
            f'/api/bookings/quotes/{quote.id}/mark-shared-whatsapp/',
            {'body': 'Hello, sharing your quotation.'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        quote.refresh_from_db()
        self.assertEqual(quote.status, 'sent')
        self.assertTrue(WhatsAppMessage.objects.filter(lead=lead, direction='outbound').exists())
        # the AI's quote facts become true
        from bookings.services.followup_drafter import _build_context
        self.assertIn('A quotation WAS SENT', _build_context(lead))
