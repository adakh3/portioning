"""Tests for SaaS subscription billing (the `payments` app).

Stripe is never called for real — `payments.services.stripe_gateway` is mocked,
and webhook handlers are driven with plain dict events shaped like Stripe's.

Note: creating an Organisation fires a post_save signal that gives it a no-card
free trial (see `payments.signals`), so every org starts with a trialing
Subscription. Tests fetch that auto-created row via `org.subscription`.
"""
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from users.models import Organisation, User

from . import webhook_handlers
from .access import org_has_access
from .models import Subscription, SubscriptionStatus

SUBSCRIPTION = "/api/billing/subscription/"
CHECKOUT = "/api/billing/checkout/"
PORTAL = "/api/billing/portal/"


def extend_trial_url(org_id):
    return f"/api/billing/extend-trial/{org_id}/"


class BillingTestBase(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="BillCo", slug="billco", country="PK")
        self.owner = User.objects.create(email="owner@x.com", role="owner",
                                         organisation=self.org, is_active=True)
        self.manager = User.objects.create(email="mgr@x.com", role="manager",
                                           organisation=self.org, is_active=True)

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c


class TrialSignupTests(TestCase):
    def test_new_org_has_no_access_until_it_subscribes(self):
        # Card-required trial: signup creates the billing row but grants no
        # access. The org starts the (Stripe-managed) trial via Checkout.
        org = Organisation.objects.create(name="Fresh", slug="fresh", country="PK")
        sub = org.subscription  # created by signal
        self.assertEqual(sub.status, SubscriptionStatus.NONE)
        self.assertFalse(sub.has_access)
        self.assertFalse(sub.is_trialing)
        self.assertFalse(sub.has_billing_account)


class SubscriptionModelTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="X", slug="x", country="PK")
        self.sub = self.org.subscription

    def test_paid_statuses_grant_access(self):
        for status, expected in [
            (SubscriptionStatus.NONE, False),
            (SubscriptionStatus.ACTIVE, True),
            (SubscriptionStatus.PAST_DUE, True),
            (SubscriptionStatus.UNPAID, False),
            (SubscriptionStatus.CANCELED, False),
        ]:
            self.sub.status = status
            self.sub.trial_ends_at = None
            self.assertEqual(self.sub.has_access, expected, status)

    def test_live_trial_has_access_expired_does_not(self):
        self.sub.status = SubscriptionStatus.TRIALING
        self.sub.trial_ends_at = timezone.now() + timedelta(days=2)
        self.assertTrue(self.sub.has_access)
        self.sub.trial_ends_at = timezone.now() - timedelta(days=1)
        self.assertFalse(self.sub.has_access)
        self.assertEqual(self.sub.trial_days_remaining, 0)

    def test_extend_trial_from_expired_gives_full_window(self):
        self.sub.status = SubscriptionStatus.TRIALING
        self.sub.trial_ends_at = timezone.now() - timedelta(days=3)
        self.sub.extend_trial(7)
        self.assertTrue(self.sub.has_access)
        self.assertGreaterEqual(self.sub.trial_days_remaining, 6)

    def test_extend_trial_from_active_adds_to_remaining(self):
        self.sub.status = SubscriptionStatus.TRIALING
        self.sub.trial_ends_at = timezone.now() + timedelta(days=3)
        self.sub.extend_trial(7)
        self.assertGreaterEqual(self.sub.trial_days_remaining, 9)

    def test_trial_days_remaining_rounds_up(self):
        # A just-started 7-day trial (ends in ~6.99 days) should read 7, not 6
        # (Python's .days floors; we ceil to match Stripe's "7 days free").
        self.sub.status = SubscriptionStatus.TRIALING
        self.sub.trial_ends_at = timezone.now() + timedelta(days=7) - timedelta(minutes=1)
        self.assertEqual(self.sub.trial_days_remaining, 7)
        # Final day: ~0.5 days left still reads 1 (not 0) while access holds.
        self.sub.trial_ends_at = timezone.now() + timedelta(hours=12)
        self.assertEqual(self.sub.trial_days_remaining, 1)

    def test_has_billing_account_tracks_stripe_customer(self):
        # A fresh trial has no Stripe customer yet — nothing to manage.
        self.assertFalse(self.sub.has_billing_account)
        self.sub.stripe_customer_id = "cus_abc"
        self.assertTrue(self.sub.has_billing_account)

    def test_comped_grants_access_regardless_of_status(self):
        # Complimentary (friendly/grandfathered) access overrides status.
        self.sub.status = SubscriptionStatus.NONE
        self.sub.trial_ends_at = None
        self.assertFalse(self.sub.has_access)
        self.sub.comped = True
        self.assertTrue(self.sub.has_access)
        # Even an otherwise-dead status stays accessible while comped.
        self.sub.status = SubscriptionStatus.CANCELED
        self.assertTrue(self.sub.has_access)


class SubscriptionStatusViewTests(BillingTestBase):
    def test_status_returns_no_access_for_new_org(self):
        res = self.client_for(self.manager).get(SUBSCRIPTION)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "none")
        self.assertFalse(body["has_access"])
        self.assertFalse(body["is_trialing"])
        self.assertFalse(body["has_billing_account"])
        self.assertFalse(body["comped"])

    def test_status_requires_auth(self):
        self.assertIn(APIClient().get(SUBSCRIPTION).status_code, (401, 403))


class CheckoutViewTests(BillingTestBase):
    @override_settings(STRIPE_PRICE_ID="price_ci_test")
    @patch("payments.views.stripe_gateway.create_checkout_session")
    def test_owner_can_start_checkout_with_trial(self, mock_create):
        mock_create.return_value = {"url": "https://checkout.stripe.test/abc"}
        res = self.client_for(self.owner).post(
            CHECKOUT, {"price_id": "price_123"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["url"], "https://checkout.stripe.test/abc")
        mock_create.assert_called_once()
        # First subscription → card-required free trial is requested.
        self.assertEqual(mock_create.call_args.kwargs["trial_period_days"],
                         settings.DEFAULT_TRIAL_DAYS)

    @override_settings(STRIPE_PRICE_ID="price_ci_test")
    @patch("payments.views.stripe_gateway.create_checkout_session")
    def test_resubscribe_gets_no_second_trial(self, mock_create):
        # An org that has had a subscription before doesn't get another trial.
        sub = self.org.subscription
        sub.stripe_subscription_id = "sub_old"
        sub.save()
        mock_create.return_value = {"url": "https://checkout.stripe.test/abc"}
        res = self.client_for(self.owner).post(
            CHECKOUT, {"price_id": "price_123"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(mock_create.call_args.kwargs["trial_period_days"])

    def test_manager_cannot_start_checkout(self):
        res = self.client_for(self.manager).post(
            CHECKOUT, {"price_id": "price_123"}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_checkout_needs_a_price(self):
        with self.settings(STRIPE_PRICE_ID=""):
            res = self.client_for(self.owner).post(CHECKOUT, {}, format="json")
        self.assertEqual(res.status_code, 400)


class PortalViewTests(BillingTestBase):
    def test_portal_requires_existing_customer(self):
        res = self.client_for(self.owner).post(PORTAL, {}, format="json")
        self.assertEqual(res.status_code, 400)

    @patch("payments.views.stripe_gateway.create_billing_portal_session")
    def test_portal_returns_url_when_customer_exists(self, mock_portal):
        self.org.subscription.stripe_customer_id = "cus_123"
        self.org.subscription.save()
        mock_portal.return_value = {"url": "https://portal.stripe.test/xyz"}
        res = self.client_for(self.owner).post(PORTAL, {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["url"], "https://portal.stripe.test/xyz")

    def test_manager_cannot_open_portal(self):
        res = self.client_for(self.manager).post(PORTAL, {}, format="json")
        self.assertIn(res.status_code, (401, 403))


class ExtendTrialViewTests(BillingTestBase):
    def setUp(self):
        super().setUp()
        self.su = User.objects.create(email="su@x.com", is_superuser=True,
                                      is_staff=True, is_active=True)

    def test_superuser_can_extend_trial(self):
        # Expire the trial first, then extend.
        sub = self.org.subscription
        sub.trial_ends_at = timezone.now() - timedelta(days=1)
        sub.save()
        res = self.client_for(self.su).post(
            extend_trial_url(self.org.id), {"days": 14}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertGreaterEqual(res.json()["trial_days_remaining"], 13)
        self.assertTrue(res.json()["has_access"])

    def test_owner_cannot_extend_trial(self):
        res = self.client_for(self.owner).post(
            extend_trial_url(self.org.id), {"days": 14}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_extend_rejects_non_positive_days(self):
        res = self.client_for(self.su).post(
            extend_trial_url(self.org.id), {"days": 0}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_extend_unknown_org_404(self):
        res = self.client_for(self.su).post(
            extend_trial_url(999999), {"days": 7}, format="json")
        self.assertEqual(res.status_code, 404)


class WebhookHandlerTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="HookCo", slug="hookco", country="PK")
        self.sub = self.org.subscription
        self.sub.stripe_customer_id = "cus_abc"
        self.sub.save()

    def _sub_event(self, event_type, **overrides):
        data = {
            "id": "sub_123",
            "customer": "cus_abc",
            "status": "active",
            "cancel_at_period_end": False,
            "current_period_end": 1893456000,  # 2030-01-01
            "items": {"data": [{"price": {"id": "price_x", "nickname": "Pro"}}]},
        }
        data.update(overrides)
        return {"id": "evt_1", "type": event_type, "data": {"object": data}}

    def test_subscription_created_syncs_local_mirror(self):
        webhook_handlers.handle_event(self._sub_event("customer.subscription.created"))
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.status, "active")
        self.assertEqual(self.sub.stripe_subscription_id, "sub_123")
        self.assertEqual(self.sub.stripe_price_id, "price_x")
        self.assertEqual(self.sub.plan_name, "Pro")
        self.assertEqual(self.sub.current_period_end,
                         datetime(2030, 1, 1, tzinfo=dt_timezone.utc))

    def test_subscription_updated_to_past_due(self):
        webhook_handlers.handle_event(
            self._sub_event("customer.subscription.updated", status="past_due"))
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.status, "past_due")
        self.assertTrue(self.sub.has_access)  # dunning still has access

    def test_subscription_deleted_marks_canceled(self):
        webhook_handlers.handle_event(self._sub_event("customer.subscription.deleted"))
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.status, "canceled")
        self.assertFalse(self.sub.has_access)

    def test_unknown_customer_is_ignored(self):
        evt = self._sub_event("customer.subscription.created", customer="cus_unknown",
                              id="sub_other")
        webhook_handlers.handle_event(evt)
        self.sub.refresh_from_db()
        # Our row is untouched — still as created (no access).
        self.assertEqual(self.sub.status, "none")

    def test_unhandled_event_type_is_noop(self):
        webhook_handlers.handle_event(
            {"id": "evt_2", "type": "invoice.paid", "data": {"object": {}}})
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.status, "none")

    def test_real_stripe_object_payload_syncs(self):
        """Regression: live Stripe sends StripeObjects (not dicts). stripe>=15's
        StripeObject has no .get/.to_dict_recursive, so the handler must flatten
        it first. A dict-only test mock would not catch this."""
        import stripe
        evt = self._sub_event("customer.subscription.created")
        evt["data"]["object"] = stripe.StripeObject.construct_from(
            evt["data"]["object"], "sk_test")
        self.assertFalse(isinstance(evt["data"]["object"], dict))  # truly a StripeObject
        webhook_handlers.handle_event(evt)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.status, "active")
        self.assertEqual(self.sub.stripe_subscription_id, "sub_123")
        self.assertEqual(self.sub.current_period_end,
                         datetime(2030, 1, 1, tzinfo=dt_timezone.utc))

    def test_period_end_falls_back_to_line_item(self):
        """Newer API versions (2025-08 'basil') drop top-level current_period_end
        and put it on the subscription item instead."""
        evt = self._sub_event("customer.subscription.created")
        del evt["data"]["object"]["current_period_end"]
        evt["data"]["object"]["items"]["data"][0]["current_period_end"] = 1893456000
        webhook_handlers.handle_event(evt)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.current_period_end,
                         datetime(2030, 1, 1, tzinfo=dt_timezone.utc))

    def test_card_required_trial_syncs_trial_end_and_grants_access(self):
        """A Stripe-managed trial arrives as status=trialing + trial_end; we
        mirror trial_ends_at so the org has access during the trial."""
        future = int((timezone.now() + timedelta(days=7)).timestamp())
        evt = self._sub_event("customer.subscription.created",
                              status="trialing", trial_end=future)
        webhook_handlers.handle_event(evt)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.status, "trialing")
        self.assertTrue(self.sub.is_trialing)
        self.assertTrue(self.sub.has_access)


class SubscriptionGateTests(TestCase):
    """The middleware paywall. Uses real JWT cookies (not force_authenticate,
    which bypasses middleware) so the gate actually resolves the user."""

    GATED = "/api/dishes/"  # a normal authenticated endpoint behind the gate

    def setUp(self):
        self.org = Organisation.objects.create(name="GateCo", slug="gateco", country="PK")
        self.user = User.objects.create(email="u@x.com", role="owner",
                                        organisation=self.org, is_active=True)
        # New orgs have no access (card-required). Put this one on a live trial
        # so the "can access" path is exercised; individual tests expire it.
        sub = self.org.subscription
        sub.status = SubscriptionStatus.TRIALING
        sub.trial_ends_at = timezone.now() + timedelta(days=5)
        sub.save()

    def cookie_client(self, user):
        c = APIClient()
        c.cookies['access_token'] = str(RefreshToken.for_user(user).access_token)
        return c

    def expire_trial(self):
        sub = self.org.subscription
        sub.trial_ends_at = timezone.now() - timedelta(days=1)
        sub.save()

    def test_live_trial_can_access(self):
        res = self.cookie_client(self.user).get(self.GATED)
        self.assertEqual(res.status_code, 200, res.content)

    def test_expired_trial_is_blocked_402(self):
        self.expire_trial()
        res = self.cookie_client(self.user).get(self.GATED)
        self.assertEqual(res.status_code, 402)
        self.assertEqual(res.json()["detail"], "subscription_required")

    def test_comped_org_can_access_without_a_plan(self):
        # A grandfathered / friendly org with no plan still gets in.
        sub = self.org.subscription
        sub.status = SubscriptionStatus.NONE
        sub.trial_ends_at = None
        sub.comped = True
        sub.save()
        res = self.cookie_client(self.user).get(self.GATED)
        self.assertEqual(res.status_code, 200, res.content)

    def test_billing_endpoints_stay_reachable_when_blocked(self):
        self.expire_trial()
        res = self.cookie_client(self.user).get(SUBSCRIPTION)
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["has_access"])

    def test_auth_endpoints_stay_reachable_when_blocked(self):
        self.expire_trial()
        res = self.cookie_client(self.user).get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)

    def test_superuser_bypasses_gate(self):
        su = User.objects.create(email="su@x.com", is_superuser=True,
                                 is_staff=True, is_active=True, organisation=self.org)
        self.expire_trial()
        res = self.cookie_client(su).get(self.GATED)
        self.assertEqual(res.status_code, 200, res.content)

    def test_anonymous_request_is_not_402(self):
        # No token: the gate leaves it alone; the view returns 401, not 402.
        res = APIClient().get(self.GATED)
        self.assertIn(res.status_code, (401, 403))

    # ── Blocked-response shape: XHR gets JSON, a page load gets sent somewhere ──

    HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    # What a real top-level navigation sends. Sec-Fetch-* are forbidden header
    # names, so script cannot forge them — which is why they're the primary
    # signal rather than Accept.
    NAV = {'HTTP_ACCEPT': HTML, 'HTTP_SEC_FETCH_DEST': 'document',
           'HTTP_SEC_FETCH_MODE': 'navigate'}

    def test_a_page_load_is_redirected_to_billing_not_shown_raw_json(self):
        self.expire_trial()
        res = self.cookie_client(self.user).get(self.GATED, **self.NAV)

        self.assertEqual(res.status_code, 302)
        self.assertIn('/billing', res['Location'])
        self.assertIn('reason=subscription_required', res['Location'])

    def test_the_oauth_callback_lands_on_billing_when_the_subscription_lapsed(self):
        """The reported case: the subscription expires mid-consent and the
        provider redirects the browser back into a gated endpoint.

        Resolved by name, and asserting no mailbox was created — the gate runs
        before URL resolution, so a hardcoded (or stale) path would pass this
        test without ever proving the callback itself is protected.
        """
        from bookings.models import ConnectedMailbox
        self.expire_trial()
        res = self.cookie_client(self.user).get(
            reverse('mailbox-callback'), {'error': 'access_denied'}, **self.NAV,
        )

        self.assertEqual(res.status_code, 302)
        self.assertIn('/billing', res['Location'])
        self.assertEqual(ConnectedMailbox.objects.count(), 0)

    def test_fetch_still_gets_the_402_json_the_frontend_handles(self):
        """The API client sets no Accept header, so fetch sends `*/*`. Changing
        that response shape would break every 402 path in lib/api.ts."""
        self.expire_trial()
        for accept in ('*/*', 'application/json', 'image/png', ''):
            res = self.cookie_client(self.user).get(self.GATED, HTTP_ACCEPT=accept)
            self.assertEqual(res.status_code, 402, accept)
            self.assertEqual(res.json()['detail'], 'subscription_required', accept)

    def test_a_client_that_merely_tolerates_html_is_not_redirected(self):
        """`application/json, text/html;q=0.1` prefers JSON. A substring test on
        Accept would bounce it into a cross-origin page it can't read, and the
        frontend's 402 handler would never fire."""
        self.expire_trial()
        res = self.cookie_client(self.user).get(
            self.GATED, HTTP_ACCEPT='application/json, text/html;q=0.1',
        )
        self.assertEqual(res.status_code, 402)

    def test_a_fetch_that_asks_for_html_is_still_not_a_navigation(self):
        """Sec-Fetch-Dest is authoritative when present, so an XHR that happens
        to request HTML still gets JSON."""
        self.expire_trial()
        res = self.cookie_client(self.user).get(
            self.GATED, HTTP_ACCEPT=self.HTML, HTTP_SEC_FETCH_DEST='empty',
        )
        self.assertEqual(res.status_code, 402)

    def test_a_write_is_never_redirected_even_from_a_browser(self):
        """Only GET navigations redirect — bouncing a POST would silently drop
        the body and look like a successful no-op."""
        self.expire_trial()
        res = self.cookie_client(self.user).post(self.GATED, {}, format='json', **self.NAV)
        self.assertEqual(res.status_code, 402)

    def test_the_blocked_response_varies_on_what_chose_its_shape(self):
        """Two bodies for one URL — an intermediary keying only on the URL could
        otherwise hand a cached redirect to an XHR."""
        self.expire_trial()
        res = self.cookie_client(self.user).get(self.GATED, **self.NAV)
        vary = res['Vary'].lower()
        self.assertIn('accept', vary)
        self.assertIn('sec-fetch-dest', vary)

    def test_a_page_load_on_a_live_subscription_is_not_touched(self):
        res = self.cookie_client(self.user).get(self.GATED, **self.NAV)
        self.assertEqual(res.status_code, 200, res.content)

    def test_an_exempt_path_is_not_redirected_even_as_a_navigation(self):
        self.expire_trial()
        res = self.cookie_client(self.user).get(SUBSCRIPTION, **self.NAV)
        self.assertEqual(res.status_code, 200)

    def test_a_clients_sign_page_survives_the_caterer_being_locked_out(self):
        """REL-473 AC4 — the gate skips unauthenticatable requests, and that is
        load-bearing here: a caterer's billing problem must never stop their
        client signing. 404 for an unknown token, but never 402."""
        self.expire_trial()
        res = APIClient().get(
            '/api/public/bookings/00000000-0000-0000-0000-000000000000/', **self.NAV,
        )
        self.assertNotEqual(res.status_code, 402)


class OrgAccessHelperTests(TestCase):
    """REL-473 AC5 — the middleware and the OAuth callback must agree on what
    'has access' means, so both go through here."""

    def setUp(self):
        self.org = Organisation.objects.create(name="AccessCo", slug="accessco", country="US")

    def test_a_brand_new_org_has_no_access(self):
        """Billing is card-required — a new org starts at NONE and is gated
        until it subscribes. Worth pinning here because it's the assumption the
        OAuth callback now leans on."""
        self.assertFalse(org_has_access(self.org))

    def test_a_live_trial_has_access(self):
        sub = self.org.subscription
        sub.status = SubscriptionStatus.TRIALING
        sub.trial_ends_at = timezone.now() + timedelta(days=5)
        sub.save()
        self.assertTrue(org_has_access(self.org))

    def test_an_expired_trial_does_not(self):
        sub = self.org.subscription
        sub.status = SubscriptionStatus.TRIALING
        sub.trial_ends_at = timezone.now() - timedelta(days=1)
        sub.save()
        self.assertFalse(org_has_access(self.org))

    def test_a_paying_org_has_access(self):
        sub = self.org.subscription
        sub.status = SubscriptionStatus.ACTIVE
        sub.save()
        self.assertTrue(org_has_access(self.org))

    def test_a_comped_org_has_access_with_no_plan(self):
        sub = self.org.subscription
        sub.status = SubscriptionStatus.NONE
        sub.trial_ends_at = None
        sub.comped = True
        sub.save()
        self.assertTrue(org_has_access(self.org))

    def test_no_subscription_row_means_no_access(self):
        """Billing is card-required; a missing row is not a reason to let
        someone in."""
        Subscription.objects.filter(organisation=self.org).delete()
        self.assertFalse(org_has_access(self.org))

    def test_none_is_not_access(self):
        self.assertFalse(org_has_access(None))


class WebhookViewTests(TestCase):
    @patch("payments.views.stripe_gateway.verify_webhook_event")
    def test_bad_signature_returns_400(self, mock_verify):
        import stripe
        mock_verify.side_effect = stripe.error.SignatureVerificationError("bad", "sig")
        res = APIClient().post("/api/billing/webhook/", data=b"{}",
                               content_type="application/json")
        self.assertEqual(res.status_code, 400)

    @patch("payments.views.webhook_handlers.handle_event")
    @patch("payments.views.stripe_gateway.verify_webhook_event")
    def test_valid_event_is_dispatched_and_acked(self, mock_verify, mock_handle):
        mock_verify.return_value = {"id": "evt_1", "type": "customer.subscription.updated",
                                    "data": {"object": {}}}
        res = APIClient().post("/api/billing/webhook/", data=b"{}",
                               content_type="application/json")
        self.assertEqual(res.status_code, 200)
        mock_handle.assert_called_once()


class WebhookEmptySecretTests(TestCase):
    """The webhook must fail closed when STRIPE_WEBHOOK_SECRET is unset (REL-484).

    Nothing about an empty secret is inert: Stripe's construct_event() HMACs the
    payload with whatever key it is handed, and an empty key is one the attacker
    knows too. These tests sign a real event the way an attacker would and prove
    it never reaches a handler.
    """

    # A real, well-formed event — `object` and a fresh timestamp included — so
    # that with the guard removed this genuinely verifies and dispatches. A
    # stale timestamp or a malformed body would be rejected by the SDK for
    # reasons that have nothing to do with the secret, and the test would pass
    # while proving nothing.
    FORGED = (
        b'{"id":"evt_forged","object":"event","type":"customer.subscription.created",'
        b'"data":{"object":{"id":"sub_x","customer":"cus_own","status":"active",'
        b'"items":{"data":[{"price":{"id":"price_x"}}]}}}}'
    )

    def _sign(self, body: bytes, secret: str) -> str:
        """The Stripe-Signature header an attacker computes for themselves.

        With `secret=""` the HMAC key is the empty string — a value the attacker
        knows as well as we do, which is the whole bug.
        """
        import hashlib
        import hmac
        import time
        timestamp = int(time.time())
        signature = hmac.new(
            secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256,
        ).hexdigest()
        return f"t={timestamp},v1={signature}"

    def test_the_forgery_is_otherwise_valid(self):
        """Guard on the guard: prove the payload really would be accepted.

        If this ever stops passing, the tests below are green for the wrong
        reason and the empty-secret path is no longer being exercised.
        """
        import stripe
        stripe.api_key = "sk_test_x"
        event = stripe.Webhook.construct_event(
            self.FORGED, self._sign(self.FORGED, ""), "",
        )
        self.assertEqual(event["id"], "evt_forged")

    @override_settings(STRIPE_WEBHOOK_SECRET="")
    @patch("payments.views.webhook_handlers.handle_event")
    def test_forged_event_is_rejected_when_the_secret_is_empty(self, mock_handle):
        res = APIClient().post(
            "/api/billing/webhook/", data=self.FORGED,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE=self._sign(self.FORGED, ""),
        )
        # 500 (misconfiguration), not 200 — and above all, not dispatched.
        self.assertEqual(res.status_code, 500)
        mock_handle.assert_not_called()

    @override_settings(STRIPE_WEBHOOK_SECRET="")
    def test_no_subscription_is_activated_when_the_secret_is_empty(self):
        """The bite of the bug: the webhook is the only path to a paid state."""
        org = Organisation.objects.create(name="Forge", slug="forge", country="US")
        sub = org.subscription
        sub.stripe_customer_id = "cus_own"
        sub.save(update_fields=["stripe_customer_id"])

        APIClient().post(
            "/api/billing/webhook/", data=self.FORGED,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE=self._sign(self.FORGED, ""),
        )
        sub.refresh_from_db()
        self.assertNotEqual(sub.status, SubscriptionStatus.ACTIVE)

    @override_settings(STRIPE_WEBHOOK_SECRET="")
    def test_gateway_raises_before_reaching_construct_event(self):
        """Fail closed *before* the SDK, not by trusting it to refuse."""
        from django.core.exceptions import ImproperlyConfigured

        from .services import stripe_gateway

        with patch("stripe.Webhook.construct_event") as mock_construct:
            with self.assertRaises(ImproperlyConfigured):
                stripe_gateway.verify_webhook_event(b"{}", "t=1,v1=x")
        mock_construct.assert_not_called()

    @override_settings(STRIPE_SECRET_KEY="")
    def test_api_calls_refuse_an_empty_secret_key(self):
        from django.core.exceptions import ImproperlyConfigured

        from .services import stripe_gateway

        org = Organisation.objects.create(name="NoKey", slug="nokey", country="US")
        with self.assertRaises(ImproperlyConfigured):
            stripe_gateway.get_or_create_customer(org.subscription)

    @override_settings(STRIPE_WEBHOOK_SECRET="", STRIPE_SECRET_KEY="")
    def test_deploy_check_flags_both_missing_credentials(self):
        from .checks import check_stripe_credentials

        ids = {e.id for e in check_stripe_credentials(None)}
        self.assertEqual(ids, {"payments.E001", "payments.E002"})

    @override_settings(STRIPE_WEBHOOK_SECRET="whsec_x", STRIPE_SECRET_KEY="sk_x")
    def test_deploy_check_passes_when_both_are_set(self):
        from .checks import check_stripe_credentials

        self.assertEqual(check_stripe_credentials(None), [])
