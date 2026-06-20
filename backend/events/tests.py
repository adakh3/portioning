from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user


class TestEventListSerialization(TestCase):
    """Guards /api/events/ against serializer-config 500s.

    The pre-existing test_api.test_list_events only hit an EMPTY list, so the
    EventListSerializer's child fields were never bound — masking an
    ImproperlyConfigured error (a field in Meta.fields with no declaration).
    Listing at least one real event binds the fields and exercises the path
    that actually 500'd in production.
    """

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=get_test_user())

    def _create_event(self):
        from dishes.models import Dish
        dish_ids = list(Dish.objects.filter(is_active=True).values_list("id", flat=True)[:3])
        res = self.client.post("/api/events/", {
            "name": "Serialize Me", "date": "2026-03-15",
            "gents": 50, "ladies": 50, "dish_ids": dish_ids,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)

    def test_list_serializes_a_real_event(self):
        self._create_event()
        res = self.client.get("/api/events/")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertTrue(rows, "expected at least one event in the list")
        # product_name is the field that was in Meta.fields but undeclared.
        self.assertIn("product_name", rows[0])
