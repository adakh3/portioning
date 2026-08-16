"""Follow-ups by email, and AI copy written in the org's own English (REL-501).

Two defects on one screen, so two halves here:

* **Channel** — follow-ups could only be WhatsApp, which is the one button a US
  caterer would never press. Email now goes out through the same service quotes
  and events send through, and lands in the same ledger.
* **Region** — the drafters said "enquiry" to everyone. The org's country picks
  the variant now, so a US client reads "inquiry" and a UK one still reads
  "enquiry" — the fix is regional, not a blanket Americanisation.

Nothing real is contacted: email goes through REL-460's fake transport and is
asserted out of ``bookings.services.email.outbox``; the LLM is patched.
"""
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from bookings.models import ConnectedMailbox, FollowUpDraft, Lead, OrgSettings, WhatsAppMessage
from bookings.services import email as email_service
from bookings.services import followup_scheduler
from bookings.services.followup_drafter import (
    CHANNEL_EMAIL, CHANNEL_WHATSAPP, _build_context, build_system_prompt,
    draft_followup, fallback_subject,
)
from bookings.services.message_templates import format_event_date
from bookings.services.whatsapp_templates import TEMPLATES, render_template
from bookings.tests import _authenticated_client
from tests.base import get_test_user
from users.country_defaults import language_rule_for_country
from users.models import Organisation

# No OAuth app configured + fake transport = local dev and CI (REL-460 AC9).
FAKE_EMAIL = dict(
    GOOGLE_OAUTH_CLIENT_ID='', GOOGLE_OAUTH_CLIENT_SECRET='',
    MS_OAUTH_CLIENT_ID='', MS_OAUTH_CLIENT_SECRET='',
    EMAIL_FAKE_TRANSPORT=True,
)

platform_creds = override_settings(
    TWILIO_ACCOUNT_SID='AC123',
    TWILIO_AUTH_TOKEN='twilio-secret',
    LLM_FOLLOWUP_DRAFTER='openai:gpt-test',
    OPENAI_API_KEY='sk-openai-test',
    **FAKE_EMAIL,
)


def connect_mailbox(org, status=ConnectedMailbox.CONNECTED):
    mailbox = ConnectedMailbox(
        organisation=org,
        provider=ConnectedMailbox.GOOGLE,
        email_address='owner@acme.com',
        status=status,
        access_token_expires_at=timezone.now() + timedelta(hours=1),
    )
    mailbox.refresh_token = 'refresh-token-abc'
    mailbox.access_token = 'access-token-xyz'
    mailbox.save()
    return mailbox


def _configure_ai(org):
    s = OrgSettings.for_org(org)
    s.ai_followups_enabled = True
    s.whatsapp_enabled = True
    s.twilio_whatsapp_number = '+14155238886'
    s.save()
    return s


def _stale_lead(org, **kwargs):
    """A lead quiet long enough to be chased. Reachable both ways by default, so
    each test states the ONE thing it is actually about."""
    kwargs.setdefault('contact_name', 'Sam')
    kwargs.setdefault('contact_phone', '+15551234567')
    kwargs.setdefault('contact_email', 'sam@example.com')
    kwargs.setdefault('status', 'contacted')
    lead = Lead.objects.create(organisation=org, **kwargs)
    Lead.objects.filter(pk=lead.pk).update(updated_at=timezone.now() - timedelta(days=30))
    lead.refresh_from_db()
    return lead


DRAFT_EMAIL = {
    'should_follow_up': True, 'subject': 'Your wedding catering',
    'message': 'Hello Sam,\n\nJust checking in.\n\nThe Acme team',
    'reasoning': 'No reply in a month.',
}
DRAFT_WA = {
    'should_follow_up': True, 'message': 'Hi Sam, just checking in!',
    'reasoning': 'No reply in a month.',
}


# ── Part 1: which channel a follow-up is drafted for (AC1, AC2, AC3) ─────────

@platform_creds
class ChannelChoiceTests(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        _configure_ai(self.org)

    def test_email_preferred_when_mailbox_works_and_lead_has_one(self):
        """AC1: email is the channel whenever it is actually possible."""
        connect_mailbox(self.org)
        lead = _stale_lead(self.org)
        self.assertEqual(followup_scheduler.choose_channel(lead), CHANNEL_EMAIL)

    def test_whatsapp_when_no_mailbox_is_connected(self):
        """AC2: an org that never connected email is untouched by this change."""
        lead = _stale_lead(self.org)
        self.assertEqual(followup_scheduler.choose_channel(lead), CHANNEL_WHATSAPP)

    def test_whatsapp_when_the_mailbox_needs_reconnecting(self):
        """A dead connection is not a channel — don't draft an email we can't send."""
        connect_mailbox(self.org, status=ConnectedMailbox.NEEDS_RECONNECT)
        lead = _stale_lead(self.org)
        self.assertEqual(followup_scheduler.choose_channel(lead), CHANNEL_WHATSAPP)

    def test_whatsapp_when_the_lead_has_no_email_address(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_email='')
        self.assertEqual(followup_scheduler.choose_channel(lead), CHANNEL_WHATSAPP)

    def test_email_when_the_lead_has_no_phone(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_phone='')
        self.assertEqual(followup_scheduler.choose_channel(lead), CHANNEL_EMAIL)

    def test_no_channel_at_all_returns_none(self):
        """AC3: unreachable is a reason not to draft, not a reason to guess."""
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_phone='', contact_email='')
        self.assertIsNone(followup_scheduler.choose_channel(lead))

    def test_a_junk_email_address_is_not_an_email_channel(self):
        """Lead imports store whatever the source had. 'n/a' is not an address,
        and treating it as one costs the lead the WhatsApp follow-up it could
        actually have received."""
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_email='n/a')
        self.assertEqual(followup_scheduler.choose_channel(lead), CHANNEL_WHATSAPP)

    def test_a_junk_email_and_no_phone_is_no_channel(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_email='none', contact_phone='')
        self.assertIsNone(followup_scheduler.choose_channel(lead))


@platform_creds
class EligibilityTests(TestCase):
    """`find_stale_leads` has to admit exactly the leads choose_channel can serve."""

    def setUp(self):
        self.org = get_test_user().organisation
        self.settings = _configure_ai(self.org)

    def _stale(self):
        return set(
            followup_scheduler.find_stale_leads(self.org, self.settings)
            .values_list('pk', flat=True)
        )

    def test_email_only_lead_is_eligible_once_a_mailbox_is_connected(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_phone='')
        self.assertIn(lead.pk, self._stale())

    def test_email_only_lead_is_ignored_without_a_mailbox(self):
        """The pre-email behaviour, unchanged: no number, no follow-up."""
        lead = _stale_lead(self.org, contact_phone='')
        self.assertNotIn(lead.pk, self._stale())

    def test_lead_with_neither_is_never_eligible(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_phone='', contact_email='')
        self.assertNotIn(lead.pk, self._stale())

    def test_phone_only_lead_stays_eligible_with_a_mailbox_connected(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_email='')
        self.assertIn(lead.pk, self._stale())

    @patch('bookings.services.followup_scheduler.draft_followup')
    def test_run_for_org_skips_the_unreachable_lead_without_crashing(self, mock_draft):
        """AC3 end to end: nothing drafted, nothing raised."""
        mock_draft.return_value = dict(DRAFT_WA)
        connect_mailbox(self.org)
        _stale_lead(self.org, contact_phone='', contact_email='')
        summary = followup_scheduler.run_for_org(self.org)
        self.assertEqual(summary['created'], 0)
        self.assertEqual(FollowUpDraft.objects.count(), 0)


@platform_creds
class GeneratedDraftShapeTests(TestCase):
    """What actually gets stored on the row for each channel."""

    def setUp(self):
        self.org = get_test_user().organisation
        _configure_ai(self.org)

    @patch('bookings.services.followup_scheduler.draft_followup')
    def test_email_draft_stores_channel_and_subject(self, mock_draft):
        """AC1 + AC5 at the row level."""
        mock_draft.return_value = {**DRAFT_EMAIL, 'model_used': 'openai:gpt-test'}
        connect_mailbox(self.org)
        _stale_lead(self.org)
        followup_scheduler.run_for_org(self.org)

        draft = FollowUpDraft.objects.get()
        self.assertEqual(draft.channel, CHANNEL_EMAIL)
        self.assertEqual(draft.subject, 'Your wedding catering')
        self.assertEqual(mock_draft.call_args.kwargs['channel'], CHANNEL_EMAIL)

    @patch('bookings.services.followup_scheduler.draft_followup')
    def test_whatsapp_draft_has_no_subject(self, mock_draft):
        mock_draft.return_value = {**DRAFT_WA, 'model_used': 'openai:gpt-test'}
        _stale_lead(self.org)
        followup_scheduler.run_for_org(self.org)

        draft = FollowUpDraft.objects.get()
        self.assertEqual(draft.channel, CHANNEL_WHATSAPP)
        self.assertEqual(draft.subject, '')
        self.assertEqual(mock_draft.call_args.kwargs['channel'], CHANNEL_WHATSAPP)


@platform_creds
class DrafterChannelTests(TestCase):
    """The drafter's own output, with the model faked at the LLM boundary."""

    def setUp(self):
        self.org = get_test_user().organisation
        self.lead = _stale_lead(self.org, event_type='wedding')

    def _draft(self, channel, payload):
        with patch('portioning.llm.complete_structured',
                   return_value=(dict(payload), 'openai:gpt-test')) as mock_llm:
            result = draft_followup(self.lead, channel=channel)
        return result, mock_llm

    def test_email_draft_carries_a_subject(self):
        result, _ = self._draft(CHANNEL_EMAIL, DRAFT_EMAIL)
        self.assertEqual(result['subject'], 'Your wedding catering')

    def test_email_draft_with_no_subject_from_the_model_still_gets_one(self):
        """AC5: an email must never go out with an empty subject line."""
        result, _ = self._draft(CHANNEL_EMAIL, {**DRAFT_EMAIL, 'subject': '   '})
        self.assertTrue(result['subject'].strip())

    def test_whatsapp_draft_has_an_empty_subject(self):
        result, _ = self._draft(CHANNEL_WHATSAPP, DRAFT_WA)
        self.assertEqual(result['subject'], '')

    def test_the_prompt_says_which_channel_it_is_writing_for(self):
        _, mock_llm = self._draft(CHANNEL_EMAIL, DRAFT_EMAIL)
        system_prompt = mock_llm.call_args.args[1]
        self.assertIn('EMAIL', system_prompt)
        self.assertIn('subject line', system_prompt)

        _, mock_llm = self._draft(CHANNEL_WHATSAPP, DRAFT_WA)
        system_prompt = mock_llm.call_args.args[1]
        self.assertIn('WhatsApp message', system_prompt)
        self.assertIn('no subject line', system_prompt)

    def test_context_names_the_channel(self):
        self.assertIn('Channel: email', _build_context(self.lead, CHANNEL_EMAIL))
        self.assertIn('Channel: WhatsApp', _build_context(self.lead, CHANNEL_WHATSAPP))

    def test_fallback_subject_uses_the_orgs_event_label(self):
        from bookings.models.choices import EventTypeOption
        EventTypeOption.objects.update_or_create(
            organisation=self.org, value='wedding',
            defaults={'label': 'Shaadi', 'sort_order': 1},
        )
        self.assertEqual(fallback_subject(self.lead), 'Your Shaadi catering')


# ── Part 1: sending (AC4, AC6, AC7, AC11) ────────────────────────────────────

@platform_creds
class ApproveEmailTests(TestCase):
    BASE = '/api/bookings/followup-drafts/'

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        _configure_ai(self.org)
        connect_mailbox(self.org)
        self.client = _authenticated_client()
        self.lead = _stale_lead(self.org)
        self.draft = FollowUpDraft.objects.create(
            organisation=self.org, lead=self.lead, channel=CHANNEL_EMAIL,
            subject='Your wedding catering', body='Hello Sam,\n\nChecking in.',
            status='pending',
        )
        email_service.outbox.clear()

    def test_approve_sends_from_the_orgs_mailbox_and_ledgers_it(self):
        """AC6: it goes out as the caterer, and the lead's history records it."""
        res = self.client.post(f'{self.BASE}{self.draft.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 200, res.content)

        self.assertEqual(len(email_service.outbox), 1)
        sent = email_service.outbox[0]
        self.assertEqual(sent['to'], ['sam@example.com'])
        self.assertEqual(sent['from'], 'owner@acme.com')
        self.assertEqual(sent['subject'], 'Your wedding catering')

        msg = WhatsAppMessage.objects.get(lead=self.lead)
        self.assertEqual(msg.channel, WhatsAppMessage.CHANNEL_EMAIL)
        self.assertEqual(msg.to_email, 'sam@example.com')
        self.assertEqual(msg.status, 'sent')

        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'sent')
        self.assertEqual(self.draft.whatsapp_message_id, msg.id)
        self.assertEqual(self.draft.reviewed_by, self.user)

    def test_the_rep_can_edit_the_subject_before_sending(self):
        """AC5: the subject is editable, and what the rep approved is what goes."""
        self.client.post(
            f'{self.BASE}{self.draft.id}/approve/',
            {'subject': 'Your March 14 wedding', 'body': 'Edited body'},
            format='json',
        )
        self.assertEqual(email_service.outbox[0]['subject'], 'Your March 14 wedding')
        self.assertEqual(email_service.outbox[0]['body'], 'Edited body')
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.subject, 'Your March 14 wedding')

    def test_switching_to_whatsapp_sends_by_whatsapp(self):
        """AC4: the rep's override wins over the drafted channel."""
        with patch('bookings.views.followups.WhatsAppService') as MockSvc:
            MockSvc.return_value.send_message.return_value = WhatsAppMessage.objects.create(
                organisation=self.org, lead=self.lead, to_phone='x', from_phone='y',
                body='Hello Sam,', direction='outbound', status='sent',
            )
            res = self.client.post(
                f'{self.BASE}{self.draft.id}/approve/',
                {'channel': 'whatsapp'}, format='json',
            )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(email_service.outbox, [])
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.channel, CHANNEL_WHATSAPP)
        self.assertEqual(self.draft.status, 'sent')

    def test_switching_a_whatsapp_draft_to_email_sends_with_a_subject(self):
        """AC4 the other way: a WhatsApp draft has no subject, and must not go
        out with a blank one."""
        wa_draft = FollowUpDraft.objects.create(
            organisation=self.org, lead=self.lead, channel=CHANNEL_WHATSAPP,
            body='Hi Sam, checking in!', status='pending',
        )
        res = self.client.post(
            f'{self.BASE}{wa_draft.id}/approve/', {'channel': 'email'}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(email_service.outbox[0]['subject'].strip())

    def test_an_unknown_channel_is_rejected(self):
        res = self.client.post(
            f'{self.BASE}{self.draft.id}/approve/', {'channel': 'carrier-pigeon'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'pending')

    def test_a_revoked_mailbox_explains_itself_and_keeps_the_draft(self):
        """AC7: the real reason, and the draft survives to be sent again."""
        ConnectedMailbox.objects.for_org(self.org).update(
            status=ConnectedMailbox.NEEDS_RECONNECT,
        )
        res = self.client.post(f'{self.BASE}{self.draft.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 400)
        detail = res.json()['detail']
        self.assertIn('renew', detail.lower())
        self.assertNotIn('500', detail)

        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'pending')
        self.assertEqual(self.draft.body, 'Hello Sam,\n\nChecking in.')

        # …and once reconnected, the same draft sends.
        ConnectedMailbox.objects.for_org(self.org).update(status=ConnectedMailbox.CONNECTED)
        res = self.client.post(f'{self.BASE}{self.draft.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'sent')

    def test_a_lead_with_no_address_says_so(self):
        Lead.objects.filter(pk=self.lead.pk).update(contact_email='')
        res = self.client.post(f'{self.BASE}{self.draft.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('email address', res.json()['detail'].lower())
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'pending')

    def test_mark_sent_refuses_an_email_draft(self):
        """The shortcut ledger row would be a lie: nothing was handed to a phone."""
        res = self.client.post(f'{self.BASE}{self.draft.id}/mark-sent/', {}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(WhatsAppMessage.objects.count(), 0)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'pending')

    def test_mark_sent_accepts_an_email_draft_switched_to_whatsapp(self):
        """The shortcuts-mode path for AC4, and the one that loses real sends
        if it's refused: no Twilio, so the rep flips the channel, hands the
        message to their own WhatsApp, and confirms. The client HAS it by then.
        """
        res = self.client.post(
            f'{self.BASE}{self.draft.id}/mark-sent/',
            {'channel': 'whatsapp', 'body': 'Hi Sam, checking in!'}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)

        msg = WhatsAppMessage.objects.get(lead=self.lead)
        self.assertEqual(msg.status, WhatsAppMessage.HANDED_OFF)
        self.assertEqual(msg.body, 'Hi Sam, checking in!')
        self.assertEqual(email_service.outbox, [])   # nothing was emailed

        self.draft.refresh_from_db()
        self.assertEqual(self.draft.channel, CHANNEL_WHATSAPP)
        self.assertEqual(self.draft.status, 'sent')

    def test_mark_sent_refuses_a_lead_with_no_phone(self):
        """Switching to WhatsApp is not a channel if there's no number — say so
        rather than writing a handoff row addressed to nobody."""
        Lead.objects.filter(pk=self.lead.pk).update(contact_phone='')
        res = self.client.post(
            f'{self.BASE}{self.draft.id}/mark-sent/', {'channel': 'whatsapp'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('phone', res.json()['detail'].lower())
        self.assertEqual(WhatsAppMessage.objects.count(), 0)

    def test_an_overlong_subject_is_a_clean_rejection_not_a_crash(self):
        """SQLite silently truncates and Postgres raises — so this must fail the
        same way in dev as it would in production."""
        res = self.client.post(
            f'{self.BASE}{self.draft.id}/approve/', {'subject': 'x' * 400},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('too long', res.json()['detail'])
        self.assertEqual(email_service.outbox, [])
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'pending')
        self.assertEqual(self.draft.subject, 'Your wedding catering')

    def test_a_failed_send_then_a_reverted_edit_sends_the_reverted_text(self):
        """The overrides are persisted before the send is attempted, so a client
        that only posts what *changed* would resend the text the rep took back.
        The card posts what is on screen; this pins that contract server-side.
        """
        ConnectedMailbox.objects.for_org(self.org).update(
            status=ConnectedMailbox.NEEDS_RECONNECT,
        )
        self.client.post(
            f'{self.BASE}{self.draft.id}/approve/', {'body': 'Oops, wrong text'},
            format='json',
        )
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.body, 'Oops, wrong text')   # persisted

        ConnectedMailbox.objects.for_org(self.org).update(status=ConnectedMailbox.CONNECTED)
        res = self.client.post(
            f'{self.BASE}{self.draft.id}/approve/', {'body': 'Hello Sam,\n\nChecking in.'},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(email_service.outbox[0]['body'], 'Hello Sam,\n\nChecking in.')

    def test_bulk_approve_sends_each_draft_on_its_own_channel(self):
        other = _stale_lead(self.org, contact_name='Pat', contact_email='pat@example.com')
        wa_draft = FollowUpDraft.objects.create(
            organisation=self.org, lead=other, channel=CHANNEL_WHATSAPP,
            body='Hi Pat!', status='pending',
        )
        with patch('bookings.views.followups.WhatsAppService') as MockSvc:
            MockSvc.return_value.send_message.return_value = WhatsAppMessage.objects.create(
                organisation=self.org, lead=other, to_phone='x', from_phone='y',
                body='Hi Pat!', direction='outbound', status='sent',
            )
            res = self.client.post(f'{self.BASE}bulk-approve/', {}, format='json')

        self.assertEqual(res.status_code, 200, res.content)
        self.assertCountEqual(res.json()['sent'], [self.draft.id, wa_draft.id])
        # Exactly one email left the building — the WhatsApp draft did not.
        self.assertEqual([m['to'] for m in email_service.outbox], [['sam@example.com']])


@platform_creds
class ExistingDraftTests(TestCase):
    """AC11: rows written before email existed behave exactly as they did."""

    BASE = '/api/bookings/followup-drafts/'

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        _configure_ai(self.org)
        self.client = _authenticated_client()
        self.lead = _stale_lead(self.org)
        # Written the way the old code wrote them: no channel, no subject.
        self.draft = FollowUpDraft.objects.create(
            organisation=self.org, lead=self.lead, body='Hi Sam!', status='pending',
        )

    def test_defaults_to_whatsapp_with_no_subject(self):
        self.assertEqual(self.draft.channel, CHANNEL_WHATSAPP)
        self.assertEqual(self.draft.subject, '')

    def test_still_sends_by_whatsapp(self):
        connect_mailbox(self.org)   # even with email now available
        email_service.outbox.clear()
        with patch('bookings.views.followups.WhatsAppService') as MockSvc:
            msg = WhatsAppMessage.objects.create(
                organisation=self.org, lead=self.lead, to_phone='x', from_phone='y',
                body='Hi Sam!', direction='outbound', status='sent',
            )
            MockSvc.return_value.send_message.return_value = msg
            res = self.client.post(f'{self.BASE}{self.draft.id}/approve/', {}, format='json')

        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(email_service.outbox, [])
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.whatsapp_message_id, msg.id)

    def test_still_marks_sent_through_the_shortcut(self):
        res = self.client.post(f'{self.BASE}{self.draft.id}/mark-sent/', {}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        msg = WhatsAppMessage.objects.get(lead=self.lead)
        self.assertEqual(msg.status, WhatsAppMessage.HANDED_OFF)


@platform_creds
class DraftSerializerTests(TestCase):
    """What the review card is given to render from."""

    BASE = '/api/bookings/followup-drafts/'

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        _configure_ai(self.org)
        self.client = _authenticated_client()

    def _row(self):
        res = self.client.get(f'{self.BASE}?page_size=all')
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        rows = body['results'] if isinstance(body, dict) else body
        return rows[0]

    def test_email_draft_exposes_its_channel_subject_and_address(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, channel=CHANNEL_EMAIL,
            subject='Your wedding catering', body='Hello Sam,', status='pending',
        )
        row = self._row()
        self.assertEqual(row['channel'], 'email')
        self.assertEqual(row['subject'], 'Your wedding catering')
        self.assertEqual(row['lead_email'], 'sam@example.com')
        self.assertTrue(row['email_available'])

    def test_email_is_unavailable_without_a_mailbox(self):
        """The card must not offer a channel the org cannot use."""
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, body='Hi Sam!', status='pending',
        )
        row = self._row()
        self.assertFalse(row['email_available'])
        self.assertEqual(row['email_reason'], 'no_mailbox')

    def test_a_dead_mailbox_says_reconnect_not_connect(self):
        """The distinction the send modal exists to make: a caterer whose grant
        was revoked must not be told to go and set up what they already set up.
        """
        connect_mailbox(self.org, status=ConnectedMailbox.NEEDS_RECONNECT)
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, channel=CHANNEL_EMAIL,
            subject='s', body='Hi Sam!', status='pending',
        )
        row = self._row()
        self.assertFalse(row['email_available'])
        self.assertEqual(row['email_reason'], 'mailbox_needs_reconnect')

    def test_email_is_unavailable_without_an_address_on_the_lead(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_email='')
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, body='Hi Sam!', status='pending',
        )
        row = self._row()
        self.assertFalse(row['email_available'])
        self.assertEqual(row['email_reason'], 'no_email_address')

    def test_a_junk_address_is_not_an_available_email_channel(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org, contact_email='n/a')
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, body='Hi Sam!', status='pending',
        )
        row = self._row()
        self.assertFalse(row['email_available'])
        self.assertEqual(row['email_reason'], 'no_email_address')

    def test_a_usable_mailbox_reports_no_reason_at_all(self):
        connect_mailbox(self.org)
        lead = _stale_lead(self.org)
        FollowUpDraft.objects.create(
            organisation=self.org, lead=lead, channel=CHANNEL_EMAIL,
            subject='s', body='Hi Sam!', status='pending',
        )
        row = self._row()
        self.assertTrue(row['email_available'])
        self.assertIsNone(row['email_reason'])

    def test_availability_costs_one_query_however_many_drafts(self):
        """The org-level mailbox lookup belongs to the request, not to each row."""
        connect_mailbox(self.org)
        for i in range(3):
            FollowUpDraft.objects.create(
                organisation=self.org,
                lead=_stale_lead(self.org, contact_name=f'Lead {i}'),
                channel=CHANNEL_EMAIL, subject='s', body='b', status='pending',
            )
        # Count the mailbox reads specifically: one per request, not one per row.
        with patch('bookings.services.email.get_mailbox',
                   wraps=email_service.get_mailbox) as spy:
            res = self.client.get(f'{self.BASE}?page_size=all')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertLessEqual(spy.call_count, 1)


# ── Part 2: the org's own English (AC8, AC9, AC10) ───────────────────────────

class LanguageVariantTests(TestCase):
    def test_us_org_is_told_to_write_american(self):
        rule = language_rule_for_country('US')
        self.assertIn('inquiry', rule)
        self.assertNotIn("Spell it 'enquiry'", rule)

    def test_gb_org_is_told_to_write_british(self):
        rule = language_rule_for_country('GB')
        self.assertIn('enquiry', rule)
        self.assertIn('cheque', rule)

    def test_unmapped_and_blank_countries_fall_back_to_the_us_default(self):
        """`Organisation.country` defaults to 'US'; nothing may quietly differ."""
        self.assertEqual(language_rule_for_country(''), language_rule_for_country('US'))
        self.assertEqual(language_rule_for_country('ZZ'), language_rule_for_country('US'))
        self.assertEqual(language_rule_for_country(None), language_rule_for_country('US'))

    def test_country_code_case_does_not_matter(self):
        self.assertEqual(language_rule_for_country('gb'), language_rule_for_country('GB'))


@platform_creds
class PromptRegionTests(TestCase):
    """Both drafters must carry the org's variant — this was only ever a
    follow-up bug because that is where it was noticed."""

    def setUp(self):
        self.us_org = get_test_user().organisation
        Organisation.objects.filter(pk=self.us_org.pk).update(country='US')
        self.us_org.refresh_from_db()
        self.gb_org = Organisation.objects.create(
            name='Brit Catering', slug='brit-catering-rel501', country='GB',
        )

    def test_followup_prompt_is_american_for_a_us_org(self):
        prompt = build_system_prompt(self.us_org, CHANNEL_EMAIL)
        self.assertIn('inquiry', prompt)

    def test_followup_prompt_is_british_for_a_gb_org(self):
        prompt = build_system_prompt(self.gb_org, CHANNEL_EMAIL)
        self.assertIn('enquiry', prompt)

    def test_followup_prompt_carries_the_variant_on_whatsapp_too(self):
        self.assertIn('enquiry', build_system_prompt(self.gb_org, CHANNEL_WHATSAPP))

    def test_the_shared_rules_no_longer_pick_a_region_themselves(self):
        """The bug: the base prompt hardcoded 'enquiry' for every org on earth.
        Only the injected variant may name a spelling now — which is why this
        asserts on the shared rules, not on the assembled prompt (where the US
        variant legitimately says "never 'enquiry'")."""
        from bookings.services.followup_drafter import SYSTEM_PROMPT
        from bookings.services.message_drafter import SYSTEM_PROMPT as CLIENT_PROMPT
        for name, prompt in (('followup', SYSTEM_PROMPT), ('client', CLIENT_PROMPT)):
            with self.subTest(prompt=name):
                self.assertNotIn('enquiry', prompt)
                self.assertNotIn('inquiry', prompt)

    def test_client_message_prompt_follows_the_org_too(self):
        from bookings.services.message_drafter import build_system_prompt as build_client_prompt
        self.assertIn('inquiry', build_client_prompt(self.us_org))
        self.assertIn('enquiry', build_client_prompt(self.gb_org))

    def test_the_drafter_actually_sends_the_regional_prompt(self):
        """The wiring, not just the builder — the bug was that nothing injected it."""
        lead = _stale_lead(self.gb_org)
        with patch('portioning.llm.complete_structured',
                   return_value=(dict(DRAFT_EMAIL), 'openai:gpt-test')) as mock_llm:
            draft_followup(lead, channel=CHANNEL_EMAIL)
        self.assertIn('enquiry', mock_llm.call_args.args[1])


class RegionalDateTests(TestCase):
    """AC8/AC9: a date written day-first to an American client can be read as a
    different day entirely."""

    def setUp(self):
        import datetime
        self.date = datetime.date(2026, 3, 14)

    def test_us_orgs_get_month_first(self):
        self.assertEqual(format_event_date(self.date, 'US'), 'March 14, 2026')

    def test_gb_orgs_get_day_first(self):
        self.assertEqual(format_event_date(self.date, 'GB'), '14 March 2026')

    def test_no_country_matches_the_us_default(self):
        self.assertEqual(format_event_date(self.date), 'March 14, 2026')

    def test_single_digit_days_are_not_zero_padded(self):
        import datetime
        self.assertEqual(format_event_date(datetime.date(2026, 3, 4), 'US'), 'March 4, 2026')

    def test_a_string_date_still_renders(self):
        self.assertEqual(format_event_date('2026-03-14', 'US'), 'March 14, 2026')

    def test_an_unparseable_date_is_passed_through(self):
        self.assertEqual(format_event_date('sometime in March', 'US'), 'sometime in March')

    def test_empty_stays_empty(self):
        self.assertEqual(format_event_date(None, 'US'), '')


@platform_creds
class FollowupContextDateTests(TestCase):
    def test_the_context_gives_the_model_the_orgs_date_order(self):
        import datetime
        org = get_test_user().organisation
        Organisation.objects.filter(pk=org.pk).update(country='US')
        org.refresh_from_db()
        lead = _stale_lead(org, event_date=datetime.date(2026, 3, 14))
        lead.organisation = org
        ctx = _build_context(lead, CHANNEL_EMAIL)
        self.assertIn('March 14, 2026', ctx)
        self.assertNotIn('2026-03-14', ctx)


class StaticTemplateTests(TestCase):
    """AC10: static text reaches clients in every market as-is."""

    def test_no_template_carries_a_wrong_region_word(self):
        for key, text in TEMPLATES.items():
            with self.subTest(template=key):
                self.assertNotIn('enquiry', text.lower())
                self.assertNotIn('inquiry', text.lower())

    def test_the_follow_up_template_still_renders(self):
        rendered = render_template('follow_up', {
            'contact_name': 'Sam', 'event_type': 'wedding',
        })
        self.assertIn('Sam', rendered)
        self.assertIn('wedding', rendered)
        self.assertNotIn('{', rendered)
