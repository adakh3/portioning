"""A composed message can carry the booking PDF (REL-478), and every
combination of connected/unconnected channels still renders an honest answer.

The attachment is opt-in: `sign_link` and `signed_copy` always carry their
document, but an ad-hoc "quick question" dragging a full quote along would be
worse than occasionally forgetting one.
"""
from unittest.mock import patch

from django.test import override_settings

from bookings.models import ConnectedMailbox, OrgSettings, WhatsAppMessage
from bookings.models.quotes import QuoteStatus
from bookings.services import email as email_service
from bookings.services import messaging
from bookings.services.messaging_kinds import KIND_COMPOSE, KIND_SIGN_LINK
from bookings.test_client_messaging import MessagingTestBase, connect_mailbox
from bookings.tests import make_lead


class ComposeAttachmentTests(MessagingTestBase):
    def setUp(self):
        super().setUp()
        connect_mailbox(self.org)
        self.quote = self.make_quote(status=QuoteStatus.DRAFT)

    def _send(self, **payload):
        body = {'kind': KIND_COMPOSE, 'channel': 'email', 'body': 'A quick note'}
        body.update(payload)
        return self.staff.post(
            f'/api/bookings/quotes/{self.quote.pk}/send-message/', body, format='json',
        )

    def _draft(self, **payload):
        body = {'kind': KIND_COMPOSE, 'channel': 'email'}
        body.update(payload)
        return self.staff.post(
            f'/api/bookings/quotes/{self.quote.pk}/draft-message/', body, format='json',
        )

    # ── sending ──

    def test_asking_for_the_pdf_attaches_it(self):
        resp = self._send(attach=True)
        self.assertEqual(resp.status_code, 201)
        sent = email_service.outbox[0]
        self.assertEqual(len(sent['attachments']), 1)
        filename, content, mimetype = sent['attachments'][0]
        self.assertEqual(filename, f'Quote-{self.quote.pk}.pdf')
        self.assertEqual(mimetype, 'application/pdf')
        self.assertTrue(content.startswith(b'%PDF'))

    def test_the_ledger_records_that_it_carried_one(self):
        # The history has to show what the client actually received.
        self._send(attach=True)
        row = WhatsAppMessage.objects.get(quote=self.quote)
        self.assertEqual(row.attachment_filename, f'Quote-{self.quote.pk}.pdf')

    def test_not_asking_sends_nothing_with_it(self):
        resp = self._send()
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(email_service.outbox[0]['attachments'], [])
        self.assertEqual(WhatsAppMessage.objects.get(quote=self.quote).attachment_filename, '')

    def test_whatsapp_ignores_the_flag_entirely(self):
        # WhatsApp carries a link. Asking for an attachment there must not
        # quietly become an email, or silently half-work.
        OrgSettings.for_org(self.org)
        resp = self._send(channel='whatsapp', attach=True)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(email_service.outbox, [])

    def test_a_lead_has_no_document_to_attach(self):
        lead = make_lead(org=self.org, contact_email='lead@example.com')
        resp = self.staff.post(
            f'/api/bookings/leads/{lead.pk}/send-message/',
            {'kind': KIND_COMPOSE, 'channel': 'email', 'body': 'Hi', 'attach': True},
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(email_service.outbox[0]['attachments'], [])

    def test_a_pdf_that_will_not_render_loses_the_attachment_not_the_message(self):
        with patch('bookings.pdf.generate_quote_pdf', side_effect=RuntimeError('boom')):
            resp = self._send(attach=True)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(email_service.outbox[0]['attachments'], [])
        # And the ledger says no attachment, rather than claiming one that
        # never left.
        self.assertEqual(WhatsAppMessage.objects.get(quote=self.quote).attachment_filename, '')

    def test_the_always_attached_kinds_are_unchanged(self):
        resp = self.staff.post(
            f'/api/bookings/quotes/{self.quote.pk}/send-message/',
            {'kind': KIND_SIGN_LINK, 'channel': 'email', 'body': 'Please sign'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(email_service.outbox[0]['attachments']), 1)

    # ── drafting ──

    def test_the_draft_is_told_when_something_is_attached(self):
        with patch('portioning.llm.is_configured', return_value=False):
            resp = self._draft(attach=True)
        self.assertEqual(resp.data['attachment_filename'], f'Quote-{self.quote.pk}.pdf')

    def test_the_draft_is_told_when_nothing_is(self):
        # Otherwise a composed message goes out saying "as attached" with
        # nothing attached.
        with patch('portioning.llm.is_configured', return_value=False):
            resp = self._draft()
        self.assertEqual(resp.data['attachment_filename'], '')

    def test_the_modal_is_told_whether_to_offer_the_option(self):
        with patch('portioning.llm.is_configured', return_value=False):
            self.assertTrue(self._draft().data['attachment_available'])
            self.assertFalse(self._draft(channel='whatsapp').data['attachment_available'])

    def test_a_lead_is_never_offered_the_option(self):
        lead = make_lead(org=self.org, contact_email='lead@example.com')
        with patch('portioning.llm.is_configured', return_value=False):
            resp = self.staff.post(
                f'/api/bookings/leads/{lead.pk}/draft-message/',
                {'kind': KIND_COMPOSE, 'channel': 'email'}, format='json',
            )
        self.assertFalse(resp.data['attachment_available'])

    def test_naming_the_attachment_still_does_not_render_it(self):
        with patch('portioning.llm.is_configured', return_value=False), \
             patch('bookings.pdf.generate_quote_pdf') as render:
            self._draft(attach=True)
        render.assert_not_called()


class ChannelMatrixTests(MessagingTestBase):
    """Every combination of email/WhatsApp availability gives an honest answer.

    Four states, and the modal renders a different thing for each — so each one
    needs to be a fact, not an assumption.
    """

    def setUp(self):
        super().setUp()
        self.quote = self.make_quote(status=QuoteStatus.DRAFT)
        self.settings_row = OrgSettings.for_org(self.org)

    def _availability(self):
        return messaging.channel_availability(self.org, self.quote)

    def _enable_platform_whatsapp(self):
        """Platform sending needs all three: the org's sender number, the org
        toggle, and the platform Twilio credentials. Any one missing degrades to
        the shortcut, which is a different sentence in the UI."""
        self.settings_row.twilio_whatsapp_number = '+14155550100'
        self.settings_row.whatsapp_enabled = True
        self.settings_row.save()

    @override_settings(TWILIO_ACCOUNT_SID='AC123', TWILIO_AUTH_TOKEN='secret')
    def test_email_connected_and_whatsapp_on_the_platform(self):
        connect_mailbox(self.org)
        self._enable_platform_whatsapp()
        avail = self._availability()
        self.assertTrue(avail['email']['available'])
        self.assertTrue(avail['whatsapp']['available'])
        self.assertEqual(avail['whatsapp']['mechanism'], 'platform')

    def test_an_org_number_without_platform_credentials_is_still_a_shortcut(self):
        # The number alone reads like "configured"; it isn't, and promising
        # tracked delivery we can't provide is the failure to avoid.
        connect_mailbox(self.org)
        self._enable_platform_whatsapp()
        self.assertEqual(self._availability()['whatsapp']['mechanism'], 'shortcut')

    def test_email_connected_and_whatsapp_only_as_a_shortcut(self):
        connect_mailbox(self.org)
        avail = self._availability()
        self.assertTrue(avail['email']['available'])
        self.assertTrue(avail['whatsapp']['available'])
        self.assertNotEqual(avail['whatsapp']['mechanism'], 'platform')

    def test_no_mailbox_says_so_rather_than_just_being_off(self):
        self._enable_platform_whatsapp()
        avail = self._availability()
        self.assertFalse(avail['email']['available'])
        self.assertEqual(avail['email']['reason'], messaging.NO_MAILBOX)
        self.assertTrue(avail['whatsapp']['available'])

    def test_neither_channel_configured_still_leaves_the_whatsapp_shortcut(self):
        # The caterer's own phone is always a route, so "nothing configured" is
        # not the same as "cannot message".
        avail = self._availability()
        self.assertFalse(avail['email']['available'])
        self.assertTrue(avail['whatsapp']['available'])

    def test_a_client_with_no_contact_details_has_no_channel_at_all(self):
        connect_mailbox(self.org)
        self.contact.email = ''
        self.contact.phone = ''
        self.contact.save()
        avail = self._availability()
        self.assertFalse(avail['email']['available'])
        self.assertEqual(avail['email']['reason'], messaging.NO_EMAIL_ADDRESS)
        self.assertFalse(avail['whatsapp']['available'])

    def test_a_mailbox_needing_reconnection_is_distinct_from_having_none(self):
        # Different cause, different fix, different sentence in the UI.
        connect_mailbox(self.org, status=ConnectedMailbox.NEEDS_RECONNECT)
        avail = self._availability()
        self.assertFalse(avail['email']['available'])
        self.assertEqual(avail['email']['reason'], messaging.MAILBOX_NEEDS_RECONNECT)
