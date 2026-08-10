"""Outbound sends are bounded in time (REL-474).

A send can run inside a **client's** request: `sign_booking` posts the signed
copy while the customer is still waiting on the public sign page. Nothing in
that response depends on the send finishing, so a slow provider must cost them a
few seconds — not a timeout page for a booking they successfully signed.

Twilio's default client sets no timeout at all, and the mailbox path inherited
the 20s meant for interactive OAuth, so the worst case was "however long the
provider hangs". These pin the bound, and pin that the *interactive* connect
flow keeps its generous budget.
"""
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from django.utils import timezone

from bookings.models import ConnectedMailbox, OrgSettings
from bookings.services import email as email_service
from bookings.services import mailbox_oauth
from bookings.tests import _make_org, make_lead
from users.models import Organisation

GOOGLE_CONFIGURED = dict(
    GOOGLE_OAUTH_CLIENT_ID='id', GOOGLE_OAUTH_CLIENT_SECRET='secret',
    OAUTH_REDIRECT_BASE='https://catering.example.com',
)
TWILIO = dict(TWILIO_ACCOUNT_SID='ACtest', TWILIO_AUTH_TOKEN='token')


def _response(status_code=200, json_data=None, headers=None):
    response = MagicMock()
    response.status_code = status_code
    response.headers = headers or {}
    response.json.return_value = json_data if json_data is not None else {}
    return response


def _mailbox(org, expired=False):
    mailbox = ConnectedMailbox(
        organisation=org, provider=ConnectedMailbox.GOOGLE,
        email_address='owner@acme.com', status=ConnectedMailbox.CONNECTED,
        access_token_expires_at=timezone.now() + timedelta(
            hours=-1 if expired else 1,
        ),
    )
    mailbox.refresh_token = 'refresh'
    mailbox.access_token = 'access'
    mailbox.save()
    return mailbox


@override_settings(OUTBOUND_SEND_TIMEOUT=8, **GOOGLE_CONFIGURED)
class MailboxSendTimeoutTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(
            name='Timeout Co', slug='timeout-co', country='US',
        )

    def _send(self):
        return email_service.send_via_mailbox(
            self.org, to='client@example.com', subject='s', body='b',
        )

    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_the_send_call_is_bounded_by_the_send_budget(self, post):
        _mailbox(self.org)
        post.return_value = _response(json_data={'id': 'gmail-1'})

        self._send()

        self.assertEqual(post.call_args.kwargs['timeout'], 8)
        # Not the interactive budget — that's the bug this pins.
        self.assertNotEqual(post.call_args.kwargs['timeout'], mailbox_oauth.HTTP_TIMEOUT)

    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_token_refresh_on_the_way_to_a_send_is_bounded_too(self, post):
        """Otherwise a stale token silently doubles what the client waits."""
        _mailbox(self.org, expired=True)
        post.side_effect = [
            _response(json_data={'access_token': 'new', 'expires_in': 3600,
                                 'refresh_token': 'refresh'}),
            _response(json_data={'id': 'gmail-1'}),
        ]

        self._send()

        self.assertEqual(post.call_count, 2)
        for call in post.call_args_list:
            self.assertEqual(call.kwargs['timeout'], 8)

    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_the_interactive_connect_flow_keeps_its_generous_budget(self, post):
        """A caterer watching a consent redirect would rather wait than restart,
        so shortening the send path must not shorten this one."""
        post.return_value = _response(json_data={
            'refresh_token': 'r', 'access_token': 'a', 'expires_in': 3600,
            'id_token': 'x.eyJlbWFpbCI6ICJvd25lckBhY21lLmNvbSJ9.y',
        })

        mailbox_oauth.exchange_code(mailbox_oauth.GOOGLE, 'code-123')

        self.assertEqual(post.call_args.kwargs['timeout'], mailbox_oauth.HTTP_TIMEOUT)
        self.assertEqual(mailbox_oauth.HTTP_TIMEOUT, 20)

    @override_settings(OUTBOUND_SEND_TIMEOUT=3)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_the_bound_is_configurable_per_deployment(self, post):
        _mailbox(self.org)
        post.return_value = _response(json_data={'id': 'gmail-1'})

        self._send()

        self.assertEqual(post.call_args.kwargs['timeout'], 3)


@override_settings(OUTBOUND_SEND_TIMEOUT=8, **TWILIO)
class TwilioSendTimeoutTests(TestCase):
    def setUp(self):
        self.org = _make_org(slug='twilio-timeout')
        s = OrgSettings.for_org(self.org)
        s.whatsapp_enabled = True
        s.twilio_whatsapp_number = '+14155238886'
        s.save()

    def test_the_twilio_client_is_given_a_timeout(self):
        """Twilio's default HTTP client has none, so a hung provider hangs
        whatever called us — including a client's own signing request."""
        from bookings.services.whatsapp import send_via_twilio
        lead = make_lead(org=self.org, contact_phone='+447700900123')

        client = MagicMock()
        client.messages.create.return_value = MagicMock(sid='SM1')
        with patch('twilio.rest.Client', return_value=client) as client_cls, \
             patch('twilio.http.http_client.TwilioHttpClient') as http_client_cls:
            send_via_twilio(
                self.org, to_phone=lead.contact_phone, body='hi',
                parent={'lead': lead},
            )

        http_client_cls.assert_called_once_with(timeout=8)
        # And that client is the one actually handed to Twilio, not built and
        # dropped on the floor.
        self.assertIs(
            client_cls.call_args.kwargs['http_client'],
            http_client_cls.return_value,
        )
