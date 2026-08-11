"""Token lifecycle: a credential change must end the session (REL-486).

The JWT carries only `user_id`, so nothing inside a token reflects a later
change to the account behind it. Without revocation, "reset the password" and
"de-activate the account" both leave the holder's refresh chain rotating into
fresh tokens for the full 7-day REFRESH_TOKEN_LIFETIME.
"""
from django.test import override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken, OutstandingToken,
)

from users.auth_testing import NoLoginThrottleTestCase
from users.models import Organisation, User
from users.tokens import revoke_user_tokens

LOGIN = "/api/auth/login/"
REFRESH = "/api/auth/refresh/"
PASSWORD = "testpass123"


@override_settings(LOGGING={})
class TokenRevocationTests(NoLoginThrottleTestCase):
    """These sign in several times per test to build the scenario, so the login
    throttle and the axes counters are lifted — neither is what's under test."""

    def setUp(self):
        super().setUp()
        self.org = Organisation.objects.create(name="TokenCo", slug="tokenco", country="US")
        self.user = User.objects.create_user(
            email="staff@tokenco.com", password=PASSWORD,
            first_name="Sam", last_name="Staff", role="manager", organisation=self.org,
        )

    def _logged_in_client(self, user=None, password=PASSWORD):
        client = APIClient()
        resp = client.post(
            LOGIN, {"email": (user or self.user).email, "password": password},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn("refresh_token", client.cookies)
        return client

    # ── AC1: password reset kills the outstanding refresh token ──

    def test_refresh_works_before_the_password_changes(self):
        """The control: without this, a 401 below proves nothing."""
        client = self._logged_in_client()
        self.assertEqual(client.post(REFRESH).status_code, 200)

    def test_password_reset_revokes_the_existing_refresh_token(self):
        client = self._logged_in_client()

        self.user.set_password("a-brand-new-password")
        self.user.save()

        resp = client.post(REFRESH)
        self.assertEqual(resp.status_code, 401, resp.content)

    def test_password_reset_through_the_management_api_revokes_tokens(self):
        """The real path: an owner resetting a departing employee's password."""
        victim = self._logged_in_client()
        owner = User.objects.create_user(
            email="owner@tokenco.com", password=PASSWORD,
            role="owner", organisation=self.org,
        )
        admin = self._logged_in_client(user=owner)

        resp = admin.patch(
            f"/api/auth/users/{self.user.id}/",
            {"password": "reset-by-the-owner"}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(victim.post(REFRESH).status_code, 401)
        # The owner's own session is untouched.
        self.assertEqual(admin.post(REFRESH).status_code, 200)

    def test_renaming_a_user_does_not_revoke_their_tokens(self):
        """Only credential changes end sessions — not any save at all."""
        client = self._logged_in_client()
        self.user.first_name = "Samuel"
        self.user.save()
        self.assertEqual(client.post(REFRESH).status_code, 200)

    def test_login_does_not_revoke_the_session_it_just_created(self):
        """last_login is written on every login; that must not be a revocation."""
        client = self._logged_in_client()
        self.assertEqual(client.post(REFRESH).status_code, 200)

    # ── AC2: de-activation kills the refresh chain ──

    def test_deactivated_user_cannot_refresh(self):
        client = self._logged_in_client()
        self.user.is_active = False
        self.user.save()
        self.assertEqual(client.post(REFRESH).status_code, 401)

    def test_deactivation_through_the_management_api_revokes_tokens(self):
        victim = self._logged_in_client()
        owner = User.objects.create_user(
            email="owner2@tokenco.com", password=PASSWORD,
            role="owner", organisation=self.org,
        )
        admin = self._logged_in_client(user=owner)

        resp = admin.patch(
            f"/api/auth/users/{self.user.id}/", {"is_active": False}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(victim.post(REFRESH).status_code, 401)

    def test_re_activation_does_not_resurrect_the_old_chain(self):
        """The point of revoking rather than only filtering on is_active."""
        client = self._logged_in_client()
        self.user.is_active = False
        self.user.save()
        self.user.is_active = True
        self.user.save()
        self.assertEqual(client.post(REFRESH).status_code, 401)

    # ── AC3: a deleted user's token is a 401, not a 500 ──

    def test_deleted_user_refresh_returns_401_not_500(self):
        client = self._logged_in_client()
        self.user.delete()
        resp = client.post(REFRESH)
        self.assertEqual(resp.status_code, 401, resp.content)

    # ── the helper itself ──

    def test_revoke_user_tokens_blacklists_every_outstanding_token(self):
        self._logged_in_client()
        self._logged_in_client()
        outstanding = OutstandingToken.objects.filter(user=self.user).count()
        self.assertGreaterEqual(outstanding, 2)

        self.assertEqual(revoke_user_tokens(self.user), outstanding)
        self.assertEqual(
            BlacklistedToken.objects.filter(token__user=self.user).count(), outstanding,
        )

    def test_revoke_user_tokens_is_idempotent(self):
        self._logged_in_client()
        revoke_user_tokens(self.user)
        self.assertEqual(revoke_user_tokens(self.user), 0)

    def test_other_users_tokens_are_left_alone(self):
        other = User.objects.create_user(
            email="other@tokenco.com", password=PASSWORD, organisation=self.org,
        )
        other_client = self._logged_in_client(user=other)
        revoke_user_tokens(self.user)
        self.assertEqual(other_client.post(REFRESH).status_code, 200)

    # ── the user can get back in afterwards ──

    def test_the_user_can_log_in_again_with_the_new_password(self):
        client = self._logged_in_client()
        self.user.set_password("a-brand-new-password")
        self.user.save()
        self.assertEqual(client.post(REFRESH).status_code, 401)

        fresh = self._logged_in_client(password="a-brand-new-password")
        self.assertEqual(fresh.post(REFRESH).status_code, 200)
