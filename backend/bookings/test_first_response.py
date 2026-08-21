"""AI first response on lead creation (REL-515).

Speed-to-lead: a brand-new lead is flagged at creation (both the manual/API path
and Meta lead-ads ingestion), a frequent cron drafts a first reply into the same
approve-and-send queue as follow-ups (a FollowUpDraft with kind='first_response'),
and a human always approves. Nothing is auto-sent.
"""
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.models import FollowUpDraft, Lead, OrgSettings, WhatsAppMessage
from bookings.models.choices import LeadStatusOption
from bookings.services import first_response, followup_scheduler
from tests.base import get_test_user
from users.models import Organisation

# The drafting model is platform-level (env), same as follow-ups.
platform_creds = override_settings(
    LLM_FOLLOWUP_DRAFTER='openai:gpt-test',
    OPENAI_API_KEY='sk-openai-test',
)

DRAFT_OK = {
    'should_follow_up': True,
    'message': 'Hello Sam, thanks for reaching out about your wedding!',
    'subject': 'Your wedding catering',
    'reasoning': 'New enquiry — acknowledged and asked for the guest count.',
    'model_used': 'claude-haiku-4-5',
}
DRAFT_DECLINE = {
    'should_follow_up': False, 'message': '', 'subject': '',
    'reasoning': 'Contact data looks like junk.', 'model_used': 'claude-haiku-4-5',
}


def _enable(org, first_response_on=True):
    s = OrgSettings.for_org(org)
    s.first_response_enabled = first_response_on
    s.save()
    return s


def _new_lead(org, *, flagged=True, **kwargs):
    kwargs.setdefault('contact_name', 'Sam')
    kwargs.setdefault('contact_phone', '+15551234567')
    kwargs.setdefault('status', 'new')
    kwargs.setdefault('needs_first_response', flagged)
    return Lead.objects.create(organisation=org, **kwargs)


def _backdate_created(lead, delta):
    Lead.objects.filter(pk=lead.pk).update(created_at=timezone.now() - delta)


# ── Marking at creation (both trigger paths) ──

@platform_creds
class TestFirstResponseMarking(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_manual_create_flags_lead_when_enabled(self):
        _enable(self.org)
        resp = self.client.post('/api/bookings/leads/', {
            'contact_name': 'Manual Lead', 'contact_email': 'manual@example.com',
            'contact_phone': '+15551234567',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        lead = Lead.objects.get(pk=resp.data['id'])
        self.assertTrue(lead.needs_first_response)

    def test_manual_create_does_not_flag_when_disabled(self):
        _enable(self.org, first_response_on=False)
        resp = self.client.post('/api/bookings/leads/', {
            'contact_name': 'Manual Lead', 'contact_phone': '+15551234567',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertFalse(Lead.objects.get(pk=resp.data['id']).needs_first_response)

    def test_mark_helper_is_idempotent_and_single_field(self):
        _enable(self.org)
        lead = _new_lead(self.org, flagged=False)
        first_response.mark_lead_for_first_response(lead)
        self.assertTrue(Lead.objects.get(pk=lead.pk).needs_first_response)
        # Second call is a no-op (already flagged) — no crash, still flagged.
        first_response.mark_lead_for_first_response(lead)
        self.assertTrue(Lead.objects.get(pk=lead.pk).needs_first_response)


@platform_creds
@override_settings(
    META_LEADS_ENABLED=True, META_APP_ID='app-id', META_APP_SECRET='app-secret',
)
class TestMetaIngestionFlags(TestCase):
    """The Meta path flags a NEW lead but never the request-time LLM (marking only)."""

    def setUp(self):
        from bookings.models import ConnectedMetaPage, MetaAccountConnection
        self.org = get_test_user().organisation
        conn = MetaAccountConnection(organisation=self.org)
        conn.user_access_token = 'user-token'
        conn.save()
        self.page = ConnectedMetaPage(
            organisation=self.org, connection=conn, page_id='PAGE1', page_name='Vinci',
        )
        self.page.page_access_token = 'page-token'
        self.page.save()

    def _raw(self, leadgen_id='LEAD1', email='jane@example.com'):
        return {
            'id': leadgen_id, 'created_time': '2026-08-16T10:00:00+0000', 'platform': 'fb',
            'field_data': [
                {'name': 'full_name', 'values': ['Jane Doe']},
                {'name': 'email', 'values': [email]},
            ],
        }

    def test_new_meta_lead_is_flagged_when_enabled(self):
        _enable(self.org)
        from bookings.services import meta_leads
        lead, created = meta_leads._build_lead(self.page, self._raw())
        self.assertTrue(created)
        self.assertTrue(lead.needs_first_response)

    def test_meta_lead_not_flagged_when_disabled(self):
        _enable(self.org, first_response_on=False)
        from bookings.services import meta_leads
        lead, _created = meta_leads._build_lead(self.page, self._raw())
        self.assertFalse(lead.needs_first_response)

    def test_deduped_existing_lead_is_not_flagged(self):
        """A submission matching an existing OPEN lead dedups — no first response
        for a contact we already have."""
        _enable(self.org)
        existing = Lead.objects.create(
            organisation=self.org, contact_name='Jane', contact_email='jane@example.com',
            status='contacted', needs_first_response=False,
        )
        from bookings.services import meta_leads
        lead, created = meta_leads._build_lead(self.page, self._raw())
        self.assertFalse(created)
        self.assertEqual(lead.pk, existing.pk)
        self.assertFalse(Lead.objects.get(pk=existing.pk).needs_first_response)


# ── Eligibility + drafting ──

@platform_creds
class TestFirstResponseRun(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        _enable(self.org)

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_phone_only_lead_gets_a_whatsapp_first_response(self, mock_draft):
        lead = _new_lead(self.org, contact_email='')
        summary = first_response.run_for_org(self.org)
        self.assertEqual(summary['created'], 1)
        draft = FollowUpDraft.objects.get(lead=lead)
        self.assertEqual(draft.kind, FollowUpDraft.KIND_FIRST_RESPONSE)
        self.assertEqual(draft.channel, WhatsAppMessage.CHANNEL_WHATSAPP)
        self.assertEqual(draft.status, 'pending')
        self.assertEqual(draft.body, DRAFT_OK['message'])
        # Flag cleared once drafted.
        self.assertFalse(Lead.objects.get(pk=lead.pk).needs_first_response)

    @patch('bookings.services.first_response.email_service.mailbox_is_usable', return_value=True)
    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_lead_with_email_gets_an_email_first_response(self, mock_draft, _mbox):
        lead = _new_lead(self.org, contact_email='sam@example.com', contact_phone='')
        first_response.run_for_org(self.org)
        draft = FollowUpDraft.objects.get(lead=lead)
        self.assertEqual(draft.channel, WhatsAppMessage.CHANNEL_EMAIL)
        self.assertEqual(draft.subject, DRAFT_OK['subject'])

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_unreachable_lead_gets_no_draft_and_no_error(self, mock_draft):
        _new_lead(self.org, contact_phone='', contact_email='')
        summary = first_response.run_for_org(self.org)
        self.assertEqual(summary['created'], 0)
        self.assertEqual(FollowUpDraft.objects.count(), 0)
        mock_draft.assert_not_called()

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_terminal_status_lead_is_ineligible(self, mock_draft):
        _new_lead(self.org, status='won')
        _new_lead(self.org, status='lost')
        summary = first_response.run_for_org(self.org)
        self.assertEqual(summary['created'], 0)

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_custom_terminal_status_is_ineligible(self, mock_draft):
        LeadStatusOption.objects.create(
            organisation=self.org, value='archived', label='Archived', is_lost=True,
        )
        _new_lead(self.org, status='archived')
        self.assertEqual(first_response.run_for_org(self.org)['created'], 0)

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_prior_outbound_message_makes_lead_ineligible(self, mock_draft):
        lead = _new_lead(self.org)
        WhatsAppMessage.objects.create(
            organisation=self.org, lead=lead, direction='outbound', body='hi',
            to_phone='whatsapp:+15551234567', from_phone='manual', status='sent',
        )
        self.assertEqual(first_response.run_for_org(self.org)['created'], 0)

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_prior_draft_of_any_kind_makes_lead_ineligible(self, mock_draft):
        lead = _new_lead(self.org)
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, kind=FollowUpDraft.KIND_FOLLOWUP,
            channel='whatsapp', body='earlier', status='pending',
        )
        self.assertEqual(first_response.run_for_org(self.org)['created'], 0)

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_lead_older_than_cutoff_is_skipped(self, mock_draft):
        lead = _new_lead(self.org)
        _backdate_created(lead, first_response.FIRST_RESPONSE_MAX_AGE + timedelta(hours=1))
        summary = first_response.run_for_org(self.org)
        self.assertEqual(summary['created'], 0)
        # Still flagged (we simply never drafted) — no draft written.
        self.assertEqual(FollowUpDraft.objects.count(), 0)

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_DECLINE)
    def test_model_decline_clears_flag_and_writes_no_draft(self, mock_draft):
        lead = _new_lead(self.org)
        summary = first_response.run_for_org(self.org)
        self.assertEqual(summary['created'], 0)
        self.assertEqual(FollowUpDraft.objects.count(), 0)
        # Flag cleared so we never re-call the model for this lead.
        self.assertFalse(Lead.objects.get(pk=lead.pk).needs_first_response)
        first_response.run_for_org(self.org)
        self.assertEqual(mock_draft.call_count, 1)

    @patch('bookings.services.first_response.draft_first_response', return_value=None)
    def test_transient_llm_failure_keeps_flag_for_retry(self, mock_draft):
        lead = _new_lead(self.org)
        first_response.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.count(), 0)
        # Flag intact → a later tick retries.
        self.assertTrue(Lead.objects.get(pk=lead.pk).needs_first_response)

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_second_cron_tick_does_not_double_draft(self, mock_draft):
        _new_lead(self.org)
        first_response.run_for_org(self.org)
        first_response.run_for_org(self.org)
        self.assertEqual(FollowUpDraft.objects.count(), 1)
        self.assertEqual(mock_draft.call_count, 1)

    def test_concurrent_tick_that_already_claimed_does_not_duplicate(self):
        """Two overlapping cron ticks: the second reads the lead as eligible and
        spends the LLM call, but by the time it goes to write, the first has
        already claimed (flag cleared) the lead. The atomic compare-and-swap must
        make the loser create NO draft — never a duplicate first response."""
        lead = _new_lead(self.org)

        def steal_then_return(_lead, channel):
            # Simulate the other tick winning the claim mid-LLM-call.
            Lead.objects.filter(pk=lead.pk).update(needs_first_response=False)
            return DRAFT_OK

        with patch('bookings.services.first_response.draft_first_response',
                   side_effect=steal_then_return):
            summary = first_response.run_for_org(self.org)
        self.assertEqual(summary['created'], 0)
        self.assertEqual(FollowUpDraft.objects.count(), 0)

    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_not_configured_org_skips(self, mock_draft):
        _enable(self.org, first_response_on=False)
        _new_lead(self.org)
        summary = first_response.run_for_org(self.org)
        self.assertEqual(summary.get('skipped'), 'not configured')
        mock_draft.assert_not_called()


@platform_creds
class TestFirstResponseRunAll(TestCase):
    @patch('bookings.services.first_response.draft_first_response', return_value=DRAFT_OK)
    def test_run_all_only_touches_enabled_orgs(self, mock_draft):
        on = get_test_user().organisation
        _enable(on)
        _new_lead(on)
        off = Organisation.objects.create(name='Off', slug='off', country='US')
        _new_lead(off)  # off has no first_response_enabled → never scanned
        summaries = first_response.run_all()
        self.assertEqual([s['org'] for s in summaries], [on.pk])
        self.assertEqual(FollowUpDraft.objects.filter(organisation=off).count(), 0)


# ── Cadence hand-off to follow-ups ──

@platform_creds
class TestCadenceHandoff(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        s = OrgSettings.for_org(self.org)
        s.ai_followups_enabled = True
        s.first_response_enabled = True
        s.followup_gap_first_days = 3
        s.followup_gap_second_days = 7
        s.save()
        self.settings = s

    def _sent_first_response(self, lead, days_ago):
        """A first response that was approved & sent `days_ago` — draft row plus
        its message ledger row, both backdated."""
        when = timezone.now() - timedelta(days=days_ago)
        draft = FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, kind=FollowUpDraft.KIND_FIRST_RESPONSE,
            channel='whatsapp', body='Hello!', status='sent', reviewed_at=when,
        )
        msg = WhatsAppMessage.objects.create(
            organisation=self.org, lead=lead, direction='outbound', body='Hello!',
            to_phone='whatsapp:+15551234567', from_phone='manual', status='sent',
        )
        WhatsAppMessage.objects.filter(pk=msg.pk).update(created_at=when)
        FollowUpDraft.objects.filter(pk=draft.pk).update(reviewed_at=when)
        Lead.objects.filter(pk=lead.pk).update(updated_at=when)
        lead.refresh_from_db()
        return draft

    def test_pending_first_response_blocks_a_followup_draft(self):
        lead = _new_lead(self.org, needs_first_response=False)
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, kind=FollowUpDraft.KIND_FIRST_RESPONSE,
            channel='whatsapp', body='Hi', status='pending',
        )
        Lead.objects.filter(pk=lead.pk).update(updated_at=timezone.now() - timedelta(days=30))
        ids = set(followup_scheduler.find_stale_leads(self.org, self.settings).values_list('id', flat=True))
        self.assertNotIn(lead.id, ids)

    def test_recent_first_response_pauses_the_followup_clock(self):
        """Just sent a first response → the outbound ledger row means the lead is
        not 'quiet', so no follow-up is drafted yet."""
        lead = _new_lead(self.org, needs_first_response=False)
        self._sent_first_response(lead, days_ago=0)
        ids = set(followup_scheduler.find_stale_leads(self.org, self.settings).values_list('id', flat=True))
        self.assertNotIn(lead.id, ids)

    def test_first_response_does_not_advance_the_followup_stage(self):
        """A sent first response 5 days ago: the FIRST follow-up (gap_first=3) is
        now due. If the first response had counted as a follow-up, the lead would
        be at stage 2 (gap_second=7) and NOT yet due — so its presence proves the
        stage did not advance and the cap was not burned."""
        lead = _new_lead(self.org, needs_first_response=False)
        self._sent_first_response(lead, days_ago=5)
        stale = followup_scheduler.find_stale_leads(self.org, self.settings)
        ids = set(stale.values_list('id', flat=True))
        self.assertIn(lead.id, ids)
        # reviewed_followups counts follow-ups only → still 0 after a first response.
        self.assertEqual(stale.get(pk=lead.pk).reviewed_followups, 0)


# ── Schema / legacy safety ──

class TestKindDefault(TestCase):
    def test_legacy_row_reads_as_followup(self):
        org = get_test_user().organisation
        lead = Lead.objects.create(organisation=org, contact_name='X', status='new')
        # A draft created without an explicit kind (the pre-REL-515 shape).
        draft = FollowUpDraft.objects.create(
            organisation=org, lead=lead, channel='whatsapp', body='hi', status='pending',
        )
        self.assertEqual(draft.kind, FollowUpDraft.KIND_FOLLOWUP)


@override_settings(CRON_SECRET='cron-secret')
class TestFirstResponseCronEndpoint(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_wrong_secret_forbidden(self):
        resp = self.client.post('/api/bookings/cron/run-first-responses/',
                                HTTP_X_CRON_SECRET='nope')
        self.assertEqual(resp.status_code, 403)

    @patch('bookings.services.first_response.run_all', return_value=[{'org': 1, 'created': 2}])
    def test_correct_secret_runs(self, mock_run):
        resp = self.client.post('/api/bookings/cron/run-first-responses/',
                                HTTP_X_CRON_SECRET='cron-secret')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, {'orgs_run': 1, 'created': 2})
        mock_run.assert_called_once()

    @override_settings(CRON_SECRET='')
    def test_unconfigured_returns_503(self):
        resp = self.client.post('/api/bookings/cron/run-first-responses/',
                                HTTP_X_CRON_SECRET='x')
        self.assertEqual(resp.status_code, 503)
