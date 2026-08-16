"""The org's connected Meta Pages: OAuth connect, picker, disconnect (REL-506).

No real Meta app is ever contacted — every Graph HTTP call is patched at the
`requests` boundary inside `bookings.services.meta`. The whole surface is gated
by META_LEADS_ENABLED, so most tests turn it on; the flag-off case is asserted
explicitly.
"""
import json
from unittest.mock import MagicMock, patch

from django.core import signing
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from bookings.models import ConnectedMetaPage, MetaAccountConnection
from bookings.serializers.meta import ConnectedMetaPageSerializer
from bookings.serializers.settings import OrgSettingsSerializer
from bookings.services import meta
from bookings.views.meta import NONCE_COOKIE, STATE_SALT, _hash_nonce
from payments.models import Subscription
from tests.base import get_test_user
from users.models import Organisation, User

STATUS_URL = '/api/integrations/meta/'
CONNECT_URL = '/api/integrations/meta/connect/'
CALLBACK_URL = '/api/integrations/meta/callback/'
PAGES_URL = '/api/integrations/meta/pages/'
DISCONNECT_URL = '/api/integrations/meta/disconnect/'

# The three deployment shapes. ENABLED + a real app; ENABLED + no app (the
# local-dev fake mode); and (by omission) the flag off, which is the default.
APP_CONFIGURED = dict(
    META_LEADS_ENABLED=True, META_APP_ID='app-id', META_APP_SECRET='app-secret',
    OAUTH_REDIRECT_BASE='https://catering.example.com',
)
FAKE_MODE = dict(META_LEADS_ENABLED=True, META_APP_ID='', META_APP_SECRET='')


def _response(status_code=200, json_data=None):
    response = MagicMock()
    response.status_code = status_code
    if json_data is None:
        response.json.side_effect = ValueError('no json')
    else:
        response.json.return_value = json_data
    return response


def _pages_payload():
    """A believable /me/accounts response: two Pages, one with a linked IG."""
    return {'data': [
        {'id': 'PAGE1', 'name': 'Acme Catering', 'access_token': 'page-token-1',
         'instagram_business_account': {'id': 'IG1', 'username': 'acme_ig'}},
        {'id': 'PAGE2', 'name': 'Acme Events', 'access_token': 'page-token-2'},
    ]}


def _other_org():
    """A second org standing in for another customer, with access comped."""
    org = Organisation.objects.create(name='Rival Catering', slug='rival', country='US')
    Subscription.objects.filter(organisation=org).update(comped=True)
    return org


def _make_connection(org, user=None, token='long-user-token'):
    connection = MetaAccountConnection(organisation=org, connected_by=user)
    connection.user_access_token = token
    connection.save()
    return connection


def _make_page(org, connection=None, page_id='PAGE1', page_name='Acme Catering',
               token='page-token-1', **kwargs):
    connection = connection or _make_connection(org)
    page = ConnectedMetaPage(
        organisation=org, connection=connection, page_id=page_id, page_name=page_name,
        instagram_account_id=kwargs.pop('instagram_account_id', 'IG1'),
        instagram_username=kwargs.pop('instagram_username', 'acme_ig'),
        **kwargs,
    )
    page.page_access_token = token
    page.save()
    return page


_UNSET = object()


# ──────────────────────────────────────────────────────────────────────
# Model + encryption at rest (AC4)
# ──────────────────────────────────────────────────────────────────────

class TestMetaCredentialStorage(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation

    def test_user_token_round_trips_but_is_never_stored_in_plaintext(self):
        connection = _make_connection(self.org, token='super-secret-user-token')
        connection.refresh_from_db()
        self.assertEqual(connection.user_access_token, 'super-secret-user-token')
        self.assertNotIn('super-secret-user-token', connection.user_access_token_encrypted)

    def test_page_token_round_trips_but_is_never_stored_in_plaintext(self):
        page = _make_page(self.org, token='super-secret-page-token')
        page.refresh_from_db()
        self.assertEqual(page.page_access_token, 'super-secret-page-token')
        self.assertNotIn('super-secret-page-token', page.page_access_token_encrypted)

    def test_repr_never_leaks_the_tokens(self):
        connection = _make_connection(self.org, token='leaky-user')
        page = _make_page(self.org, connection=connection, token='leaky-page')
        self.assertNotIn('leaky-user', repr(connection))
        self.assertNotIn(connection.user_access_token_encrypted, repr(connection))
        self.assertNotIn('leaky-page', repr(page))
        self.assertNotIn(page.page_access_token_encrypted, repr(page))

    def test_blank_token_stays_blank_rather_than_encrypting_empty(self):
        page = _make_page(self.org)
        page.page_access_token = ''
        self.assertEqual(page.page_access_token_encrypted, '')
        self.assertEqual(page.page_access_token, '')

    def test_serializer_exposes_no_token_field_at_all(self):
        page = _make_page(self.org, token='never-serialize-me')
        data = ConnectedMetaPageSerializer(page).data
        self.assertEqual(data['page_name'], 'Acme Catering')
        self.assertEqual(data['instagram_username'], 'acme_ig')
        for field in data:
            self.assertNotIn('token', field, f'{field} must not be serialized')
        self.assertNotIn('never-serialize-me', json.dumps(data))

    def test_the_same_page_cannot_be_connected_twice_for_one_org(self):
        connection = _make_connection(self.org)
        _make_page(self.org, connection=connection, page_id='PAGE1')
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            ConnectedMetaPage.objects.create(
                organisation=self.org, connection=connection,
                page_id='PAGE1', page_name='dup',
            )


# ──────────────────────────────────────────────────────────────────────
# Launch flag (AC1)
# ──────────────────────────────────────────────────────────────────────

class TestMetaLaunchFlag(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_serializer_reflects_the_flag_read_only(self):
        with override_settings(META_LEADS_ENABLED=True):
            self.assertTrue(OrgSettingsSerializer().get_meta_leads_enabled(None))
        with override_settings(META_LEADS_ENABLED=False):
            self.assertFalse(OrgSettingsSerializer().get_meta_leads_enabled(None))

    @override_settings(META_LEADS_ENABLED=False)
    def test_every_endpoint_is_404_when_the_flag_is_off(self):
        """AC1 — the connect endpoints are hidden entirely with the flag off."""
        self.assertEqual(self.client.get(STATUS_URL).status_code, 404)
        self.assertEqual(self.client.get(CONNECT_URL).status_code, 404)
        self.assertEqual(self.client.get(CALLBACK_URL).status_code, 404)
        self.assertEqual(self.client.get(PAGES_URL).status_code, 404)
        self.assertEqual(self.client.post(DISCONNECT_URL, {'page_id': 'x'}).status_code, 404)

    @override_settings(**FAKE_MODE)
    def test_status_is_reachable_when_the_flag_is_on(self):
        body = self.client.get(STATUS_URL).json()
        self.assertFalse(body['authorized'])
        self.assertEqual(body['pages'], [])


# ──────────────────────────────────────────────────────────────────────
# Status (AC2, AC4, AC6)
# ──────────────────────────────────────────────────────────────────────

class TestMetaStatus(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(**FAKE_MODE)
    def test_reports_unconnected_when_nothing_is_connected(self):
        """AC2 — no Page connected yet."""
        body = self.client.get(STATUS_URL).json()
        self.assertFalse(body['authorized'])
        self.assertEqual(body['pages'], [])

    @override_settings(**FAKE_MODE)
    def test_lists_connected_pages_without_tokens(self):
        """AC4."""
        _make_page(self.org)
        body = self.client.get(STATUS_URL).json()
        self.assertTrue(body['authorized'])
        self.assertEqual(len(body['pages']), 1)
        self.assertEqual(body['pages'][0]['page_name'], 'Acme Catering')
        self.assertEqual(body['pages'][0]['instagram_username'], 'acme_ig')
        self.assertNotIn('page-token-1', json.dumps(body))

    @override_settings(**APP_CONFIGURED)
    def test_app_configured_flag_reflects_settings(self):
        self.assertTrue(self.client.get(STATUS_URL).json()['app_configured'])

    @override_settings(**FAKE_MODE)
    def test_app_configured_is_false_without_a_meta_app(self):
        self.assertFalse(self.client.get(STATUS_URL).json()['app_configured'])

    @override_settings(**FAKE_MODE)
    def test_only_shows_this_orgs_pages(self):
        """AC6 — another org's Pages are invisible here."""
        _make_page(_other_org(), page_id='RIVALPAGE', page_name='Rival')
        body = self.client.get(STATUS_URL).json()
        self.assertFalse(body['authorized'])
        self.assertEqual(body['pages'], [])

    @override_settings(**FAKE_MODE)
    def test_managers_and_salespeople_cannot_read_status(self):
        for role in ('manager', 'salesperson', 'chef'):
            user = User.objects.create(email=f'{role}-meta@test.com', role=role,
                                       organisation=self.org, is_active=True)
            client = APIClient()
            client.force_authenticate(user)
            self.assertIn(client.get(STATUS_URL).status_code, (401, 403), role)


# ──────────────────────────────────────────────────────────────────────
# Connect (AC1, AC7)
# ──────────────────────────────────────────────────────────────────────

class TestMetaConnect(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(**APP_CONFIGURED)
    def test_consent_url_targets_facebook_with_the_right_scopes(self):
        url = self.client.get(CONNECT_URL).json()['auth_url']
        self.assertTrue(url.startswith('https://www.facebook.com/'))
        self.assertIn('client_id=app-id', url)
        self.assertIn('leads_retrieval', url)
        self.assertIn('pages_manage_metadata', url)
        self.assertIn('pages_messaging', url)
        # Instagram DMs (instagram_manage_messages) is deferred to REL-508 — it
        # must not be requested until the app supports it (else the OAuth
        # hard-errors for app admins and App Review rejects it).
        self.assertNotIn('instagram_manage_messages', url)
        self.assertIn('catering.example.com%2Fapi%2Fintegrations%2Fmeta%2Fcallback%2F', url)

    @override_settings(**APP_CONFIGURED)
    def test_connect_sets_the_httponly_nonce_cookie_that_binds_the_callback(self):
        response = self.client.get(CONNECT_URL)
        cookie = response.cookies[NONCE_COOKIE]
        self.assertTrue(cookie.value)
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Lax')

        from urllib.parse import parse_qs, urlparse
        state = signing.loads(
            parse_qs(urlparse(response.json()['auth_url']).query)['state'][0],
            salt=STATE_SALT,
        )
        self.assertEqual(state['nonce_hash'], _hash_nonce(cookie.value))
        self.assertEqual(state['org'], self.org.pk)

    @override_settings(**APP_CONFIGURED)
    def test_the_state_carries_only_the_hash_never_the_raw_nonce(self):
        response = self.client.get(CONNECT_URL)
        nonce = response.cookies[NONCE_COOKIE].value
        from urllib.parse import parse_qs, urlparse
        raw_state = parse_qs(urlparse(response.json()['auth_url']).query)['state'][0]
        self.assertNotIn(nonce, raw_state)

    @override_settings(**FAKE_MODE)
    def test_without_a_meta_app_it_short_circuits_to_our_own_callback(self):
        url = self.client.get(CONNECT_URL).json()['auth_url']
        self.assertIn(meta.CALLBACK_PATH, url)
        self.assertNotIn('facebook.com', url)

    @override_settings(**APP_CONFIGURED)
    def test_managers_salespeople_and_chefs_cannot_connect(self):
        """AC7 — the API rejects them, not just the UI."""
        for role in ('manager', 'salesperson', 'chef'):
            user = User.objects.create(email=f'{role}-mc@test.com', role=role,
                                       organisation=self.org, is_active=True)
            client = APIClient()
            client.force_authenticate(user)
            self.assertIn(client.get(CONNECT_URL).status_code, (401, 403), role)


# ──────────────────────────────────────────────────────────────────────
# Callback (AC3, AC6, AC7)
# ──────────────────────────────────────────────────────────────────────

class TestMetaCallback(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()

    def _state(self, nonce='nonce-value', org=None, user=None, nonce_hash=_UNSET):
        payload = {'org': (org or self.org).pk, 'user': (user or self.user).pk}
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

    @override_settings(**FAKE_MODE)
    def test_fake_mode_stores_an_encrypted_connection_and_returns_to_settings(self):
        """AC3 — connect walks end to end with no Meta app; picker comes next."""
        response = self._call(self._state())
        self.assertEqual(response.status_code, 302)
        self.assertIn('/settings?', response['Location'])
        self.assertIn('meta=connected', response['Location'])

        connection = MetaAccountConnection.objects.get(organisation=self.org)
        self.assertEqual(connection.user_access_token, 'fake-user-token')
        self.assertNotIn('fake-user-token', connection.user_access_token_encrypted)
        self.assertEqual(connection.connected_by, self.user)

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.post')
    def test_configured_callback_exchanges_for_a_long_lived_user_token(self, post):
        # Token exchange goes over POST (secret in the body), so both the
        # short- and long-lived exchanges are POSTs.
        post.side_effect = [
            _response(200, {'access_token': 'short-token', 'expires_in': 3600}),
            _response(200, {'access_token': 'long-user-token', 'expires_in': 5184000}),
        ]
        response = self._call(self._state())
        self.assertEqual(response.status_code, 302)
        self.assertIn('meta=connected', response['Location'])

        connection = MetaAccountConnection.objects.get(organisation=self.org)
        self.assertEqual(connection.user_access_token, 'long-user-token')
        self.assertNotIn('long-user-token', connection.user_access_token_encrypted)

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.post')
    def test_a_tampered_state_is_refused(self, post):
        response = self._call(self._state() + 'tampered')
        self.assertIn('meta_error=invalid_state', response['Location'])
        self.assertFalse(MetaAccountConnection.objects.exists())
        post.assert_not_called()

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.post')
    def test_a_state_from_another_browser_is_refused(self, post):
        """AC7 — without the nonce binding, an admin of org A could hand this
        link to org B and capture B's connection onto A."""
        response = self._call(self._state(nonce='attacker-nonce'), nonce='victim-nonce')
        self.assertIn('meta_error=invalid_state', response['Location'])
        self.assertFalse(MetaAccountConnection.objects.exists())
        post.assert_not_called()

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.post')
    def test_a_state_with_no_binding_is_refused_rather_than_matching_nothing(self, post):
        self.client.cookies.pop(NONCE_COOKIE, None)
        response = self.client.get(CALLBACK_URL, {
            'state': self._state(nonce_hash=None), 'code': 'auth-code',
        })
        self.assertIn('meta_error=invalid_state', response['Location'])
        self.assertFalse(MetaAccountConnection.objects.exists())
        post.assert_not_called()

    @override_settings(**APP_CONFIGURED)
    def test_an_expired_state_is_refused(self):
        from datetime import timedelta
        from django.utils import timezone
        stale = timezone.now() - timedelta(hours=2)
        with patch('django.core.signing.time.time', return_value=stale.timestamp()):
            state = self._state()
        self.assertIn('meta_error=expired', self._call(state)['Location'])

    @override_settings(**APP_CONFIGURED)
    def test_the_admin_pressing_cancel_returns_quietly(self):
        response = self._call(self._state(), code=None, error='access_denied')
        self.assertIn('meta_error=access_denied', response['Location'])
        self.assertFalse(MetaAccountConnection.objects.exists())

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.post')
    def test_a_refused_exchange_does_not_half_create_a_connection(self, post):
        post.return_value = _response(400, {'error': {'message': 'bad code'}})
        response = self._call(self._state())
        self.assertIn('meta_error=exchange_failed', response['Location'])
        self.assertFalse(MetaAccountConnection.objects.exists())

    @override_settings(**FAKE_MODE)
    def test_the_connection_lands_on_the_org_named_in_the_state(self, ):
        """AC6 — the callback is unauthenticated, so the signed state alone
        decides whose connection this is."""
        other = _other_org()
        other_user = User.objects.create(email='other-owner@test.com', role='owner',
                                         organisation=other, is_active=True)
        self._call(self._state(org=other, user=other_user))
        self.assertTrue(MetaAccountConnection.objects.filter(organisation=other).exists())
        self.assertFalse(MetaAccountConnection.objects.filter(organisation=self.org).exists())

    @override_settings(**FAKE_MODE)
    def test_a_lapsed_org_is_sent_to_billing_not_connected(self):
        sub = Subscription.objects.get(organisation=self.org)
        sub.comped = False
        sub.status = 'none'
        from datetime import timedelta
        from django.utils import timezone
        sub.trial_ends_at = timezone.now() - timedelta(days=1)
        sub.save()

        response = self._call(self._state())
        self.assertIn('/billing', response['Location'])
        self.assertFalse(MetaAccountConnection.objects.exists())

    @override_settings(**FAKE_MODE)
    def test_reconnecting_replaces_the_previous_user_token(self):
        _make_connection(self.org, token='stale-token')
        self._call(self._state())
        self.assertEqual(MetaAccountConnection.objects.filter(organisation=self.org).count(), 1)
        self.assertEqual(
            MetaAccountConnection.objects.get(organisation=self.org).user_access_token,
            'fake-user-token',
        )


# ──────────────────────────────────────────────────────────────────────
# Pages: list + connect (AC3, AC4, AC5, AC6)
# ──────────────────────────────────────────────────────────────────────

class TestMetaPagesList(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(**FAKE_MODE)
    def test_listing_without_a_connection_is_a_conflict(self):
        self.assertEqual(self.client.get(PAGES_URL).status_code, 409)

    @override_settings(**FAKE_MODE)
    def test_fake_mode_lists_stand_in_pages_without_tokens(self):
        """AC3 — the picker has something to show on a laptop with no Meta app."""
        _make_connection(self.org)
        body = self.client.get(PAGES_URL).json()
        self.assertEqual(len(body), 2)
        self.assertEqual(body[0]['page_id'], 'fake-page-1')
        self.assertFalse(body[0]['connected'])
        self.assertNotIn('token', json.dumps(body))

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.get')
    def test_configured_mode_lists_live_pages_and_marks_connected(self, get):
        """AC3, AC4 — already-connected Pages come back flagged."""
        connection = _make_connection(self.org)
        _make_page(self.org, connection=connection, page_id='PAGE1')
        get.return_value = _response(200, _pages_payload())

        body = self.client.get(PAGES_URL).json()
        by_id = {p['page_id']: p for p in body}
        self.assertTrue(by_id['PAGE1']['connected'])
        self.assertFalse(by_id['PAGE2']['connected'])
        self.assertEqual(by_id['PAGE1']['instagram_username'], 'acme_ig')
        self.assertNotIn('page-token-1', json.dumps(body))

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.get')
    def test_a_graph_failure_surfaces_as_a_bad_gateway_not_a_500(self, get):
        _make_connection(self.org)
        get.return_value = _response(400, {'error': {'message': 'token expired'}})
        self.assertEqual(self.client.get(PAGES_URL).status_code, 502)


class TestMetaPagesConnect(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(**FAKE_MODE)
    def test_connecting_without_a_connection_is_a_conflict(self):
        self.assertEqual(
            self.client.post(PAGES_URL, {'page_ids': ['fake-page-1']}, format='json').status_code,
            409,
        )

    @override_settings(**FAKE_MODE)
    def test_empty_selection_is_rejected(self):
        _make_connection(self.org)
        self.assertEqual(
            self.client.post(PAGES_URL, {'page_ids': []}, format='json').status_code, 400,
        )

    @override_settings(**FAKE_MODE)
    def test_fake_mode_connects_the_selected_page_with_an_encrypted_token(self):
        """AC3, AC4."""
        _make_connection(self.org)
        response = self.client.post(PAGES_URL, {'page_ids': ['fake-page-1']}, format='json')
        self.assertEqual(response.status_code, 200)

        page = ConnectedMetaPage.objects.get(organisation=self.org, page_id='fake-page-1')
        self.assertEqual(page.page_name, 'Demo Catering (Test Page)')
        self.assertEqual(page.page_access_token, 'fake-page-token-1')
        self.assertNotIn('fake-page-token-1', page.page_access_token_encrypted)
        self.assertEqual(page.instagram_username, 'demo_catering')
        self.assertEqual(page.connected_by, self.user)
        self.assertNotIn('token', json.dumps(response.json()))

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.post')
    @patch('bookings.services.meta.requests.get')
    def test_configured_connect_subscribes_the_page_then_stores_the_row(self, get, post):
        """AC4, AC5 (subscription created)."""
        _make_connection(self.org)
        get.return_value = _response(200, _pages_payload())
        post.return_value = _response(200, {'success': True})

        response = self.client.post(PAGES_URL, {'page_ids': ['PAGE1']}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['errors'], [])

        # Subscribed the Page's webhooks with the Page token.
        self.assertIn('/PAGE1/subscribed_apps', post.call_args[0][0])
        self.assertEqual(post.call_args[1]['data']['subscribed_fields'], 'leadgen,messages')
        self.assertEqual(post.call_args[1]['data']['access_token'], 'page-token-1')

        page = ConnectedMetaPage.objects.get(organisation=self.org, page_id='PAGE1')
        self.assertEqual(page.page_access_token, 'page-token-1')
        self.assertEqual(page.instagram_account_id, 'IG1')

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.post')
    @patch('bookings.services.meta.requests.get')
    def test_a_failed_subscription_reports_an_error_and_stores_no_row(self, get, post):
        """A row must never exist for a Page whose webhook subscription failed."""
        _make_connection(self.org)
        get.return_value = _response(200, _pages_payload())
        post.return_value = _response(400, {'error': {'message': 'no permission'}})

        response = self.client.post(PAGES_URL, {'page_ids': ['PAGE1']}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['errors']), 1)
        self.assertFalse(ConnectedMetaPage.objects.filter(page_id='PAGE1').exists())

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.post')
    @patch('bookings.services.meta.requests.get')
    def test_an_unknown_page_id_is_reported_not_connected(self, get, post):
        _make_connection(self.org)
        get.return_value = _response(200, _pages_payload())

        response = self.client.post(PAGES_URL, {'page_ids': ['NOTMINE']}, format='json')
        self.assertEqual(len(response.json()['errors']), 1)
        self.assertFalse(ConnectedMetaPage.objects.filter(page_id='NOTMINE').exists())
        post.assert_not_called()

    @override_settings(**FAKE_MODE)
    def test_reconnecting_the_same_page_updates_in_place(self):
        connection = _make_connection(self.org)
        _make_page(self.org, connection=connection, page_id='fake-page-1', page_name='old name')
        self.client.post(PAGES_URL, {'page_ids': ['fake-page-1']}, format='json')

        pages = ConnectedMetaPage.objects.filter(organisation=self.org, page_id='fake-page-1')
        self.assertEqual(pages.count(), 1)
        self.assertEqual(pages.first().page_name, 'Demo Catering (Test Page)')

    @override_settings(**FAKE_MODE)
    def test_managers_cannot_connect_pages(self):
        _make_connection(self.org)
        manager = User.objects.create(email='mgr-pages@test.com', role='manager',
                                      organisation=self.org, is_active=True)
        client = APIClient()
        client.force_authenticate(manager)
        self.assertIn(
            client.post(PAGES_URL, {'page_ids': ['fake-page-1']}, format='json').status_code,
            (401, 403),
        )


# ──────────────────────────────────────────────────────────────────────
# Disconnect (AC5, AC6, AC7)
# ──────────────────────────────────────────────────────────────────────

class TestMetaDisconnect(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @override_settings(**FAKE_MODE)
    def test_disconnect_deletes_the_row_so_no_token_survives(self):
        """AC5."""
        _make_page(self.org, page_id='PAGE1')
        response = self.client.post(DISCONNECT_URL, {'page_id': 'PAGE1'}, format='json')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(ConnectedMetaPage.objects.filter(page_id='PAGE1').exists())

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.delete')
    def test_disconnect_also_asks_meta_to_drop_the_subscription(self, delete):
        """AC5."""
        _make_page(self.org, page_id='PAGE1', token='page-token-1')
        delete.return_value = _response(200, {'success': True})

        self.client.post(DISCONNECT_URL, {'page_id': 'PAGE1'}, format='json')
        self.assertIn('/PAGE1/subscribed_apps', delete.call_args[0][0])
        self.assertEqual(delete.call_args[1]['params']['access_token'], 'page-token-1')

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.delete', side_effect=RuntimeError('meta down'))
    def test_a_failed_unsubscribe_still_disconnects_locally(self, delete):
        _make_page(self.org, page_id='PAGE1')
        self.assertEqual(
            self.client.post(DISCONNECT_URL, {'page_id': 'PAGE1'}, format='json').status_code,
            204,
        )
        self.assertFalse(ConnectedMetaPage.objects.exists())

    @override_settings(**FAKE_MODE)
    def test_disconnecting_an_unknown_page_is_a_404(self):
        self.assertEqual(
            self.client.post(DISCONNECT_URL, {'page_id': 'nope'}, format='json').status_code, 404,
        )

    @override_settings(**FAKE_MODE)
    def test_cannot_disconnect_another_orgs_page(self):
        """AC6 — org B cannot disconnect org A's Page by id."""
        _make_page(_other_org(), page_id='RIVALPAGE')
        response = self.client.post(DISCONNECT_URL, {'page_id': 'RIVALPAGE'}, format='json')
        self.assertEqual(response.status_code, 404)
        self.assertTrue(ConnectedMetaPage.objects.filter(page_id='RIVALPAGE').exists())

    @override_settings(**FAKE_MODE)
    def test_managers_cannot_disconnect(self):
        """AC7."""
        _make_page(self.org, page_id='PAGE1')
        manager = User.objects.create(email='mgr-dis@test.com', role='manager',
                                      organisation=self.org, is_active=True)
        client = APIClient()
        client.force_authenticate(manager)
        self.assertIn(
            client.post(DISCONNECT_URL, {'page_id': 'PAGE1'}, format='json').status_code,
            (401, 403),
        )
        self.assertTrue(ConnectedMetaPage.objects.exists())


# ──────────────────────────────────────────────────────────────────────
# Service client unit tests
# ──────────────────────────────────────────────────────────────────────

class TestMetaService(TestCase):
    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.get')
    def test_list_pages_follows_paging(self, get):
        get.side_effect = [
            _response(200, {
                'data': [{'id': 'P1', 'name': 'One', 'access_token': 't1'}],
                'paging': {'next': 'https://graph.facebook.com/next-cursor'},
            }),
            _response(200, {
                'data': [{'id': 'P2', 'name': 'Two', 'access_token': 't2'}],
            }),
        ]
        pages = meta.list_pages('user-token')
        self.assertEqual([p['page_id'] for p in pages], ['P1', 'P2'])
        self.assertEqual(get.call_count, 2)

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.get')
    def test_a_graph_error_never_echoes_the_app_secret(self, get):
        get.return_value = _response(400, {'error': {'message': 'bad'}})
        with self.assertRaises(meta.MetaApiError) as caught:
            meta.list_pages('user-token')
        self.assertNotIn('app-secret', str(caught.exception))

    def test_app_configured_needs_both_id_and_secret(self):
        with override_settings(META_APP_ID='x', META_APP_SECRET=''):
            self.assertFalse(meta.app_configured())
        with override_settings(META_APP_ID='x', META_APP_SECRET='y'):
            self.assertTrue(meta.app_configured())

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.get')
    @patch('bookings.services.meta.requests.post')
    def test_token_exchange_posts_the_secret_in_the_body_not_the_url(self, post, get):
        """The app secret must never travel in a URL query string, where a
        proxy log or a network-error traceback could capture it."""
        post.return_value = _response(200, {'access_token': 'short', 'expires_in': 3600})
        meta.exchange_code('the-code')

        get.assert_not_called()
        url = post.call_args[0][0]
        self.assertTrue(url.endswith('/oauth/access_token'))
        self.assertNotIn('app-secret', url)
        self.assertEqual(post.call_args[1]['data']['client_secret'], 'app-secret')

    @override_settings(**APP_CONFIGURED)
    @patch('bookings.services.meta.requests.post',
           side_effect=meta.requests.ConnectionError('Max retries: /oauth?client_secret=app-secret'))
    def test_a_transport_error_never_carries_the_secret_out_of_the_service(self, post):
        """A raw requests error stringifies with the full URL; collapse it to a
        clean MetaApiError so the secret can't reach a log through it."""
        with self.assertRaises(meta.MetaApiError) as caught:
            meta.exchange_code('the-code')
        self.assertNotIn('app-secret', str(caught.exception))
