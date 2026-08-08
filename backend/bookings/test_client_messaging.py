"""Client messaging (REL-445 backend): the ledger, the send service, AI drafts,
and the automatic signed copy.

Nothing real is contacted. Email goes through REL-460's fake transport and is
asserted out of ``bookings.services.email.outbox`` the way ``mail.outbox`` used
to be; Twilio is patched at ``twilio.rest.Client``; the LLM is patched at
``portioning.llm``.

The through-line of these tests is the ledger's honesty rule: a message the
platform sent may be recorded as sent, and a message handed to the caterer's own
phone may not.
"""
import datetime
import io
from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.models import (
    ConnectedMailbox, OrgSettings, Quote, WhatsAppMessage,
)
from bookings.models.quotes import QuoteStatus
from bookings.services import email as email_service
from bookings.services import messaging
from bookings.services.message_drafter import build_context, draft_client_message
from bookings.services.message_templates import render_client_message
from bookings.services.messaging_kinds import (
    KIND_COMPOSE, KIND_SIGN_LINK, KIND_SIGNED_COPY,
)
from bookings.tests import _authenticated_client, make_contact, make_lead, make_quote
from bookings.views.public_sign import sign_booking
from events.models import Event, EventStatus
from tests.base import get_test_org
from users.models import Organisation

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover
    HAVE_PYPDF = False


# No OAuth app + fake transport on = local dev and CI (REL-460 AC9).
FAKE_EMAIL = dict(
    GOOGLE_OAUTH_CLIENT_ID='', GOOGLE_OAUTH_CLIENT_SECRET='',
    MS_OAUTH_CLIENT_ID='', MS_OAUTH_CLIENT_SECRET='',
    EMAIL_FAKE_TRANSPORT=True,
    FRONTEND_BASE_URL='https://app.example.com',
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


TWILIO_ACCOUNT = dict(TWILIO_ACCOUNT_SID='ACtest', TWILIO_AUTH_TOKEN='token')


def enable_twilio(org):
    s = OrgSettings.for_org(org)
    s.whatsapp_enabled = True
    s.twilio_whatsapp_number = '+14155238886'
    s.save()
    return s


def twilio_ok(sid='SM123'):
    """A patched Twilio client whose send succeeds."""
    client = MagicMock()
    client.messages.create.return_value = MagicMock(sid=sid)
    return client


@override_settings(**FAKE_EMAIL)
class MessagingTestBase(TestCase):
    def setUp(self):
        email_service.outbox.clear()
        self.org = get_test_org()
        self.settings_row = OrgSettings.for_org(self.org)
        self.contact = make_contact(
            org=self.org, first_name='Nadia', last_name='Okonjo',
            email='nadia@example.com', phone='+447700900123',
        )
        self.staff = _authenticated_client()

    def make_quote(self, **kwargs):
        q = make_quote(org=self.org, primary_contact=self.contact,
                       price_per_head=Decimal('50'), guest_count=100, **kwargs)
        q.recalculate_totals()
        q.refresh_from_db()
        return q

    def make_event(self, **kwargs):
        defaults = dict(
            organisation=self.org, name='Okonjo Wedding',
            event_date=datetime.date(2026, 6, 15), guest_count=100,
            primary_contact=self.contact, event_type='wedding',
            price_per_head=Decimal('50'),
        )
        defaults.update(kwargs)
        event = Event.objects.create(**defaults)
        event.recalculate_totals()
        event.refresh_from_db()
        return event


# ── the ledger itself ────────────────────────────────────────────────────────

class LedgerSchemaTests(MessagingTestBase):
    """The shape of the widened ledger, including what it refuses to store."""

    def test_rejects_a_message_with_no_parent(self):
        # A row belonging to nothing is invisible on every surface that shows
        # messages — silently lost, not harmlessly orphaned.
        from django.db.utils import IntegrityError
        with self.assertRaises(IntegrityError):
            WhatsAppMessage.objects.create(
                organisation=self.org, body='floating', to_phone='+447700900123',
            )

    def test_accepts_each_kind_of_parent(self):
        quote = self.make_quote()
        event = self.make_event()
        lead = make_lead(org=self.org)
        for parent_kwargs in ({'quote': quote}, {'event': event}, {'lead': lead}):
            row = WhatsAppMessage.objects.create(
                organisation=self.org, body='hello', **parent_kwargs,
            )
            self.assertIsNotNone(row.pk)
            self.assertEqual(row.parent, list(parent_kwargs.values())[0])

    def test_a_pre_rel445_lead_row_is_unchanged(self):
        """Existing-row rule: the shape lead rows had before this change still
        saves, and every new column defaults to something inert."""
        lead = make_lead(org=self.org)
        row = WhatsAppMessage.objects.create(
            organisation=self.org, lead=lead,
            to_phone='whatsapp:+447700900123', from_phone='whatsapp:+14155238886',
            body='Hi there', direction='outbound', status='sent',
        )
        row.refresh_from_db()
        self.assertEqual(row.channel, WhatsAppMessage.CHANNEL_WHATSAPP)
        self.assertEqual(row.to_email, '')
        self.assertEqual(row.subject, '')
        self.assertEqual(row.attachment_filename, '')
        self.assertEqual(row.provider_message_id, '')
        self.assertIsNone(row.quote_id)
        self.assertIsNone(row.event_id)

    def test_is_automatic_tracks_who_triggered_it(self):
        quote = self.make_quote()
        machine = WhatsAppMessage.objects.create(
            organisation=self.org, quote=quote, body='auto', sent_by=None,
        )
        human = WhatsAppMessage.objects.create(
            organisation=self.org, quote=quote, body='typed',
            sent_by=self.staff.handler._force_user,
        )
        self.assertTrue(machine.is_automatic)
        self.assertFalse(human.is_automatic)


# ── AC4: which channel gets picked ───────────────────────────────────────────

class ChannelResolutionTests(MessagingTestBase):

    def test_org_default_is_used_when_the_contact_has_no_preference(self):
        quote = self.make_quote()
        self.assertEqual(messaging.resolve_channel(self.org, quote), 'whatsapp')

        connect_mailbox(self.org)
        self.settings_row.default_client_channel = 'email'
        self.settings_row.save()
        self.assertEqual(messaging.resolve_channel(self.org, quote), 'email')

    def test_contact_preference_beats_the_org_default(self):
        connect_mailbox(self.org)
        quote = self.make_quote()

        self.contact.preferred_channel = 'email'
        self.contact.save()
        self.assertEqual(messaging.resolve_channel(self.org, quote), 'email')

        self.settings_row.default_client_channel = 'email'
        self.settings_row.save()
        self.contact.preferred_channel = 'whatsapp'
        self.contact.save()
        quote.refresh_from_db()
        self.assertEqual(messaging.resolve_channel(self.org, quote), 'whatsapp')

    def test_a_preference_for_an_unusable_channel_degrades(self):
        """Preselecting a dead end helps nobody — email with no mailbox falls
        back to WhatsApp rather than opening on a disabled option."""
        self.settings_row.default_client_channel = 'email'
        self.settings_row.save()
        quote = self.make_quote()
        self.assertEqual(messaging.resolve_channel(self.org, quote), 'whatsapp')

    def test_new_us_org_defaults_to_email_others_to_whatsapp(self):
        us = Organisation.objects.create(name='US Caterer', slug='us-cat', country='US')
        gb = Organisation.objects.create(name='GB Caterer', slug='gb-cat', country='GB')
        pk = Organisation.objects.create(name='PK Caterer', slug='pk-cat', country='PK')
        self.assertEqual(OrgSettings.for_org(us).default_client_channel, 'email')
        self.assertEqual(OrgSettings.for_org(gb).default_client_channel, 'whatsapp')
        self.assertEqual(OrgSettings.for_org(pk).default_client_channel, 'whatsapp')

    def test_existing_org_keeps_whatsapp(self):
        # The org in setUp predates the field; it must not have been moved.
        self.assertEqual(self.settings_row.default_client_channel, 'whatsapp')


# ── AC7: what's available, and why not ───────────────────────────────────────

class ChannelAvailabilityTests(MessagingTestBase):

    def test_no_mailbox_and_no_contact_email_are_different_problems(self):
        """The two email failures send the caterer to different screens, so the
        API must not collapse them into one 'email unavailable'."""
        quote = self.make_quote()
        avail = messaging.channel_availability(self.org, quote)
        self.assertFalse(avail['email']['available'])
        self.assertEqual(avail['email']['reason'], messaging.NO_MAILBOX)

        connect_mailbox(self.org)
        self.contact.email = ''
        self.contact.save()
        quote.refresh_from_db()
        avail = messaging.channel_availability(self.org, quote)
        self.assertFalse(avail['email']['available'])
        self.assertEqual(avail['email']['reason'], messaging.NO_EMAIL_ADDRESS)

    def test_whatsapp_needs_only_a_phone_not_twilio(self):
        quote = self.make_quote()
        avail = messaging.channel_availability(self.org, quote)
        self.assertTrue(avail['whatsapp']['available'])
        self.assertEqual(avail['whatsapp']['mechanism'], 'shortcut')

        enable_twilio(self.org)
        with override_settings(**TWILIO_ACCOUNT):
            avail = messaging.channel_availability(self.org, quote)
        self.assertEqual(avail['whatsapp']['mechanism'], 'platform')
        self.assertEqual(avail['whatsapp']['number'], '+14155238886')

    def test_no_phone_makes_whatsapp_unavailable(self):
        self.contact.phone = ''
        self.contact.save()
        quote = self.make_quote()
        avail = messaging.channel_availability(self.org, quote)
        self.assertFalse(avail['whatsapp']['available'])
        self.assertEqual(avail['whatsapp']['reason'], messaging.NO_PHONE)

    def test_an_org_that_turned_shortcuts_off_is_obeyed(self):
        """whatsapp_shortcuts_enabled means 'no outreach from personal phones'.
        It is a decision, not a fallback we may quietly ignore."""
        self.settings_row.whatsapp_shortcuts_enabled = False
        self.settings_row.save()
        quote = self.make_quote()
        avail = messaging.channel_availability(self.org, quote)
        self.assertFalse(avail['whatsapp']['available'])
        self.assertEqual(avail['whatsapp']['reason'], messaging.WHATSAPP_DISABLED)


# ── AC1: the sign link by email ──────────────────────────────────────────────

class SignLinkEmailTests(MessagingTestBase):

    def setUp(self):
        super().setUp()
        connect_mailbox(self.org)

    def test_quote_sign_link_carries_the_url_and_the_pdf(self):
        quote = self.make_quote(status=QuoteStatus.DRAFT)
        msg = messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='email')

        self.assertEqual(len(email_service.outbox), 1)
        sent = email_service.outbox[0]
        self.assertEqual(sent['to'], ['nadia@example.com'])
        quote.refresh_from_db()
        self.assertIn(f'https://app.example.com/b/{quote.public_token}', sent['body'])

        (filename, content, mimetype), = sent['attachments']
        self.assertTrue(filename.endswith('.pdf'))
        self.assertEqual(mimetype, 'application/pdf')
        self.assertTrue(content.startswith(b'%PDF'))

        self.assertEqual(msg.channel, 'email')
        self.assertEqual(msg.status, 'sent')
        self.assertEqual(msg.quote_id, quote.pk)
        self.assertIsNone(msg.lead_id)
        self.assertEqual(msg.to_email, 'nadia@example.com')
        self.assertTrue(msg.subject)
        self.assertEqual(msg.attachment_filename, filename)

    def test_event_sign_link_mirrors_the_quote(self):
        event = self.make_event()
        msg = messaging.send_booking_link(event, KIND_SIGN_LINK, channel='email')

        sent = email_service.outbox[0]
        event.refresh_from_db()
        self.assertIn(f'https://app.example.com/b/{event.public_token}', sent['body'])
        self.assertTrue(sent['attachments'][0][1].startswith(b'%PDF'))
        self.assertEqual(msg.event_id, event.pk)
        self.assertIsNone(msg.quote_id)

    def test_sending_a_draft_quote_marks_it_sent(self):
        quote = self.make_quote(status=QuoteStatus.DRAFT)
        messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='email')
        quote.refresh_from_db()
        self.assertEqual(quote.status, QuoteStatus.SENT)

    def test_a_dead_connection_asks_for_a_reconnect_not_a_connect(self):
        ConnectedMailbox.objects.for_org(self.org).update(
            status=ConnectedMailbox.NEEDS_RECONNECT,
        )
        quote = self.make_quote()
        with self.assertRaises(messaging.ChannelUnavailable) as caught:
            messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='email')
        self.assertEqual(caught.exception.reason, messaging.MAILBOX_NEEDS_RECONNECT)

    def test_a_failed_send_leaves_a_failed_row_and_does_not_move_the_quote(self):
        quote = self.make_quote(status=QuoteStatus.DRAFT)
        with patch('bookings.services.email.send_via_mailbox',
                   side_effect=email_service.MailboxSendFailed('provider refused')), \
             self.assertRaises(email_service.MailboxError):
            messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='email')

        row = WhatsAppMessage.objects.get(quote=quote)
        self.assertEqual(row.status, 'failed')
        self.assertTrue(row.error_message)
        quote.refresh_from_db()
        self.assertEqual(quote.status, QuoteStatus.DRAFT)

    def test_email_without_a_mailbox_is_refused_before_anything_is_recorded(self):
        ConnectedMailbox.objects.for_org(self.org).delete()
        quote = self.make_quote()
        with self.assertRaises(messaging.ChannelUnavailable) as caught:
            messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='email')
        self.assertEqual(caught.exception.reason, messaging.NO_MAILBOX)
        self.assertEqual(WhatsAppMessage.objects.count(), 0)
        self.assertEqual(email_service.outbox, [])


# ── AC2: the sign link on WhatsApp, both mechanisms ──────────────────────────

class SignLinkWhatsAppTests(MessagingTestBase):

    @override_settings(**TWILIO_ACCOUNT)
    def test_platform_send_records_a_tracked_row_with_no_attachment(self):
        enable_twilio(self.org)
        quote = self.make_quote()
        with patch('twilio.rest.Client', return_value=twilio_ok('SMabc')):
            msg = messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='whatsapp')

        self.assertEqual(msg.channel, 'whatsapp')
        self.assertEqual(msg.status, 'sent')
        self.assertEqual(msg.twilio_sid, 'SMabc')
        self.assertEqual(msg.quote_id, quote.pk)
        self.assertEqual(msg.attachment_filename, '')
        quote.refresh_from_db()
        self.assertIn(str(quote.public_token), msg.body)
        self.assertEqual(email_service.outbox, [])

    def test_shortcut_send_is_handed_off_never_sent(self):
        """No Twilio: the caterer sends it from their own WhatsApp, so the
        platform records a handoff and claims nothing about delivery."""
        quote = self.make_quote()
        with patch('twilio.rest.Client') as twilio:
            msg = messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='whatsapp')
        twilio.assert_not_called()

        self.assertEqual(msg.status, WhatsAppMessage.HANDED_OFF)
        self.assertIn(msg.status, WhatsAppMessage.UNCONFIRMED_STATUSES)
        self.assertEqual(msg.channel, 'whatsapp')
        self.assertEqual(msg.quote_id, quote.pk)
        self.assertEqual(msg.twilio_sid, '')

    def test_a_shortcut_send_still_advances_a_draft_quote(self):
        quote = self.make_quote(status=QuoteStatus.DRAFT)
        messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='whatsapp')
        quote.refresh_from_db()
        self.assertEqual(quote.status, QuoteStatus.SENT)

    def test_shortcuts_disabled_refuses_rather_than_falling_back(self):
        self.settings_row.whatsapp_shortcuts_enabled = False
        self.settings_row.save()
        quote = self.make_quote()
        with self.assertRaises(messaging.ChannelUnavailable) as caught:
            messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='whatsapp')
        self.assertEqual(caught.exception.reason, messaging.WHATSAPP_DISABLED)

    @override_settings(**TWILIO_ACCOUNT)
    def test_a_failing_twilio_send_is_recorded_not_raised(self):
        enable_twilio(self.org)
        quote = self.make_quote()
        broken = MagicMock()
        broken.messages.create.side_effect = RuntimeError('twilio down')
        with patch('twilio.rest.Client', return_value=broken):
            msg = messaging.send_booking_link(quote, KIND_SIGN_LINK, channel='whatsapp')
        self.assertEqual(msg.status, 'failed')
        self.assertIn('twilio down', msg.error_message)


# ── AC3 / AC3c: drafting ─────────────────────────────────────────────────────

class DraftingTests(MessagingTestBase):

    def test_falls_back_to_the_template_when_no_model_is_configured(self):
        quote = self.make_quote()
        with patch('portioning.llm.is_configured', return_value=False):
            draft = draft_client_message(quote, KIND_SIGN_LINK, 'email', url='https://x/b/1')
        expected = render_client_message(quote, KIND_SIGN_LINK, 'email', url='https://x/b/1')
        self.assertTrue(draft['used_fallback'])
        self.assertEqual(draft['body'], expected['body'])
        self.assertEqual(draft['subject'], expected['subject'])

    def test_falls_back_when_the_model_errors(self):
        quote = self.make_quote()
        with patch('portioning.llm.is_configured', return_value=True), \
             patch('portioning.llm.complete_structured', side_effect=RuntimeError('boom')):
            draft = draft_client_message(quote, KIND_SIGN_LINK, 'email', url='https://x/b/1')
        self.assertTrue(draft['used_fallback'])
        self.assertIn('https://x/b/1', draft['body'])

    def test_uses_the_model_when_it_answers(self):
        quote = self.make_quote()
        answer = ({'subject': 'Your wedding proposal',
                   'body': 'Hello Nadia,\n\nHere it is.\nhttps://x/b/1'}, 'openai:test')
        with patch('portioning.llm.is_configured', return_value=True), \
             patch('portioning.llm.complete_structured', return_value=answer):
            draft = draft_client_message(quote, KIND_SIGN_LINK, 'email', url='https://x/b/1')
        self.assertFalse(draft['used_fallback'])
        self.assertEqual(draft['subject'], 'Your wedding proposal')
        self.assertEqual(draft['model_used'], 'openai:test')

    def test_a_dropped_link_is_restored(self):
        """A model that loses the URL would send the client nowhere."""
        quote = self.make_quote()
        answer = ({'subject': 'Proposal', 'body': 'Hello Nadia,\n\nNo link here.'}, 'm')
        with patch('portioning.llm.is_configured', return_value=True), \
             patch('portioning.llm.complete_structured', return_value=answer):
            draft = draft_client_message(quote, KIND_SIGN_LINK, 'email', url='https://x/b/1')
        self.assertIn('https://x/b/1', draft['body'])

    def test_long_dashes_never_survive(self):
        quote = self.make_quote()
        answer = ({'subject': 'A — B', 'body': 'Hello — goodbye'}, 'm')
        with patch('portioning.llm.is_configured', return_value=True), \
             patch('portioning.llm.complete_structured', return_value=answer):
            draft = draft_client_message(quote, KIND_COMPOSE, 'email')
        self.assertNotIn('—', draft['body'])
        self.assertNotIn('—', draft['subject'])

    def test_context_carries_the_booking_and_hides_internal_notes(self):
        """The payload is what's worth pinning; the prose isn't."""
        quote = self.make_quote(internal_notes='MARGIN IS THIN', notes='Client notes')
        context = build_context(
            quote, KIND_SIGN_LINK, 'email',
            url='https://x/b/1', attachment_name='Quote-1.pdf',
        )
        self.assertIn('Client name: Nadia Okonjo', context)
        self.assertIn('Guest count: 100', context)
        self.assertIn('Event date', context)
        self.assertIn('Total agreed price', context)
        self.assertIn('Attached to this message: Quote-1.pdf', context)
        self.assertIn('Link to include exactly as written: https://x/b/1', context)
        self.assertNotIn('MARGIN IS THIN', context)

    def test_context_states_the_stage_so_wording_matches_it(self):
        quote = self.make_quote()
        proposal = build_context(quote, KIND_SIGN_LINK, 'email')
        confirmation = build_context(quote, KIND_SIGNED_COPY, 'email')
        self.assertIn('proposal', proposal)
        self.assertIn('already signed', confirmation)
        self.assertNotIn('already signed', proposal)

    def test_a_lead_context_never_leaks_the_internal_record(self):
        lead = make_lead(org=self.org, notes='INTERNAL: chasing hard', budget=99999)
        context = build_context(lead, KIND_COMPOSE, 'email')
        self.assertIn('Client name: John Smith', context)
        self.assertNotIn('INTERNAL', context)
        self.assertNotIn('99999', context)


# ── the endpoints ────────────────────────────────────────────────────────────

class ClientMessageEndpointTests(MessagingTestBase):

    def setUp(self):
        super().setUp()
        connect_mailbox(self.org)
        self.quote = self.make_quote(status=QuoteStatus.DRAFT)

    def _draft(self, **payload):
        return self.staff.post(
            f'/api/bookings/quotes/{self.quote.pk}/draft-message/', payload, format='json',
        )

    def test_draft_returns_everything_the_modal_needs(self):
        with patch('portioning.llm.is_configured', return_value=False):
            resp = self._draft(kind=KIND_SIGN_LINK, channel='email')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['subject'])
        self.assertTrue(resp.data['body'])
        self.assertEqual(resp.data['channel'], 'email')
        self.assertTrue(resp.data['used_fallback'])
        self.assertFalse(resp.data['llm_available'])
        self.assertTrue(resp.data['attachment_filename'].endswith('.pdf'))
        self.quote.refresh_from_db()
        self.assertEqual(
            resp.data['link'], f'https://app.example.com/b/{self.quote.public_token}',
        )
        self.assertTrue(resp.data['availability']['email']['available'])

    def test_draft_does_not_render_a_pdf_just_to_name_it(self):
        with patch('portioning.llm.is_configured', return_value=False), \
             patch('bookings.pdf.generate_quote_pdf') as render:
            resp = self._draft(kind=KIND_SIGN_LINK, channel='email')
        self.assertEqual(resp.status_code, 200)
        render.assert_not_called()

    def test_whatsapp_draft_has_no_attachment(self):
        with patch('portioning.llm.is_configured', return_value=False):
            resp = self._draft(kind=KIND_SIGN_LINK, channel='whatsapp')
        self.assertEqual(resp.data['attachment_filename'], '')

    def test_send_records_what_the_rep_actually_approved(self):
        resp = self.staff.post(
            f'/api/bookings/quotes/{self.quote.pk}/send-message/',
            {'kind': KIND_SIGN_LINK, 'channel': 'email',
             'subject': 'Edited subject', 'body': 'Edited body https://x/b/1'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        row = WhatsAppMessage.objects.get(quote=self.quote)
        self.assertEqual(row.subject, 'Edited subject')
        self.assertEqual(row.body, 'Edited body https://x/b/1')
        self.assertEqual(email_service.outbox[0]['subject'], 'Edited subject')
        self.assertFalse(row.is_automatic)

    def test_send_requires_a_body(self):
        resp = self.staff.post(
            f'/api/bookings/quotes/{self.quote.pk}/send-message/',
            {'kind': KIND_SIGN_LINK, 'channel': 'email', 'body': '  '}, format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_send_without_a_mailbox_400s_with_the_reason(self):
        ConnectedMailbox.objects.for_org(self.org).delete()
        resp = self.staff.post(
            f'/api/bookings/quotes/{self.quote.pk}/send-message/',
            {'kind': KIND_SIGN_LINK, 'channel': 'email', 'body': 'hi'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['reason'], messaging.NO_MAILBOX)

    def test_send_to_a_contact_with_no_email_400s_differently(self):
        self.contact.email = ''
        self.contact.save()
        resp = self.staff.post(
            f'/api/bookings/quotes/{self.quote.pk}/send-message/',
            {'kind': KIND_SIGN_LINK, 'channel': 'email', 'body': 'hi'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['reason'], messaging.NO_EMAIL_ADDRESS)

    def test_message_list_is_scoped_to_the_booking(self):
        other = self.make_quote()
        WhatsAppMessage.objects.create(organisation=self.org, quote=self.quote, body='mine')
        WhatsAppMessage.objects.create(organisation=self.org, quote=other, body='theirs')
        resp = self.staff.get(f'/api/bookings/quotes/{self.quote.pk}/messages/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([r['body'] for r in resp.data], ['mine'])

    def test_serializer_exposes_the_new_ledger_fields(self):
        WhatsAppMessage.objects.create(
            organisation=self.org, quote=self.quote, channel='email',
            to_email='nadia@example.com', subject='Subject line',
            attachment_filename='Quote-1.pdf', body='b', status='sent',
        )
        row = self.staff.get(f'/api/bookings/quotes/{self.quote.pk}/messages/').data[0]
        for field in ('channel', 'to_email', 'subject', 'attachment_filename',
                      'recipient', 'is_automatic', 'quote', 'event'):
            self.assertIn(field, row)
        self.assertEqual(row['recipient'], 'nadia@example.com')
        self.assertTrue(row['is_automatic'])

    def test_event_endpoints_mirror_the_quote_ones(self):
        event = self.make_event()
        with patch('portioning.llm.is_configured', return_value=False):
            draft = self.staff.post(
                f'/api/events/{event.pk}/draft-message/',
                {'kind': KIND_SIGN_LINK, 'channel': 'email'}, format='json',
            )
        self.assertEqual(draft.status_code, 200)

        send = self.staff.post(
            f'/api/events/{event.pk}/send-message/',
            {'kind': KIND_SIGN_LINK, 'channel': 'email', 'body': 'body'}, format='json',
        )
        self.assertEqual(send.status_code, 201)
        self.assertEqual(WhatsAppMessage.objects.get(event=event).channel, 'email')

        listed = self.staff.get(f'/api/events/{event.pk}/messages/')
        self.assertEqual(len(listed.data), 1)

    def test_lead_compose_sends_and_ledgers_against_the_lead(self):
        lead = make_lead(org=self.org, contact_email='john@test.com')
        resp = self.staff.post(
            f'/api/bookings/leads/{lead.pk}/send-message/',
            {'kind': KIND_COMPOSE, 'channel': 'email',
             'subject': 'Hello', 'body': 'A note'}, format='json',
        )
        self.assertEqual(resp.status_code, 201)
        row = WhatsAppMessage.objects.get(lead=lead)
        self.assertEqual(row.channel, 'email')
        self.assertEqual(row.to_email, 'john@test.com')
        self.assertIsNone(row.quote_id)

    def test_a_lead_cannot_be_sent_a_sign_link(self):
        lead = make_lead(org=self.org)
        resp = self.staff.post(
            f'/api/bookings/leads/{lead.pk}/send-message/',
            {'kind': KIND_SIGN_LINK, 'channel': 'email', 'body': 'x'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_an_unknown_kind_is_refused(self):
        resp = self._draft(kind='nonsense')
        self.assertEqual(resp.status_code, 400)

    def test_another_orgs_booking_is_not_reachable(self):
        rival = Organisation.objects.create(name='Rival', slug='rival-msg', country='US')
        their_contact = make_contact(org=rival, name='Someone', email='x@y.com')
        their_quote = make_quote(org=rival, primary_contact=their_contact)
        for url in (f'/api/bookings/quotes/{their_quote.pk}/draft-message/',
                    f'/api/bookings/quotes/{their_quote.pk}/send-message/'):
            self.assertEqual(self.staff.post(url, {'body': 'x'}, format='json').status_code, 404)
        self.assertEqual(
            self.staff.get(f'/api/bookings/quotes/{their_quote.pk}/messages/').status_code, 404,
        )

    def test_anonymous_callers_are_rejected(self):
        anon = APIClient()
        resp = anon.post(f'/api/bookings/quotes/{self.quote.pk}/send-message/',
                         {'body': 'x'}, format='json')
        self.assertIn(resp.status_code, (401, 403))


# ── AC5 / AC6: the automatic signed copy ─────────────────────────────────────

class SignedCopyAutoSendTests(MessagingTestBase):

    def _sign(self, booking, signer_email=''):
        return sign_booking(
            booking, signer_name='Nadia Okonjo', signer_email=signer_email,
            signature_image='', ip='127.0.0.1', user_agent='tests',
        )

    def test_signing_emails_the_frozen_signed_pdf(self):
        connect_mailbox(self.org)
        quote = self.make_quote(status=QuoteStatus.SENT)
        sig = self._sign(quote)

        self.assertEqual(len(email_service.outbox), 1)
        sent = email_service.outbox[0]
        filename, content, _ = sent['attachments'][0]
        self.assertTrue(filename.endswith('-signed.pdf'))
        self.assertEqual(content, bytes(sig.signed_pdf))

        row = WhatsAppMessage.objects.get(quote=quote)
        self.assertEqual(row.status, 'sent')
        self.assertTrue(row.is_automatic)
        self.assertIsNone(row.sent_by)

    def test_the_signer_gets_it_at_the_address_they_signed_with(self):
        connect_mailbox(self.org)
        quote = self.make_quote(status=QuoteStatus.SENT)
        self._sign(quote, signer_email='nadia.personal@example.com')
        self.assertEqual(email_service.outbox[0]['to'], ['nadia.personal@example.com'])

    def test_auto_send_never_asks_the_model_for_wording(self):
        """Nobody reviews an automatic send, so the LLM proposes nothing here."""
        connect_mailbox(self.org)
        quote = self.make_quote(status=QuoteStatus.SENT)
        with patch('bookings.services.message_drafter.draft_client_message') as drafter:
            self._sign(quote)
        drafter.assert_not_called()

    def test_signing_succeeds_when_the_mailbox_is_broken(self):
        """AC6: a messaging failure must never cost a client their signature."""
        connect_mailbox(self.org)
        quote = self.make_quote(status=QuoteStatus.SENT)
        with patch('bookings.services.email.send_via_mailbox',
                   side_effect=email_service.MailboxSendFailed('provider down')):
            sig = self._sign(quote)

        self.assertIsNotNone(sig.pk)
        self.assertTrue(sig.signed_pdf)
        rows = {r.status: r for r in WhatsAppMessage.objects.filter(quote=quote)}
        self.assertIn('provider down', rows['failed'].error_message)
        # The client still got nothing, and a human could fix that — so the
        # ledger leaves the obligation visible rather than only an error.
        self.assertIn(WhatsAppMessage.TO_SEND, rows)

    def test_signing_survives_a_total_messaging_explosion(self):
        connect_mailbox(self.org)
        quote = self.make_quote(status=QuoteStatus.SENT)
        with patch('bookings.services.messaging.send_signed_copy',
                   side_effect=RuntimeError('everything is broken')):
            sig = self._sign(quote)
        self.assertIsNotNone(sig.pk)
        self.assertTrue(sig.signed_pdf)

    def test_shortcut_only_org_gets_a_task_row_not_a_claimed_send(self):
        """wa.me needs a human tap, so nothing may claim to have been sent."""
        quote = self.make_quote(status=QuoteStatus.SENT)
        self._sign(quote)

        row = WhatsAppMessage.objects.get(quote=quote)
        self.assertEqual(row.status, WhatsAppMessage.TO_SEND)
        self.assertTrue(row.is_automatic)
        self.assertIn(str(quote.public_token), row.body)
        self.assertEqual(email_service.outbox, [])

    @override_settings(**TWILIO_ACCOUNT)
    def test_platform_whatsapp_auto_sends(self):
        enable_twilio(self.org)
        quote = self.make_quote(status=QuoteStatus.SENT)
        with patch('twilio.rest.Client', return_value=twilio_ok('SMsigned')):
            self._sign(quote)
        row = WhatsAppMessage.objects.get(quote=quote)
        self.assertEqual(row.channel, 'whatsapp')
        self.assertEqual(row.status, 'sent')
        self.assertEqual(row.twilio_sid, 'SMsigned')

    @override_settings(**TWILIO_ACCOUNT)
    def test_both_api_channels_are_used_when_both_exist(self):
        connect_mailbox(self.org)
        enable_twilio(self.org)
        quote = self.make_quote(status=QuoteStatus.SENT)
        with patch('twilio.rest.Client', return_value=twilio_ok()):
            self._sign(quote)
        channels = set(WhatsAppMessage.objects.filter(quote=quote)
                       .values_list('channel', flat=True))
        self.assertEqual(channels, {'email', 'whatsapp'})

    def test_no_channel_at_all_records_the_failure_rather_than_silence(self):
        self.contact.phone = ''
        self.contact.save()
        quote = self.make_quote(status=QuoteStatus.SENT)
        sig = self._sign(quote)

        self.assertIsNotNone(sig.pk)
        row = WhatsAppMessage.objects.get(quote=quote)
        self.assertEqual(row.status, 'failed')
        self.assertIn('signing succeeded', row.error_message)

    def test_signing_an_event_mirrors_the_quote_path(self):
        connect_mailbox(self.org)
        event = self.make_event(status=EventStatus.TENTATIVE)
        self._sign(event)
        row = WhatsAppMessage.objects.get(event=event)
        self.assertEqual(row.channel, 'email')
        self.assertEqual(row.status, 'sent')
        self.assertTrue(row.is_automatic)

    def test_signing_through_the_public_endpoint_still_works(self):
        connect_mailbox(self.org)
        quote = self.make_quote(status=QuoteStatus.SENT)
        quote.ensure_public_token()
        resp = APIClient().post(
            f'/api/public/bookings/{quote.public_token}/sign/',
            {'signer_name': 'Nadia Okonjo', 'consent': True}, format='json',
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(email_service.outbox), 1)


# ── AC9: the existing lead flow is untouched ─────────────────────────────────

class LeadFlowUnchangedTests(MessagingTestBase):

    @override_settings(**TWILIO_ACCOUNT)
    def test_lead_whatsapp_send_still_writes_a_lead_row(self):
        enable_twilio(self.org)
        lead = make_lead(org=self.org, contact_phone='+447700900999')
        from bookings.services.whatsapp import WhatsAppService
        with patch('twilio.rest.Client', return_value=twilio_ok('SMlead')):
            msg = WhatsAppService(self.org).send_message(lead, 'Hello there')

        self.assertEqual(msg.lead_id, lead.pk)
        self.assertIsNone(msg.quote_id)
        self.assertEqual(msg.channel, 'whatsapp')
        self.assertEqual(msg.status, 'sent')
        self.assertEqual(msg.twilio_sid, 'SMlead')

    def test_unconfigured_org_still_reports_twilio_first(self):
        lead = make_lead(org=self.org, contact_phone='')
        from bookings.services.whatsapp import WhatsAppService
        with self.assertRaises(ValueError) as caught:
            WhatsAppService(self.org).send_message(lead, 'Hello')
        self.assertIn('not configured', str(caught.exception))
