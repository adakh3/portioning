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
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from users.models import Organisation, User

from . import webhook_handlers
from .models import SubscriptionStatus

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
