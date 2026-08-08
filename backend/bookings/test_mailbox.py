"""The caterer's connected mailbox: OAuth connect/disconnect + send transport (REL-460).

No real Google/Microsoft app is ever contacted — every provider HTTP call is
patched at the `requests` boundary inside `bookings.services.mailbox_oauth`.
"""
import base64
import email as email_lib
import json
from datetime import timedelta
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

from cryptography.fernet import Fernet, InvalidToken
from django.core import signing
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.models import ConnectedMailbox
from bookings.serializers.mailbox import ConnectedMailboxSerializer
from bookings.services import email as email_service
from bookings.services import mailbox_oauth
from bookings.services.encryption import decrypt, encrypt
from bookings.views.mailbox import NONCE_COOKIE, STATE_SALT, _hash_nonce
from tests.base import get_test_user
from users.models import Organisation, User

STATUS_URL = '/api/integrations/email/'
CONNECT_URL = '/api/integrations/email/connect/'
CALLBACK_URL = '/api/integrations/email/callback/'
DISCONNECT_URL = '/api/integrations/email/disconnect/'

GOOGLE_CONFIGURED = dict(
    GOOGLE_OAUTH_CLIENT_ID='google-client-id',
    GOOGLE_OAUTH_CLIENT_SECRET='google-client-secret',
    OAUTH_REDIRECT_BASE='https://catering.example.com',
)
MICROSOFT_CONFIGURED = dict(
    MS_OAUTH_CLIENT_ID='ms-client-id',
    MS_OAUTH_CLIENT_SECRET='ms-client-secret',
    OAUTH_REDIRECT_BASE='https://catering.example.com',
)
# No OAuth app, fake transport on: local dev and CI.
NOTHING_CONFIGURED = dict(
    GOOGLE_OAUTH_CLIENT_ID='', GOOGLE_OAUTH_CLIENT_SECRET='',
    MS_OAUTH_CLIENT_ID='', MS_OAUTH_CLIENT_SECRET='',
    EMAIL_FAKE_TRANSPORT=True,
)
# No OAuth app and no fake transport: a production box whose credentials never
# arrived. Nothing may silently pretend to work here.
MISCONFIGURED_PROD = dict(
    GOOGLE_OAUTH_CLIENT_ID='', GOOGLE_OAUTH_CLIENT_SECRET='',
    MS_OAUTH_CLIENT_ID='', MS_OAUTH_CLIENT_SECRET='',
    EMAIL_FAKE_TRANSPORT=False,
)


def _response(status_code=200, json_data=None, headers=None):
    response = MagicMock()
    response.status_code = status_code
    response.headers = headers or {}
    if json_data is None:
        response.json.side_effect = ValueError('no json')
    else:
        response.json.return_value = json_data
    return response


def _id_token(address):
    """A minimally believable OIDC id_token carrying an email claim."""
    payload = base64.urlsafe_b64encode(json.dumps({'email': address}).encode()).rstrip(b'=')
    return f"header.{payload.decode()}.signature"


def _make_mailbox(org, provider=ConnectedMailbox.GOOGLE, **kwargs):
    mailbox = ConnectedMailbox(
        organisation=org,
        provider=provider,
        email_address=kwargs.pop('email_address', 'owner@acme.com'),
        status=kwargs.pop('status', ConnectedMailbox.CONNECTED),
        access_token_expires_at=kwargs.pop(
            'access_token_expires_at', timezone.now() + timedelta(hours=1),
        ),
        **kwargs,
    )
    mailbox.refresh_token = 'refresh-token-abc'
    mailbox.access_token = 'access-token-xyz'
    mailbox.save()
    return mailbox


def _other_org():
    return Organisation.objects.create(name='Rival Catering', slug='rival', country='US')


_UNSET = object()


# ──────────────────────────────────────────────────────────────────────
# Model + encryption at rest
# ──────────────────────────────────────────────────────────────────────

class TestMailboxCredentialStorage(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation

    def test_tokens_round_trip_but_are_never_stored_in_plaintext(self):
        mailbox = _make_mailbox(self.org)
        mailbox.refresh_from_db()

        self.assertEqual(mailbox.refresh_token, 'refresh-token-abc')
        self.assertEqual(mailbox.access_token, 'access-token-xyz')
        self.assertNotIn('refresh-token-abc', mailbox.refresh_token_encrypted)
        self.assertNotIn('access-token-xyz', mailbox.access_token_encrypted)

    def test_repr_and_str_never_leak_the_tokens(self):
        mailbox = _make_mailbox(self.org)
        for rendered in (repr(mailbox), str(mailbox)):
            self.assertNotIn('refresh-token-abc', rendered)
            self.assertNotIn(mailbox.refresh_token_encrypted, rendered)

    def test_blank_token_stays_blank_rather_than_encrypting_an_empty_string(self):
        mailbox = _make_mailbox(self.org)
        mailbox.access_token = ''
        self.assertEqual(mailbox.access_token_encrypted, '')
        self.assertEqual(mailbox.access_token, '')

    def test_a_listed_fallback_key_still_decrypts_older_ciphertext(self):
        """The documented way to change keys without making every caterer
        reconnect: encrypt under the new one, keep the old one readable."""
        old_key = Fernet.generate_key().decode()
        with override_settings(TOKEN_ENCRYPTION_KEY=old_key):
            legacy = encrypt('refresh-token-from-before')

        with override_settings(
            TOKEN_ENCRYPTION_KEY=Fernet.generate_key().decode(),
            TOKEN_ENCRYPTION_KEY_FALLBACKS=old_key,
        ):
            self.assertEqual(decrypt(legacy), 'refresh-token-from-before')

    def test_secret_key_is_not_a_back_door_once_a_dedicated_key_is_set(self):
        """SECRET_KEY also signs JWTs and is treated as rotatable, so it must
        not stay a silent second key to every caterer's mailbox."""
        with override_settings(TOKEN_ENCRYPTION_KEY='', TOKEN_ENCRYPTION_KEY_FALLBACKS=''):
            under_secret_key = encrypt('written-before-the-dedicated-key')

        with override_settings(
            TOKEN_ENCRYPTION_KEY=Fernet.generate_key().decode(),
            TOKEN_ENCRYPTION_KEY_FALLBACKS='',
        ):
            new_ciphertext = encrypt('written-under-the-dedicated-key')
            # Not listed as a fallback, so it is genuinely no longer a key.
            with self.assertRaises(InvalidToken):
                decrypt(under_secret_key)

        with override_settings(TOKEN_ENCRYPTION_KEY='', TOKEN_ENCRYPTION_KEY_FALLBACKS=''):
            with self.assertRaises(InvalidToken):
                decrypt(new_ciphertext)

    def test_a_passphrase_works_as_well_as_a_generated_fernet_key(self):
        with override_settings(TOKEN_ENCRYPTION_KEY='not-a-fernet-key-just-a-phrase'):
            self.assertEqual(decrypt(encrypt('secret')), 'secret')

    def test_surrounding_whitespace_on_the_key_does_not_change_it(self):
        """A key pasted into a deploy console with a stray newline must not
        quietly become a different key that strands every stored token."""
        key = Fernet.generate_key().decode()
        with override_settings(TOKEN_ENCRYPTION_KEY=key):
            ciphertext = encrypt('refresh-token')

        with override_settings(TOKEN_ENCRYPTION_KEY=f'  {key}\n'):
            self.assertEqual(decrypt(ciphertext), 'refresh-token')

    def test_access_token_validity_reflects_absence_expiry_and_the_safety_margin(self):
        mailbox = _make_mailbox(self.org)
        self.assertTrue(mailbox.access_token_valid)

        mailbox.access_token_expires_at = timezone.now() - timedelta(minutes=1)
        self.assertFalse(mailbox.access_token_valid)

        # Inside the 60s margin: technically alive, but not worth starting a send with.
        mailbox.access_token_expires_at = timezone.now() + timedelta(seconds=30)
        self.assertFalse(mailbox.access_token_valid)

        mailbox.access_token_expires_at = timezone.now() + timedelta(hours=1)
        mailbox.access_token = ''
        self.assertFalse(mailbox.access_token_valid)

    def test_mark_needs_reconnect_drops_the_dead_access_token(self):
        mailbox = _make_mailbox(self.org)
        mailbox.mark_needs_reconnect('invalid_grant')
        mailbox.refresh_from_db()

        self.assertEqual(mailbox.status, ConnectedMailbox.NEEDS_RECONNECT)
        self.assertEqual(mailbox.last_error, 'invalid_grant')
        self.assertEqual(mailbox.access_token_encrypted, '')
        self.assertIsNone(mailbox.access_token_expires_at)
        # The refresh token survives, so a reconnect isn't the only way back.
        self.assertEqual(mailbox.refresh_token, 'refresh-token-abc')

    def test_serializer_exposes_no_token_field_at_all(self):
        mailbox = _make_mailbox(self.org)
        data = ConnectedMailboxSerializer(mailbox).data

        self.assertEqual(data['email_address'], 'owner@acme.com')
        for field in data:
            self.assertNotIn('token', field, f'{field} must not be serialized')
        self.assertNotIn('refresh-token-abc', json.dumps(data))


# ──────────────────────────────────────────────────────────────────────
# Status endpoint
# ──────────────────────────────────────────────────────────────────────

class TestMailboxStatus(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_reports_no_mailbox_when_nothing_is_connected(self):
        body = self.client.get(STATUS_URL).json()
        self.assertFalse(body['connected'])
        self.assertIsNone(body['mailbox'])

    def test_reports_the_connected_address_and_provider(self):
        _make_mailbox(self.org, provider=ConnectedMailbox.MICROSOFT,
                      email_address='owner@acme.com')
        body = self.client.get(STATUS_URL).json()

        self.assertTrue(body['connected'])
        self.assertEqual(body['mailbox']['email_address'], 'owner@acme.com')
        self.assertEqual(body['mailbox']['provider'], 'microsoft')
        self.assertEqual(body['mailbox']['provider_display'], 'Microsoft')
        self.assertEqual(body['mailbox']['status'], 'connected')
        self.assertNotIn('refresh-token-abc', json.dumps(body))

    def test_surfaces_the_reconnect_state(self):
        _make_mailbox(self.org, status=ConnectedMailbox.NEEDS_RECONNECT,
                      last_error='invalid_grant')
        body = self.client.get(STATUS_URL).json()
        self.assertEqual(body['mailbox']['status'], 'needs_reconnect')

    def test_readable_by_a_salesperson_so_the_send_UI_can_ask(self):
        sp = User.objects.create(email='sp-mailbox@test.com', role='salesperson',
                                 organisation=self.org, is_active=True)
        client = APIClient()
        client.force_authenticate(sp)
        self.assertEqual(client.get(STATUS_URL).status_code, 200)

    def test_only_shows_this_orgs_mailbox(self):
        """AC8 — another org's connection is invisible here."""
        _make_mailbox(_other_org(), email_address='rival@rival.com')
        body = self.client.get(STATUS_URL).json()
        self.assertFalse(body['connected'])

    @override_settings(**GOOGLE_CONFIGURED, EMAIL_FAKE_TRANSPORT=False)
    def test_advertises_only_the_providers_this_deployment_has(self):
        """Drives which buttons Settings renders — if this ever came back
        empty with providers configured, the feature would be unreachable and
        no frontend test would notice (they supply the list by hand)."""
        body = self.client.get(STATUS_URL).json()
        self.assertEqual(body['providers_available'], ['google'])

    @override_settings(**MICROSOFT_CONFIGURED, EMAIL_FAKE_TRANSPORT=False)
    def test_advertises_microsoft_when_that_is_the_configured_one(self):
        body = self.client.get(STATUS_URL).json()
        self.assertEqual(body['providers_available'], ['microsoft'])

    @override_settings(**NOTHING_CONFIGURED)
    def test_offers_both_providers_in_fake_mode_so_dev_is_not_a_dead_card(self):
        body = self.client.get(STATUS_URL).json()
        self.assertEqual(body['providers_available'], ['google', 'microsoft'])

    @override_settings(**MISCONFIGURED_PROD)
    def test_advertises_nothing_when_the_deployment_has_no_oauth_app(self):
        body = self.client.get(STATUS_URL).json()
        self.assertEqual(body['providers_available'], [])


# ──────────────────────────────────────────────────────────────────────
# Connect (AC1, AC2, AC7, AC9)
# ──────────────────────────────────────────────────────────────────────

class TestMailboxConnect(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(**GOOGLE_CONFIGURED)
    def test_google_consent_url_asks_only_for_send_and_can_be_refreshed(self):
        response = self.client.get(CONNECT_URL, {'provider': 'google'})
        self.assertEqual(response.status_code, 200)
        url = response.json()['auth_url']

        self.assertTrue(url.startswith('https://accounts.google.com/o/oauth2/v2/auth?'))
        self.assertIn('gmail.send', url)
        # Read scopes would let the platform into the caterer's inbox.
        self.assertNotIn('gmail.readonly', url)
        self.assertNotIn('mail.google.com', url)
        self.assertIn('access_type=offline', url)
        self.assertIn('prompt=consent', url)
        self.assertIn('client_id=google-client-id', url)
        self.assertIn('catering.example.com%2Fapi%2Fintegrations%2Femail%2Fcallback%2F', url)

    @override_settings(**GOOGLE_CONFIGURED)
    def test_connect_sets_the_httponly_nonce_cookie_that_binds_the_callback(self):
        response = self.client.get(CONNECT_URL, {'provider': 'google'})
        cookie = response.cookies[NONCE_COOKIE]

        self.assertTrue(cookie.value)
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Lax')

        query = parse_qs(urlparse(response.json()['auth_url']).query)
        state = signing.loads(query['state'][0], salt=STATE_SALT)
        self.assertEqual(state['nonce_hash'], _hash_nonce(cookie.value))
        self.assertEqual(state['org'], self.org.pk)

    @override_settings(**GOOGLE_CONFIGURED)
    def test_the_state_carries_only_the_hash_never_the_nonce_itself(self):
        """`signing.dumps` signs but does not encrypt — anyone holding the state
        can read its payload. If the raw nonce were in there, the cookie would
        prove nothing and a leaked state would be enough to hijack the flow."""
        response = self.client.get(CONNECT_URL, {'provider': 'google'})
        nonce = response.cookies[NONCE_COOKIE].value
        raw_state = parse_qs(urlparse(response.json()['auth_url']).query)['state'][0]

        # Decoded with no key at all, exactly as an attacker would.
        payload = raw_state.split(':')[0]
        payload += '=' * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload).decode()

        self.assertNotIn(nonce, decoded)
        self.assertNotIn(nonce, raw_state)

    @override_settings(**MISCONFIGURED_PROD)
    def test_connect_refuses_when_the_deployment_has_no_oauth_app(self):
        """A production box missing its client id must say so, not hand back a
        link that mints a mailbox which can never send."""
        response = self.client.get(CONNECT_URL, {'provider': 'google'})

        self.assertEqual(response.status_code, 503)
        self.assertFalse(ConnectedMailbox.objects.exists())

    @override_settings(**GOOGLE_CONFIGURED)
    def test_connect_refuses_a_provider_this_deployment_does_not_have(self):
        """Google configured, Microsoft not — the API must agree with the
        buttons the status endpoint advertises."""
        with override_settings(EMAIL_FAKE_TRANSPORT=False):
            response = self.client.get(CONNECT_URL, {'provider': 'microsoft'})
        self.assertEqual(response.status_code, 503)

    @override_settings(**MICROSOFT_CONFIGURED)
    def test_microsoft_consent_url_asks_for_mail_send_and_offline_access(self):
        url = self.client.get(CONNECT_URL, {'provider': 'microsoft'}).json()['auth_url']

        self.assertTrue(url.startswith('https://login.microsoftonline.com/'))
        self.assertIn('Mail.Send', url)
        self.assertIn('offline_access', url)
        self.assertNotIn('Mail.Read', url)
        self.assertNotIn('Mail.ReadWrite', url)

    def test_rejects_a_provider_we_do_not_support(self):
        for provider in ('', 'yahoo', 'imap'):
            response = self.client.get(CONNECT_URL, {'provider': provider})
            self.assertEqual(response.status_code, 400, provider)

    @override_settings(**NOTHING_CONFIGURED)
    def test_without_an_oauth_app_it_short_circuits_to_our_own_callback(self):
        """AC9 — the flow is walkable locally with no Google/Microsoft app."""
        url = self.client.get(CONNECT_URL, {'provider': 'google'}).json()['auth_url']
        self.assertIn(mailbox_oauth.CALLBACK_PATH, url)
        self.assertNotIn('accounts.google.com', url)

    @override_settings(**GOOGLE_CONFIGURED)
    def test_managers_salespeople_and_chefs_cannot_connect_a_mailbox(self):
        """AC7 — the API rejects them, not just the UI."""
        for role in ('manager', 'salesperson', 'chef'):
            user = User.objects.create(email=f'{role}-mbx@test.com', role=role,
                                       organisation=self.org, is_active=True)
            client = APIClient()
            client.force_authenticate(user)
            response = client.get(CONNECT_URL, {'provider': 'google'})
            self.assertIn(response.status_code, (401, 403), role)

    @override_settings(**GOOGLE_CONFIGURED)
    def test_an_admin_may_connect(self):
        admin = User.objects.create(email='admin-mbx@test.com', role='admin',
                                    organisation=self.org, is_active=True)
        client = APIClient()
        client.force_authenticate(admin)
        self.assertEqual(client.get(CONNECT_URL, {'provider': 'google'}).status_code, 200)


# ──────────────────────────────────────────────────────────────────────
# Callback (AC1, AC2)
# ──────────────────────────────────────────────────────────────────────

class TestMailboxCallback(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()

    def _state(self, provider='google', nonce='nonce-value', org=None, user=None,
               nonce_hash=_UNSET):
        payload = {
            'org': (org or self.org).pk,
            'user': (user or self.user).pk,
            'provider': provider,
            'dev_email': 'dev@example.test',
        }
        # `nonce_hash=None` builds a state with no binding at all, to prove the
        # comparison fails closed rather than matching an absent cookie.
        resolved = _hash_nonce(nonce) if nonce_hash is _UNSET else nonce_hash
        if resolved is not None:
            payload['nonce_hash'] = resolved
        return signing.dumps(payload, salt=STATE_SALT)

    def _call(self, state, nonce='nonce-value', code='auth-code', **extra):
        if nonce is not None:
            self.client.cookies[NONCE_COOKIE] = nonce
        params = {'state': state, **extra}
        if code is not None:
            params['code'] = code
        return self.client.get(CALLBACK_URL, params)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_google_callback_stores_an_encrypted_mailbox_and_returns_to_settings(self, post):
        post.return_value = _response(200, {
            'access_token': 'ya29-access', 'refresh_token': '1//refresh',
            'expires_in': 3599, 'id_token': _id_token('owner@acme.com'),
        })

        response = self._call(self._state('google'))

        self.assertEqual(response.status_code, 302)
        self.assertIn('/settings?', response['Location'])
        self.assertIn('email=connected', response['Location'])

        mailbox = ConnectedMailbox.objects.get(organisation=self.org)
        self.assertEqual(mailbox.provider, 'google')
        self.assertEqual(mailbox.email_address, 'owner@acme.com')
        self.assertEqual(mailbox.status, ConnectedMailbox.CONNECTED)
        self.assertEqual(mailbox.refresh_token, '1//refresh')
        self.assertEqual(mailbox.access_token, 'ya29-access')
        self.assertNotIn('1//refresh', mailbox.refresh_token_encrypted)
        self.assertEqual(mailbox.connected_by, self.user)
        self.assertTrue(mailbox.access_token_valid)

    @override_settings(**MICROSOFT_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.get')
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_microsoft_callback_reads_the_address_from_graph_when_there_is_no_id_token(
        self, post, get,
    ):
        post.return_value = _response(200, {
            'access_token': 'ms-access', 'refresh_token': 'ms-refresh', 'expires_in': 3600,
        })
        get.return_value = _response(200, {'mail': 'owner@acme.onmicrosoft.com'})

        response = self._call(self._state('microsoft'))

        self.assertEqual(response.status_code, 302)
        mailbox = ConnectedMailbox.objects.get(organisation=self.org)
        self.assertEqual(mailbox.provider, 'microsoft')
        self.assertEqual(mailbox.email_address, 'owner@acme.onmicrosoft.com')
        self.assertEqual(mailbox.refresh_token, 'ms-refresh')

    @override_settings(**MICROSOFT_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.get')
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_microsoft_falls_back_to_the_user_principal_name(self, post, get):
        post.return_value = _response(200, {
            'access_token': 'a', 'refresh_token': 'r', 'expires_in': 3600,
        })
        get.return_value = _response(200, {'userPrincipalName': 'owner@acme.com'})

        self._call(self._state('microsoft'))
        self.assertEqual(
            ConnectedMailbox.objects.get(organisation=self.org).email_address,
            'owner@acme.com',
        )

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_tampered_state_is_refused(self, post):
        response = self._call(self._state('google') + 'tampered')

        self.assertIn('email_error=invalid_state', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())
        post.assert_not_called()

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_state_from_another_browser_is_refused(self, post):
        """Without the nonce binding, an admin of org A could hand this link to
        an admin of org B and capture B's mailbox onto A."""
        response = self._call(self._state('google', nonce='attacker-nonce'),
                              nonce='victim-nonce')

        self.assertIn('email_error=invalid_state', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())
        post.assert_not_called()

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_state_carrying_no_binding_is_refused_rather_than_matching_nothing(self, post):
        """Fail closed: an absent hash and an absent cookie must not compare
        equal, or the one control stopping cross-org capture evaporates."""
        self.client.cookies.pop(NONCE_COOKIE, None)
        response = self.client.get(CALLBACK_URL, {
            'state': self._state('google', nonce_hash=None), 'code': 'auth-code',
        })

        self.assertIn('email_error=invalid_state', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())
        post.assert_not_called()

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_callback_with_no_nonce_cookie_at_all_is_refused(self, post):
        self.client.cookies.pop(NONCE_COOKIE, None)
        response = self.client.get(CALLBACK_URL, {
            'state': self._state('google'), 'code': 'auth-code',
        })

        self.assertIn('email_error=invalid_state', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())
        post.assert_not_called()

    @override_settings(**GOOGLE_CONFIGURED)
    def test_an_expired_state_is_refused(self):
        stale = timezone.now() - timedelta(hours=2)
        with patch('django.core.signing.time.time', return_value=stale.timestamp()):
            state = self._state('google')
        response = self._call(state)
        self.assertIn('email_error=expired', response['Location'])

    @override_settings(**GOOGLE_CONFIGURED)
    def test_the_caterer_pressing_cancel_returns_quietly(self):
        response = self._call(self._state('google'), code=None, error='access_denied')

        self.assertIn('email_error=access_denied', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_refused_code_exchange_does_not_half_create_a_mailbox(self, post):
        post.return_value = _response(400, {'error': 'invalid_grant'})

        response = self._call(self._state('google'))

        self.assertIn('email_error=exchange_failed', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_an_exchange_without_a_refresh_token_is_rejected_rather_than_stored(self, post):
        """A mailbox we can't renew would die silently in an hour."""
        post.return_value = _response(200, {
            'access_token': 'ya29-access', 'expires_in': 3599,
            'id_token': _id_token('owner@acme.com'),
        })

        response = self._call(self._state('google'))

        self.assertIn('email_error=exchange_failed', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.get')
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_an_exchange_that_yields_no_address_is_rejected(self, post, get):
        post.return_value = _response(200, {
            'access_token': 'a', 'refresh_token': 'r', 'expires_in': 3600,
        })
        get.return_value = _response(200, {})

        response = self._call(self._state('google'))

        self.assertIn('email_error=no_address', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.get')
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_an_address_too_long_for_the_column_is_refused_not_written(self, post, get):
        """Postgres would raise DataError mid-callback; SQLite would store a
        value we could never send from."""
        post.return_value = _response(200, {
            'access_token': 'a', 'refresh_token': 'r', 'expires_in': 3600,
        })
        get.return_value = _response(200, {'email': 'x' * 250 + '@example.com'})

        response = self._call(self._state('google'))

        self.assertIn('email_error=no_address', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())

    @override_settings(**MICROSOFT_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.get')
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_principal_name_that_is_not_an_address_is_refused(self, post, get):
        post.return_value = _response(200, {
            'access_token': 'a', 'refresh_token': 'r', 'expires_in': 3600,
        })
        get.return_value = _response(200, {'userPrincipalName': 'not-an-email'})

        response = self._call(self._state('microsoft'))

        self.assertIn('email_error=no_address', response['Location'])
        self.assertFalse(ConnectedMailbox.objects.exists())

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_failure_storing_tokens_leaves_no_half_connected_mailbox(self, post):
        """The row and its credentials commit together — otherwise Settings
        shows a green "Connected" badge over a mailbox that cannot send."""
        post.return_value = _response(200, {
            'access_token': 'a', 'refresh_token': 'r', 'expires_in': 3600,
            'id_token': _id_token('owner@acme.com'),
        })

        # DRF's exception handler turns the failure into a 500 rather than
        # letting it escape, so the assertion that matters is what's left
        # behind: without the transaction, update_or_create's row survives.
        with patch('bookings.views.mailbox.store_tokens',
                   side_effect=RuntimeError('db went away')):
            self._call(self._state('google'))

        self.assertFalse(ConnectedMailbox.objects.exists())

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_reconnecting_replaces_the_previous_connection_and_clears_the_error(self, post):
        _make_mailbox(self.org, provider=ConnectedMailbox.MICROSOFT,
                      email_address='old@acme.com',
                      status=ConnectedMailbox.NEEDS_RECONNECT, last_error='invalid_grant')
        post.return_value = _response(200, {
            'access_token': 'new-access', 'refresh_token': 'new-refresh',
            'expires_in': 3600, 'id_token': _id_token('new@acme.com'),
        })

        self._call(self._state('google'))

        self.assertEqual(ConnectedMailbox.objects.filter(organisation=self.org).count(), 1)
        mailbox = ConnectedMailbox.objects.get(organisation=self.org)
        self.assertEqual(mailbox.provider, 'google')
        self.assertEqual(mailbox.email_address, 'new@acme.com')
        self.assertEqual(mailbox.status, ConnectedMailbox.CONNECTED)
        self.assertEqual(mailbox.last_error, '')
        self.assertEqual(mailbox.refresh_token, 'new-refresh')

    @override_settings(**NOTHING_CONFIGURED)
    def test_fake_mode_completes_the_whole_dance_with_no_provider(self):
        """AC9 — connect works end to end on a laptop with no OAuth app."""
        response = self._call(self._state('google'))

        self.assertIn('email=connected', response['Location'])
        mailbox = ConnectedMailbox.objects.get(organisation=self.org)
        self.assertEqual(mailbox.email_address, 'dev@example.test')
        self.assertEqual(mailbox.status, ConnectedMailbox.CONNECTED)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_the_mailbox_lands_on_the_org_named_in_the_state(self, post):
        """AC8 — the callback is unauthenticated, so the signed state is the
        only thing that decides whose mailbox this is."""
        other = _other_org()
        other_user = User.objects.create(email='other-owner@test.com', role='owner',
                                         organisation=other, is_active=True)
        post.return_value = _response(200, {
            'access_token': 'a', 'refresh_token': 'r', 'expires_in': 3600,
            'id_token': _id_token('owner@rival.com'),
        })

        self._call(self._state('google', org=other, user=other_user))

        self.assertTrue(ConnectedMailbox.objects.filter(organisation=other).exists())
        self.assertFalse(ConnectedMailbox.objects.filter(organisation=self.org).exists())


# ──────────────────────────────────────────────────────────────────────
# Disconnect (AC6, AC7, AC8)
# ──────────────────────────────────────────────────────────────────────

class TestMailboxDisconnect(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(**NOTHING_CONFIGURED)
    def test_disconnect_deletes_the_row_so_no_token_survives(self):
        _make_mailbox(self.org)
        response = self.client.post(DISCONNECT_URL)

        self.assertEqual(response.status_code, 204)
        self.assertFalse(ConnectedMailbox.objects.filter(organisation=self.org).exists())

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_disconnect_also_asks_google_to_drop_the_grant(self, post):
        _make_mailbox(self.org)
        self.client.post(DISCONNECT_URL)

        post.assert_called_once()
        self.assertIn('revoke', post.call_args[0][0])
        self.assertEqual(post.call_args[1]['data']['token'], 'refresh-token-abc')

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post',
           side_effect=RuntimeError('google is down'))
    def test_a_failed_revoke_still_disconnects_locally(self, post):
        _make_mailbox(self.org)
        self.assertEqual(self.client.post(DISCONNECT_URL).status_code, 204)
        self.assertFalse(ConnectedMailbox.objects.exists())

    def test_disconnecting_nothing_is_a_404_not_a_crash(self):
        self.assertEqual(self.client.post(DISCONNECT_URL).status_code, 404)

    @override_settings(**NOTHING_CONFIGURED)
    def test_managers_and_salespeople_cannot_disconnect(self):
        """AC7."""
        _make_mailbox(self.org)
        for role in ('manager', 'salesperson', 'chef'):
            user = User.objects.create(email=f'{role}-dis@test.com', role=role,
                                       organisation=self.org, is_active=True)
            client = APIClient()
            client.force_authenticate(user)
            self.assertIn(client.post(DISCONNECT_URL).status_code, (401, 403), role)
        self.assertTrue(ConnectedMailbox.objects.exists())

    @override_settings(**NOTHING_CONFIGURED)
    def test_cannot_disconnect_another_orgs_mailbox(self):
        """AC8."""
        rival = _make_mailbox(_other_org())

        self.assertEqual(self.client.post(DISCONNECT_URL).status_code, 404)
        self.assertTrue(ConnectedMailbox.objects.filter(pk=rival.pk).exists())


# ──────────────────────────────────────────────────────────────────────
# Transport (AC3, AC4, AC5, AC8, AC9)
# ──────────────────────────────────────────────────────────────────────

PDF = (b'%PDF-1.4 fake quote bytes', 'application/pdf')


class TestMailboxSend(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        email_service.outbox.clear()

    def _send(self, **kwargs):
        params = dict(
            to='client@example.com', subject='Your quote',
            body='Hi — the quote is attached.',
        )
        params.update(kwargs)
        return email_service.send_via_mailbox(self.org, **params)

    # ── Google ──

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_google_send_posts_a_raw_mime_message_with_the_attachment_intact(self, post):
        """AC3."""
        _make_mailbox(self.org, email_address='owner@acme.com')
        post.return_value = _response(200, {'id': 'gmail-message-id-1'})

        message_id = self._send(attachments=[('quote.pdf', *PDF)])

        self.assertEqual(message_id, 'gmail-message-id-1')
        url, kwargs = post.call_args[0][0], post.call_args[1]
        self.assertEqual(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer access-token-xyz')

        raw = base64.urlsafe_b64decode(kwargs['json']['raw'])
        message = email_lib.message_from_bytes(raw)
        self.assertEqual(message['From'], 'owner@acme.com')
        self.assertEqual(message['To'], 'client@example.com')
        self.assertEqual(message['Subject'], 'Your quote')

        parts = {p.get_filename(): p for p in message.walk() if p.get_filename()}
        self.assertIn('quote.pdf', parts)
        self.assertEqual(parts['quote.pdf'].get_payload(decode=True), PDF[0])
        self.assertEqual(parts['quote.pdf'].get_content_type(), 'application/pdf')

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_send_with_no_attachment_still_carries_the_body(self, post):
        _make_mailbox(self.org)
        post.return_value = _response(200, {'id': 'gmail-2'})

        self._send()

        raw = base64.urlsafe_b64decode(post.call_args[1]['json']['raw'])
        self.assertIn(b'Hi', raw)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_several_recipients_all_make_it_onto_the_message(self, post):
        _make_mailbox(self.org)
        post.return_value = _response(200, {'id': 'gmail-3'})

        self._send(to=['a@example.com', 'b@example.com'])

        raw = base64.urlsafe_b64decode(post.call_args[1]['json']['raw'])
        message = email_lib.message_from_bytes(raw)
        self.assertIn('a@example.com', message['To'])
        self.assertIn('b@example.com', message['To'])

    # ── Microsoft ──

    @override_settings(**MICROSOFT_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_microsoft_send_posts_graph_json_with_a_base64_attachment(self, post):
        """AC3, mirrored for the other provider."""
        _make_mailbox(self.org, provider=ConnectedMailbox.MICROSOFT)
        post.return_value = _response(202, headers={'request-id': 'graph-req-1'})

        message_id = self._send(attachments=[('quote.pdf', *PDF)])

        self.assertEqual(message_id, 'graph-req-1')
        url, kwargs = post.call_args[0][0], post.call_args[1]
        self.assertEqual(url, 'https://graph.microsoft.com/v1.0/me/sendMail')
        self.assertTrue(kwargs['json']['saveToSentItems'])

        message = kwargs['json']['message']
        self.assertEqual(message['subject'], 'Your quote')
        self.assertEqual(
            message['toRecipients'][0]['emailAddress']['address'], 'client@example.com',
        )
        attachment = message['attachments'][0]
        self.assertEqual(attachment['name'], 'quote.pdf')
        self.assertEqual(attachment['contentType'], 'application/pdf')
        self.assertEqual(base64.b64decode(attachment['contentBytes']), PDF[0])

    # ── Token refresh (AC4) ──

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_an_expired_access_token_is_renewed_silently_mid_send(self, post):
        """AC4."""
        mailbox = _make_mailbox(
            self.org, access_token_expires_at=timezone.now() - timedelta(minutes=5),
        )
        post.side_effect = [
            _response(200, {'access_token': 'renewed-access', 'expires_in': 3600}),
            _response(200, {'id': 'gmail-after-refresh'}),
        ]

        self.assertEqual(self._send(), 'gmail-after-refresh')

        refresh_call, send_call = post.call_args_list
        self.assertEqual(refresh_call[0][0], 'https://oauth2.googleapis.com/token')
        self.assertEqual(refresh_call[1]['data']['grant_type'], 'refresh_token')
        self.assertEqual(refresh_call[1]['data']['refresh_token'], 'refresh-token-abc')
        self.assertEqual(send_call[1]['headers']['Authorization'], 'Bearer renewed-access')

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.access_token, 'renewed-access')
        self.assertTrue(mailbox.access_token_valid)
        self.assertEqual(mailbox.status, ConnectedMailbox.CONNECTED)

    @override_settings(**MICROSOFT_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_microsofts_rotated_refresh_token_is_stored(self, post):
        """Graph hands back a new refresh token each time; keeping the old one
        would break the *next* send, not this one."""
        mailbox = _make_mailbox(
            self.org, provider=ConnectedMailbox.MICROSOFT,
            access_token_expires_at=timezone.now() - timedelta(minutes=5),
        )
        post.side_effect = [
            _response(200, {'access_token': 'a2', 'expires_in': 3600,
                            'refresh_token': 'rotated-refresh'}),
            _response(202, headers={'request-id': 'graph-2'}),
        ]

        self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.refresh_token, 'rotated-refresh')

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_still_valid_token_is_reused_without_a_refresh_round_trip(self, post):
        _make_mailbox(self.org)
        post.return_value = _response(200, {'id': 'gmail-4'})

        self._send()

        self.assertEqual(post.call_count, 1)

    # ── Revoked / broken connection (AC5) ──

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_revoked_grant_flips_to_needs_reconnect_and_never_retries(self, post):
        """AC5."""
        mailbox = _make_mailbox(
            self.org, access_token_expires_at=timezone.now() - timedelta(minutes=5),
        )
        post.return_value = _response(400, {'error': 'invalid_grant'})

        with self.assertRaises(email_service.MailboxNeedsReconnect):
            self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.status, ConnectedMailbox.NEEDS_RECONNECT)
        self.assertIn('invalid_grant', mailbox.last_error)
        # One refresh attempt, and no send attempt behind it.
        self.assertEqual(post.call_count, 1)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_401_from_the_send_itself_also_flips_to_needs_reconnect(self, post):
        """AC5 — the grant can die between the refresh and the send."""
        mailbox = _make_mailbox(self.org)
        post.return_value = _response(401, {'error': {'message': 'Invalid Credentials'}})

        with self.assertRaises(email_service.MailboxNeedsReconnect):
            self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.status, ConnectedMailbox.NEEDS_RECONNECT)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_withdrawn_scope_403_also_needs_a_reconnect(self, post):
        mailbox = _make_mailbox(self.org)
        post.return_value = _response(403, {'error': {'message': 'insufficient scope'}})

        with self.assertRaises(email_service.MailboxNeedsReconnect):
            self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.status, ConnectedMailbox.NEEDS_RECONNECT)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_gmail_rate_limit_403_is_transient_and_keeps_the_connection(self, post):
        """Gmail answers 403 for usage limits as well as for lost permission.
        Treating a burst of quotes as a revoked grant would make the caterer
        redo the whole OAuth consent over a throttle."""
        mailbox = _make_mailbox(self.org)
        post.return_value = _response(403, {'error': {
            'code': 403,
            'message': 'User-rate limit exceeded. Retry after 2026-08-08T10:00:00Z',
            'errors': [{'reason': 'rateLimitExceeded', 'domain': 'usageLimits'}],
        }})

        with self.assertRaises(email_service.MailboxSendFailed):
            self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.status, ConnectedMailbox.CONNECTED)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_daily_quota_403_also_keeps_the_connection(self, post):
        mailbox = _make_mailbox(self.org)
        post.return_value = _response(403, {'error': {
            'message': 'Daily Limit Exceeded',
            'errors': [{'reason': 'dailyLimitExceeded', 'domain': 'usageLimits'}],
        }})

        with self.assertRaises(email_service.MailboxSendFailed):
            self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.status, ConnectedMailbox.CONNECTED)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_unreadable_stored_credentials_ask_for_a_reconnect_not_a_500(self, post):
        """If the encryption key changes without the old one kept as a
        fallback, every token becomes unreadable. REL-445 must get a typed
        error it can ledger, not a raw InvalidToken."""
        mailbox = _make_mailbox(self.org)
        ConnectedMailbox.objects.filter(pk=mailbox.pk).update(
            access_token_encrypted='gAAAAA-not-decryptable',
            refresh_token_encrypted='gAAAAA-not-decryptable',
        )

        with self.assertRaises(email_service.MailboxNeedsReconnect):
            self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.status, ConnectedMailbox.NEEDS_RECONNECT)
        post.assert_not_called()

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_mailbox_with_no_refresh_token_asks_for_a_reconnect(self, post):
        mailbox = _make_mailbox(
            self.org, access_token_expires_at=timezone.now() - timedelta(minutes=5),
        )
        ConnectedMailbox.objects.filter(pk=mailbox.pk).update(refresh_token_encrypted='')

        with self.assertRaises(email_service.MailboxNeedsReconnect):
            self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.status, ConnectedMailbox.NEEDS_RECONNECT)
        post.assert_not_called()

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_provider_outage_does_not_burn_the_connection(self, post):
        """A 500 is Google's problem, not a revoked grant — flipping the mailbox
        would make every caterer reconnect over a blip."""
        mailbox = _make_mailbox(
            self.org, access_token_expires_at=timezone.now() - timedelta(minutes=5),
        )
        post.return_value = _response(500, {'error': 'backend_error'})

        with self.assertRaises(email_service.MailboxSendFailed):
            self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.status, ConnectedMailbox.CONNECTED)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post',
           side_effect=RuntimeError('connection reset'))
    def test_a_network_error_is_a_send_failure_not_a_reconnect(self, post):
        mailbox = _make_mailbox(self.org)

        with self.assertRaises(email_service.MailboxSendFailed):
            self._send()

        mailbox.refresh_from_db()
        self.assertEqual(mailbox.status, ConnectedMailbox.CONNECTED)

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_provider_error_never_echoes_the_client_secret(self, post):
        _make_mailbox(
            self.org, access_token_expires_at=timezone.now() - timedelta(minutes=5),
        )
        post.return_value = _response(400, {'error': 'temporarily_unavailable'})

        with self.assertRaises(email_service.MailboxError) as caught:
            self._send()

        self.assertNotIn('google-client-secret', str(caught.exception))

    # ── Channel availability (AC5 contract for REL-445) ──

    def test_sending_without_a_connected_mailbox_raises_the_typed_error(self):
        with self.assertRaises(email_service.MailboxNotConnected):
            self._send()

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_mailbox_already_needing_reconnect_refuses_before_any_network_call(self, post):
        _make_mailbox(self.org, status=ConnectedMailbox.NEEDS_RECONNECT)

        with self.assertRaises(email_service.MailboxNeedsReconnect):
            self._send()

        post.assert_not_called()

    def test_mailbox_is_usable_tracks_the_connection_state(self):
        self.assertFalse(email_service.mailbox_is_usable(self.org))

        mailbox = _make_mailbox(self.org)
        self.assertTrue(email_service.mailbox_is_usable(self.org))

        mailbox.mark_needs_reconnect('revoked')
        self.assertFalse(email_service.mailbox_is_usable(self.org))

    @override_settings(**GOOGLE_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_one_orgs_send_never_uses_another_orgs_mailbox(self, post):
        """AC8."""
        _make_mailbox(_other_org(), email_address='rival@rival.com')

        with self.assertRaises(email_service.MailboxNotConnected):
            self._send()

        post.assert_not_called()

    # ── Fake transport (AC9) ──

    @override_settings(**NOTHING_CONFIGURED)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_without_an_oauth_app_the_send_is_captured_instead_of_posted(self, post):
        """AC9."""
        _make_mailbox(self.org, email_address='owner@acme.com')

        message_id = self._send(attachments=[('quote.pdf', *PDF)])

        post.assert_not_called()
        self.assertTrue(message_id.startswith('fake-'))
        self.assertEqual(len(email_service.outbox), 1)

        captured = email_service.outbox[0]
        self.assertEqual(captured['to'], ['client@example.com'])
        self.assertEqual(captured['from'], 'owner@acme.com')
        self.assertEqual(captured['subject'], 'Your quote')
        self.assertEqual(captured['attachments'][0][0], 'quote.pdf')
        self.assertEqual(captured['organisation_id'], self.org.pk)

    @override_settings(**NOTHING_CONFIGURED)
    def test_the_fake_transport_still_honours_the_not_connected_contract(self):
        with self.assertRaises(email_service.MailboxNotConnected):
            self._send()
        self.assertEqual(email_service.outbox, [])

    @override_settings(**MISCONFIGURED_PROD)
    @patch('bookings.services.mailbox_oauth.requests.post')
    def test_a_production_box_missing_its_oauth_app_fails_loudly(self, post):
        """The regression this pins: with fake mode keyed only off "is the
        client id set", a credential that never reached production turned every
        quote and contract into a silent no-op that still reported success."""
        _make_mailbox(self.org)

        with self.assertRaises(email_service.MailboxSendFailed):
            self._send()

        post.assert_not_called()
        self.assertEqual(email_service.outbox, [])
