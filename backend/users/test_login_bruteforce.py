"""Brute-force protection on the login paths (REL-485).

Before this, LoginView was AllowAny behind a single global AnonRateThrottle of
100/hour, and that limit was keyed on the client-supplied X-Forwarded-For chain
— so it could be reset at will. The Django admin login had no limit at all.

Every test here drives the real endpoints; nothing about the lockout is mocked.
"""
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from axes.models import AccessAttempt

from users.auth_testing import (
    AuthEndpointTestCase, NoLoginThrottleTestCase, throttle_rates,
)
from users.models import Organisation, User
from users.throttling import axes_username, client_ip

LOGIN = "/api/auth/login/"
ADMIN_LOGIN = "/api/admin/login/"
PASSWORD = "testpass123"
WRONG = "not-the-password"


# The per-address rate limit is lifted here: it and the per-account lockout are
# separate mechanisms, and a 429 from the throttle arriving first would mask
# whether the lockout works at all. The throttle has its own class below.
@override_settings(LOGGING={}, AXES_FAILURE_LIMIT=3)
class LockoutTests(NoLoginThrottleTestCase):
    def setUp(self):
        super().setUp()
        self.org = Organisation.objects.create(name="LockCo", slug="lockco", country="US")
        self.user = User.objects.create_user(
            email="target@lockco.com", password=PASSWORD,
            first_name="Tara", last_name="Target", role="manager", organisation=self.org,
        )
        AccessAttempt.objects.all().delete()

    def _attempt(self, password=WRONG, email=None, ip="203.0.113.7", xff=None):
        extra = {"REMOTE_ADDR": ip}
        if xff is not None:
            extra["HTTP_X_FORWARDED_FOR"] = xff
        return APIClient().post(
            LOGIN, {"email": email or self.user.email, "password": password},
            format="json", **extra,
        )

    # ── AC1: repeated failures lock the account out, from any IP ──

    def test_a_wrong_password_is_401_until_the_limit(self):
        """The control: failures are ordinary 401s right up to the threshold."""
        for _ in range(2):
            self.assertEqual(self._attempt().status_code, 401)

    def test_the_account_locks_out_after_the_failure_limit(self):
        for _ in range(3):
            self._attempt()
        # Locked: even the CORRECT password no longer gets in.
        resp = self._attempt(password=PASSWORD)
        self.assertEqual(resp.status_code, 429, resp.content)

    def test_a_locked_out_user_is_told_to_wait_rather_than_that_they_typoed(self):
        """authenticate() swallows the lockout, so the view has to ask axes."""
        for _ in range(3):
            self._attempt()
        resp = self._attempt(password=PASSWORD)
        self.assertIn("Too many failed", resp.data["detail"])

    def test_the_lockout_holds_across_different_source_ips(self):
        """The distributed case — the one a per-IP limit cannot touch."""
        for i in range(3):
            self._attempt(ip=f"198.51.100.{i}")
        resp = self._attempt(password=PASSWORD, ip="198.51.100.99")
        self.assertNotEqual(resp.status_code, 200)

    def test_a_forged_x_forwarded_for_does_not_buy_a_fresh_allowance(self):
        """AC3, at the lockout layer: the key is the account, not the address."""
        for i in range(3):
            self._attempt(xff=f"10.0.0.{i}, 203.0.113.7")
        resp = self._attempt(password=PASSWORD, xff="10.0.0.250, 203.0.113.7")
        self.assertNotEqual(resp.status_code, 200)

    def test_locking_one_account_leaves_other_accounts_alone(self):
        """Or a handful of failures would take the whole org offline."""
        other = User.objects.create_user(
            email="bystander@lockco.com", password=PASSWORD, organisation=self.org,
        )
        for _ in range(3):
            self._attempt()
        resp = self._attempt(email=other.email, password=PASSWORD)
        self.assertEqual(resp.status_code, 200, resp.content)

    # ── AC4: a legitimate user gets back in ──

    def test_a_successful_login_resets_the_failure_count(self):
        """Two fat-fingered attempts must not leave a landmine for next week.

        Cookie-JWT auth never calls django.contrib.auth.login(), so nothing was
        sending the signal axes resets on: failures accumulated across
        successful sign-ins and an ordinary user would eventually be locked out
        for typos spread over weeks.
        """
        self._attempt()
        self._attempt()
        self.assertEqual(self._attempt(password=PASSWORD).status_code, 200)

        # The counter is back to zero, so two more failures still don't lock.
        self._attempt()
        self._attempt()
        self.assertEqual(self._attempt(password=PASSWORD).status_code, 200)

    def test_a_successful_login_records_last_login(self):
        """Same missing signal — this path never wrote last_login either."""
        self.assertIsNone(self.user.last_login)
        self.assertEqual(self._attempt(password=PASSWORD).status_code, 200)
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.last_login)

    def test_the_user_can_log_in_again_once_the_lockout_is_cleared(self):
        """Stands in for AXES_COOLOFF_TIME expiring, without sleeping 30 minutes."""
        for _ in range(3):
            self._attempt()
        self.assertNotEqual(self._attempt(password=PASSWORD).status_code, 200)

        AccessAttempt.objects.all().delete()  # what the cooloff does on its own
        self.assertEqual(self._attempt(password=PASSWORD).status_code, 200)

    # ── AC2: the Django admin login is covered too ──

    def test_the_django_admin_login_is_locked_out_as_well(self):
        """DRF throttles never applied here — this path had no limit at all."""
        staff = User.objects.create_user(
            email="root@lockco.com", password=PASSWORD, organisation=self.org,
        )
        staff.is_staff = staff.is_superuser = True
        staff.save()
        AccessAttempt.objects.all().delete()

        client = APIClient()
        for _ in range(3):
            client.post(ADMIN_LOGIN, {"username": staff.email, "password": WRONG})

        resp = client.post(ADMIN_LOGIN, {"username": staff.email, "password": PASSWORD})
        self.assertIn(resp.status_code, (403, 429))

    def test_admin_and_api_failures_count_against_the_same_account(self):
        """Locking by account only works if both doors feed one counter."""
        client = APIClient()
        for _ in range(2):
            client.post(ADMIN_LOGIN, {"username": self.user.email, "password": WRONG})
        self._attempt()

        resp = self._attempt(password=PASSWORD)
        self.assertNotEqual(resp.status_code, 200)


@override_settings(LOGGING={}, AXES_FAILURE_LIMIT=3)
class AxesUsernameTests(AuthEndpointTestCase):
    """The identity axes counts against.

    Axes reads request.POST by default, which a DRF JSON body never populates —
    every attempt would then share one blank-username bucket, and three failures
    against any account would lock out every account at once.
    """

    def setUp(self):
        super().setUp()
        self.org = Organisation.objects.create(name="IdCo", slug="idco", country="US")

    def test_the_email_is_read_from_the_credentials(self):
        self.assertEqual(
            axes_username(None, {"email": "Person@Example.com "}), "person@example.com",
        )

    def test_the_admin_forms_username_field_is_read_too(self):
        self.assertEqual(
            axes_username(None, {"username": "admin@example.com"}), "admin@example.com",
        )

    def test_a_missing_username_is_empty_not_an_error(self):
        self.assertEqual(axes_username(None, {}), "")
        self.assertEqual(axes_username(None, None), "")

    def test_axes_resolves_a_json_login_to_the_real_email(self):
        """End-to-end: the callable is actually wired up in settings."""
        User.objects.create_user(
            email="wired@idco.com", password=PASSWORD, organisation=self.org,
        )
        AccessAttempt.objects.all().delete()
        APIClient().post(
            LOGIN, {"email": "wired@idco.com", "password": WRONG}, format="json",
        )
        attempt = AccessAttempt.objects.get()
        self.assertEqual(attempt.username, "wired@idco.com")


class ClientIpTests(TestCase):
    """AC3 at the throttle layer: the key can't be chosen by the caller."""

    class _Req:
        def __init__(self, **meta):
            self.META = meta

    def test_the_proxy_appended_hop_wins_over_anything_the_client_sent(self):
        request = self._Req(
            HTTP_X_FORWARDED_FOR="10.0.0.1, 10.0.0.2, 203.0.113.9",
            REMOTE_ADDR="172.16.0.1",
        )
        self.assertEqual(client_ip(request), "203.0.113.9")

    def test_a_forged_chain_cannot_change_the_key(self):
        keys = {
            client_ip(self._Req(
                HTTP_X_FORWARDED_FOR=f"{spoof}, 203.0.113.9", REMOTE_ADDR="172.16.0.1",
            ))
            for spoof in ("1.1.1.1", "2.2.2.2", "3.3.3.3")
        }
        self.assertEqual(keys, {"203.0.113.9"})

    def test_it_falls_back_to_remote_addr_with_no_proxy_header(self):
        self.assertEqual(client_ip(self._Req(REMOTE_ADDR="192.0.2.5")), "192.0.2.5")


@override_settings(LOGGING={}, AXES_ENABLED=False)
class LoginRateThrottleTests(AuthEndpointTestCase):
    """The per-address ceiling, isolated from the per-account lockout."""

    def setUp(self):
        super().setUp()
        rates = throttle_rates(login='3/min')
        rates.start()
        self.addCleanup(rates.stop)

        self.org = Organisation.objects.create(name="RateCo", slug="rateco", country="US")
        self.user = User.objects.create_user(
            email="rate@rateco.com", password=PASSWORD, organisation=self.org,
        )

    def _post(self, xff=None):
        extra = {"REMOTE_ADDR": "203.0.113.7"}
        if xff is not None:
            extra["HTTP_X_FORWARDED_FOR"] = xff
        return APIClient().post(
            LOGIN, {"email": self.user.email, "password": WRONG}, format="json", **extra,
        )

    def test_the_throttle_message_is_written_for_a_person(self):
        """DRF's default is developer-facing, and this lands on the sign-in page.

        The reader is a caterer who mistyped their password, not someone
        debugging an API.
        """
        for _ in range(4):
            resp = self._post()
        self.assertEqual(resp.status_code, 429)
        detail = resp.data["detail"]
        self.assertIn("Too many sign-in attempts from this device", detail)
        self.assertRegex(detail, r"Try again in \d+ seconds?\.")
        self.assertNotIn("Request was throttled", detail)
        self.assertNotIn("Expected available", detail)
        # wait must survive, or DRF cannot set Retry-After.
        self.assertIn("Retry-After", resp.headers)

    def test_too_many_attempts_from_one_address_are_throttled(self):
        statuses = [self._post().status_code for _ in range(5)]
        self.assertEqual(statuses[:3], [401, 401, 401])
        self.assertEqual(statuses[3:], [429, 429])

    def test_rotating_x_forwarded_for_does_not_mint_a_fresh_bucket(self):
        """The bug itself: this is what made the old 100/hour meaningless.

        Each request presents a different forged chain; only the final hop —
        the one our proxy appended — is real, so all five share a bucket.
        """
        statuses = [
            self._post(xff=f"10.0.0.{i}, 203.0.113.7").status_code for i in range(5)
        ]
        self.assertEqual(statuses[3:], [429, 429])

    def test_a_genuinely_different_client_gets_its_own_bucket(self):
        """The limit must narrow the key, not collapse everyone into one."""
        for _ in range(4):
            self._post()
        other = APIClient().post(
            LOGIN, {"email": self.user.email, "password": WRONG}, format="json",
            REMOTE_ADDR="192.0.2.50", HTTP_X_FORWARDED_FOR="10.0.0.1, 192.0.2.50",
        )
        self.assertEqual(other.status_code, 401)

    def _login_ok(self):
        return APIClient().post(
            LOGIN, {"email": self.user.email, "password": PASSWORD}, format="json",
            REMOTE_ADDR="203.0.113.7",
        )

    def test_successful_sign_ins_do_not_spend_the_budget(self):
        """Everyone in one office shares an address.

        Counting successes means a dozen colleagues signing in at 9am lock out
        the office — and it is what made the e2e suite, which signs in once per
        spec, fail halfway through its run.
        """
        for _ in range(8):
            self.assertEqual(self._login_ok().status_code, 200)

    def test_the_csrf_cookie_fetch_does_not_spend_the_budget(self):
        """Every visit to the sign-in page makes this GET.

        Counting it locked people out of the page before they could type
        anything, and each redirect to /login burned another — which is what
        broke the e2e suite even after successful sign-ins stopped counting.
        """
        client = APIClient()
        for _ in range(12):
            resp = client.get(LOGIN, REMOTE_ADDR="203.0.113.7")
            self.assertEqual(resp.status_code, 200)
        # And the POST budget is untouched by all those GETs.
        self.assertEqual(self._post().status_code, 401)

    def test_failures_still_count_after_a_success(self):
        """The refund must return one attempt, not clear the whole history."""
        self._post()
        self._post()
        self.assertEqual(self._login_ok().status_code, 200)
        self._post()
        self.assertEqual(self._post().status_code, 429)
