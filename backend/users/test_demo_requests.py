"""Tests for the public Book-a-Demo endpoint (REL-482, AC8–AC11)."""
from django.core.cache import cache
from django.test import TestCase

from .models import DemoRequest

URL = "/api/demo-requests/"


class DemoRequestEndpointTests(TestCase):
    def setUp(self):
        # Throttle counters live in the cache and survive across tests in the
        # same process — clear them so each test starts with a fresh budget.
        cache.clear()

    def post(self, payload):
        return self.client.post(URL, payload, content_type="application/json")

    def test_valid_request_is_saved(self):
        resp = self.post({"name": "Jane Doe", "email": "jane@kitchen.com", "events_per_month": "12"})
        self.assertEqual(resp.status_code, 201)
        req = DemoRequest.objects.get()
        self.assertEqual(req.name, "Jane Doe")
        self.assertEqual(req.email, "jane@kitchen.com")
        self.assertEqual(req.events_per_month, "12")

    def test_events_per_month_is_optional(self):
        resp = self.post({"name": "Jane Doe", "email": "jane@kitchen.com"})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(DemoRequest.objects.get().events_per_month, "")

    def test_missing_name_rejected(self):
        resp = self.post({"email": "jane@kitchen.com"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(DemoRequest.objects.count(), 0)

    def test_invalid_email_rejected(self):
        resp = self.post({"name": "Jane Doe", "email": "not-an-email"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(DemoRequest.objects.count(), 0)

    def test_honeypot_pretends_success_but_saves_nothing(self):
        resp = self.post({
            "name": "Bot Botson", "email": "bot@spam.com",
            "events_per_month": "999", "website": "http://spam.example",
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(DemoRequest.objects.count(), 0)

    def test_get_not_allowed(self):
        self.assertEqual(self.client.get(URL).status_code, 405)

    def test_throttled_after_ten_requests(self):
        for i in range(10):
            resp = self.post({"name": f"Guest {i}", "email": f"g{i}@kitchen.com"})
            self.assertEqual(resp.status_code, 201)
        resp = self.post({"name": "One Too Many", "email": "extra@kitchen.com"})
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(DemoRequest.objects.count(), 10)
