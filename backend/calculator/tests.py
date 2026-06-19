"""View-level tests for calculator/views.py.

The engine math is covered by tests/test_calculator.py et al.; these exercise
the *view plumbing* (auth, request validation, response shape) for each
endpoint in calculator/urls.py — the layer where the PriceEstimateView 400
(UnboundLocalError from a shadowed get_request_org import) slipped through
uncaught because no test ever POSTed to it.
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user


def _priced_dish_ids(n=4):
    """Active dishes from the seeded reference data, with selling prices."""
    from dishes.models import Dish
    return list(
        Dish.objects.filter(is_active=True, selling_price_per_gram__gt=0)
        .values_list("id", flat=True)[:n]
    )


class CalculatorViewTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=get_test_user())
        self.dish_ids = _priced_dish_ids()


class TestCalculateView(CalculatorViewTestBase):
    def test_requires_authentication(self):
        anon = APIClient()
        res = anon.post("/api/calculate/", {"dish_ids": self.dish_ids,
                                            "guests": {"gents": 50, "ladies": 50}}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_rejects_empty_dish_ids(self):
        res = self.client.post("/api/calculate/", {"dish_ids": [],
                                                   "guests": {"gents": 50, "ladies": 50}}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_happy_path_returns_portions_and_totals(self):
        res = self.client.post("/api/calculate/", {"dish_ids": self.dish_ids,
                                                   "guests": {"gents": 50, "ladies": 50}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertIn("portions", body)
        self.assertIn("totals", body)
        self.assertEqual(len(body["portions"]), len(self.dish_ids))


class TestCheckPortionsView(CalculatorViewTestBase):
    def test_requires_authentication(self):
        anon = APIClient()
        res = anon.post("/api/check-portions/", {}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_mismatched_user_portions_rejected(self):
        # user_portions must cover exactly the dish_ids (serializer.validate)
        res = self.client.post("/api/check-portions/", {
            "dish_ids": self.dish_ids,
            "guests": {"gents": 50, "ladies": 50},
            "user_portions": [{"dish_id": self.dish_ids[0], "grams_per_person": 100}],
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_happy_path_returns_comparison(self):
        res = self.client.post("/api/check-portions/", {
            "dish_ids": self.dish_ids,
            "guests": {"gents": 50, "ladies": 50},
            "user_portions": [{"dish_id": d, "grams_per_person": 120} for d in self.dish_ids],
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertIn("comparison", body)
        self.assertIn("violations", body)
        self.assertEqual(len(body["comparison"]), len(self.dish_ids))


class TestPriceEstimateView(CalculatorViewTestBase):
    def test_requires_authentication(self):
        anon = APIClient()
        res = anon.post("/api/price-estimate/", {"dish_ids": self.dish_ids,
                                                 "guest_count": 100}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_missing_fields_rejected(self):
        res = self.client.post("/api/price-estimate/", {"dish_ids": self.dish_ids}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_non_integer_inputs_rejected(self):
        res = self.client.post("/api/price-estimate/", {"dish_ids": ["abc"],
                                                        "guest_count": "many"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_happy_path_matches_engine_priced_estimate(self):
        # Regression guard for the UnboundLocalError 400: the real endpoint
        # (engine + DB, no mocks) must return 200, and its price must match the
        # engine portions priced at each dish's selling rate with the org's
        # rounding step applied. Reconstructing the expected value keeps the
        # assertion independent of which seed dishes get picked.
        from dishes.models import Dish
        from calculator.engine.calculator import calculate_portions
        from bookings.models import OrgSettings
        from tests.base import get_test_org

        org = get_test_org()
        guests = {"gents": 50, "ladies": 50}  # 100 split 50/50 by the view
        result = calculate_portions(self.dish_ids, guests, org=org)
        spg = {d.id: float(d.selling_price_per_gram)
               for d in Dish.objects.filter(id__in=self.dish_ids, organisation=org)}
        expected = sum(p["grams_per_person"] * spg.get(p["dish_id"], 0)
                       for p in result["portions"])
        step = OrgSettings.for_org(org).price_rounding_step
        if step > 1:
            expected = round(expected / step) * step
        expected = round(expected, 2)

        res = self.client.post("/api/price-estimate/", {"dish_ids": self.dish_ids,
                                                        "guest_count": 100}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertIn("price_per_head", body)
        self.assertIn("has_unpriced", body)
        self.assertAlmostEqual(body["price_per_head"], expected, places=2)
        self.assertFalse(body["has_unpriced"])  # all picked dishes are priced


class TestExportPDFView(CalculatorViewTestBase):
    def test_requires_authentication(self):
        anon = APIClient()
        res = anon.post("/api/export-pdf/", {"dish_ids": self.dish_ids,
                                             "guests": {"gents": 50, "ladies": 50}}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_rejects_empty_dish_ids(self):
        res = self.client.post("/api/export-pdf/", {"dish_ids": [],
                                                    "guests": {"gents": 50, "ladies": 50}}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_happy_path_returns_pdf(self):
        res = self.client.post("/api/export-pdf/", {
            "dish_ids": self.dish_ids,
            "guests": {"gents": 50, "ladies": 50},
            "menu_name": "Test Menu",
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res["Content-Type"], "application/pdf")
        self.assertTrue(res.content.startswith(b"%PDF"))
