"""Tiered + regional subscription pricing.

Covers region resolution (country -> region), the plans endpoint (priced for the
caller's org region), and checkout resolving the region-correct Stripe price
server-side. Stripe is mocked.
"""
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from users.models import Organisation, User
from .models import PricingRegion, Plan, PlanPrice


def make_region(code, name, currency, countries=(), is_default=False, sort=0):
    return PricingRegion.objects.create(
        code=code, name=name, currency_code=currency, currency_symbol=currency[:1],
        countries=list(countries), is_default=is_default, sort_order=sort,
    )


def make_plan(code, name, sort=0):
    return Plan.objects.create(code=code, name=name, sort_order=sort)


def make_price(plan, region, price_id, amount):
    return PlanPrice.objects.create(
        plan=plan, region=region, stripe_price_id=price_id, display_amount=Decimal(amount),
    )


class RegionResolutionTests(TestCase):
    def setUp(self):
        self.sa = make_region("south-asia", "South Asia", "PKR", countries=["PK", "IN", "BD"], sort=1)
        self.row = make_region("row", "Rest of world", "USD", is_default=True, sort=99)

    def test_country_in_a_region(self):
        self.assertEqual(PricingRegion.for_country("PK"), self.sa)
        self.assertEqual(PricingRegion.for_country("in"), self.sa)  # case-insensitive

    def test_unmapped_country_falls_back_to_default(self):
        self.assertEqual(PricingRegion.for_country("US"), self.row)
        self.assertEqual(PricingRegion.for_country("ZZ"), self.row)

    def test_no_default_and_unmapped_is_none(self):
        self.row.is_default = False
        self.row.save()
        self.assertIsNone(PricingRegion.for_country("US"))

    def test_inactive_region_is_ignored(self):
        self.sa.is_active = False
        self.sa.save()
        # PK no longer maps to South Asia → falls back to the default region.
        self.assertEqual(PricingRegion.for_country("PK"), self.row)

    def test_price_for_region(self):
        pro = make_plan("pro", "Pro")
        p_sa = make_price(pro, self.sa, "price_sa", "2000.00")
        make_price(pro, self.row, "price_row", "99.00")
        self.assertEqual(pro.price_for_region(self.sa), p_sa)
        self.assertEqual(pro.price_for_region(self.sa).stripe_price_id, "price_sa")

    def test_price_for_region_none_when_missing(self):
        pro = make_plan("pro", "Pro")
        # No PlanPrice for this region.
        self.assertIsNone(pro.price_for_region(self.sa))


PLANS = "/api/billing/plans/"
CHECKOUT = "/api/billing/checkout/"


class PlansEndpointTests(TestCase):
    def setUp(self):
        self.sa = make_region("south-asia", "South Asia", "PKR", countries=["PK"], sort=1)
        self.row = make_region("row", "Rest of world", "USD", is_default=True, sort=99)
        self.starter = make_plan("starter", "Starter", sort=1)
        self.pro = make_plan("pro", "Pro", sort=2)
        for plan, sa_amt, us_amt in [(self.starter, "1000", "29"), (self.pro, "3000", "99")]:
            make_price(plan, self.sa, f"price_{plan.code}_sa", sa_amt)
            make_price(plan, self.row, f"price_{plan.code}_us", us_amt)

    def _client(self, country):
        org = Organisation.objects.create(name=f"Org-{country}", slug=f"org-{country}",
                                          country=country)
        owner = User.objects.create(email=f"o-{country}@x.com", role="owner",
                                    organisation=org, is_active=True)
        c = APIClient()
        c.force_authenticate(owner)
        return c

    def test_plans_priced_for_pk_region(self):
        res = self._client("PK").get(PLANS)
        self.assertEqual(res.status_code, 200)
        by_code = {p["code"]: p for p in res.json()}
        self.assertEqual(by_code["pro"]["display_amount"], "3000.00")
        self.assertEqual(by_code["pro"]["currency"], "PKR")

    def test_plans_priced_for_us_falls_to_default_region(self):
        res = self._client("US").get(PLANS)
        by_code = {p["code"]: p for p in res.json()}
        self.assertEqual(by_code["pro"]["display_amount"], "99.00")
        self.assertEqual(by_code["pro"]["currency"], "USD")

    def test_tier_without_a_price_in_region_is_hidden(self):
        # A tier with no PlanPrice for any region shouldn't appear.
        make_plan("ghost", "Ghost", sort=3)
        res = self._client("PK").get(PLANS)
        self.assertNotIn("ghost", {p["code"] for p in res.json()})

    def test_empty_when_no_plans_configured(self):
        Plan.objects.all().delete()
        res = self._client("PK").get(PLANS)
        self.assertEqual(res.json(), [])


class CheckoutByPlanTests(TestCase):
    def setUp(self):
        self.sa = make_region("south-asia", "South Asia", "PKR", countries=["PK"], sort=1)
        self.row = make_region("row", "Rest of world", "USD", is_default=True, sort=99)
        self.pro = make_plan("pro", "Pro")
        make_price(self.pro, self.sa, "price_pro_sa", "3000")
        make_price(self.pro, self.row, "price_pro_us", "99")
        self.org = Organisation.objects.create(name="PKco", slug="pkco", country="PK")
        self.owner = User.objects.create(email="owner@pk.com", role="owner",
                                         organisation=self.org, is_active=True)

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    @patch("payments.views.stripe_gateway.create_checkout_session")
    def test_checkout_uses_region_price_for_plan(self, mock_create):
        mock_create.return_value = {"url": "https://checkout.test/x"}
        res = self._client(self.owner).post(CHECKOUT, {"plan": "pro"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        # PK org → South Asia price, not the US one.
        self.assertEqual(mock_create.call_args.kwargs["price_id"], "price_pro_sa")

    @patch("payments.views.stripe_gateway.create_checkout_session")
    def test_us_org_gets_default_region_price(self, mock_create):
        mock_create.return_value = {"url": "https://checkout.test/x"}
        us_org = Organisation.objects.create(name="USco", slug="usco", country="US")
        us_owner = User.objects.create(email="o@us.com", role="owner",
                                       organisation=us_org, is_active=True)
        self._client(us_owner).post(CHECKOUT, {"plan": "pro"}, format="json")
        self.assertEqual(mock_create.call_args.kwargs["price_id"], "price_pro_us")

    def test_unknown_plan_rejected(self):
        res = self._client(self.owner).post(CHECKOUT, {"plan": "nope"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_plan_without_region_price_rejected(self):
        # A tier with no price in the org's region → 400, no checkout.
        starter = make_plan("starter", "Starter")
        make_price(starter, self.row, "price_starter_us", "29")  # only US, not SA
        res = self._client(self.owner).post(CHECKOUT, {"plan": "starter"}, format="json")
        self.assertEqual(res.status_code, 400)

    @patch("payments.views.stripe_gateway.create_checkout_session")
    def test_no_plan_falls_back_to_default_price(self, mock_create):
        mock_create.return_value = {"url": "https://checkout.test/x"}
        with self.settings(STRIPE_PRICE_ID="price_default"):
            res = self._client(self.owner).post(CHECKOUT, {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(mock_create.call_args.kwargs["price_id"], "price_default")

    def test_manager_cannot_checkout(self):
        mgr = User.objects.create(email="m@pk.com", role="manager",
                                  organisation=self.org, is_active=True)
        res = self._client(mgr).post(CHECKOUT, {"plan": "pro"}, format="json")
        self.assertIn(res.status_code, (401, 403))
