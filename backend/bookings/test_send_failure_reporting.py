"""What the rep is told when a send fails (REL-481).

Found in production: revoking the Google grant and then sending produced
everything right except the one thing the person was looking at. The mailbox
flipped, the ledger row recorded "Access to <address> was revoked. Please
reconnect.", and the modal said `Server error (504)`.

`MailboxError` does not inherit `MessagingError`, so a revoked grant discovered
mid-send fell through every specific handler into the generic one and came back
as a 5xx — a category the frontend deliberately strips the body from. The real
sentence existed at both ends and was discarded in the middle.
"""
from datetime import timedelta
from unittest.mock import patch

from django.test import override_settings
from django.utils import timezone

from bookings.models import ConnectedMailbox, WhatsAppMessage
from bookings.models.quotes import QuoteStatus
from bookings.services import email as email_service
from bookings.services import mailbox_oauth
from bookings.services import messaging
from bookings.services.messaging_kinds import KIND_COMPOSE
from bookings.test_client_messaging import MessagingTestBase, connect_mailbox

# A deployment that really does have a Google OAuth app, so the fake transport
# stands aside and the real token/send path runs.
REAL_PROVIDER = dict(
    GOOGLE_OAUTH_CLIENT_ID='client-id', GOOGLE_OAUTH_CLIENT_SECRET='client-secret',
    EMAIL_FAKE_TRANSPORT=False,
    FRONTEND_BASE_URL='https://app.example.com',
)


@override_settings(**REAL_PROVIDER)
class RevokedGrantTests(MessagingTestBase):
    def setUp(self):
        super().setUp()
        connect_mailbox(self.org)
        # Expire the access token so the send has to refresh — which is where a
        # revoked grant is discovered.
        ConnectedMailbox.objects.for_org(self.org).update(
            access_token_expires_at=timezone.now() - timedelta(minutes=5),
        )
        self.quote = self.make_quote(status=QuoteStatus.DRAFT)

    def _send(self):
        return self.staff.post(
            f'/api/bookings/quotes/{self.quote.pk}/send-message/',
            {'kind': KIND_COMPOSE, 'channel': 'email', 'body': 'A quick note'},
            format='json',
        )

    def _revoked(self):
        return patch.object(
            mailbox_oauth, 'refresh_access_token',
            side_effect=mailbox_oauth.OAuthExchangeError('invalid_grant: Token has been expired or revoked.'),
        )

    def test_the_rep_is_told_to_reconnect_not_given_a_status_code(self):
        with self._revoked():
            resp = self._send()
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['reason'], messaging.MAILBOX_NEEDS_RECONNECT)
        self.assertIn('reconnect', resp.data['detail'].lower())

    def test_it_is_not_reported_as_a_server_error(self):
        # The whole defect: a 5xx here means the UI shows a status code, because
        # 5xx bodies are stripped as untrusted.
        with self._revoked():
            resp = self._send()
        self.assertLess(resp.status_code, 500)

    def test_the_mailbox_still_flips_so_the_next_send_is_blocked_up_front(self):
        with self._revoked():
            self._send()
        mailbox = ConnectedMailbox.objects.for_org(self.org).get()
        self.assertEqual(mailbox.status, ConnectedMailbox.NEEDS_RECONNECT)

    def test_the_ledger_still_keeps_the_evidence(self):
        with self._revoked():
            self._send()
        row = WhatsAppMessage.objects.get(quote=self.quote)
        self.assertEqual(row.status, 'failed')
        self.assertIn('revoked', row.error_message.lower())

    def test_the_reason_matches_what_the_pre_flight_check_would_have_said(self):
        """Discovering it mid-send must not look different from catching it early.

        The modal keys its copy off `reason`; two vocabularies for one state is
        how the wrong sentence gets shown.
        """
        with self._revoked():
            mid_send = self._send()
        # Now the mailbox is flipped, so the *next* attempt is refused up front.
        pre_flight = self._send()
        self.assertEqual(mid_send.data['reason'], pre_flight.data['reason'])
        self.assertEqual(pre_flight.status_code, 400)


@override_settings(**REAL_PROVIDER)
class TransportFailureTests(MessagingTestBase):
    """A genuine provider failure stays a 5xx — but must carry a readable body."""

    def setUp(self):
        super().setUp()
        connect_mailbox(self.org)
        self.quote = self.make_quote(status=QuoteStatus.DRAFT)

    def test_a_transport_failure_still_says_what_went_wrong(self):
        with patch.object(
            email_service, 'send_via_mailbox',
            side_effect=email_service.MailboxSendFailed('Gmail refused the message'),
        ):
            resp = self.staff.post(
                f'/api/bookings/quotes/{self.quote.pk}/send-message/',
                {'kind': KIND_COMPOSE, 'channel': 'email', 'body': 'Hi'},
                format='json',
            )
        self.assertEqual(resp.status_code, 502)
        # The frontend now surfaces a structured `detail` on 5xx, so this string
        # is what the rep reads.
        self.assertIn('Gmail refused the message', resp.data['detail'])
