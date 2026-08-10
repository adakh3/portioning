"""Tests for the public Book-a-Demo endpoint (REL-482, AC8–AC11)."""
import json

from django.core.cache import cache
from django.test import TestCase

from .models import DemoRequest
from .views import DEMO_HONEYPOT_FIELD

URL = "/api/demo-requests/"


class DemoRequestEndpointTests(TestCase):
    def setUp(self):
        # Throttle counters live in the cache and survive across tests in the
        # same process — clear them so each test starts with a fresh budget.
        cache.clear()

    def post(self, payload, **extra):
        return self.client.post(URL, payload, content_type="application/json", **extra)

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

    def test_overlong_name_rejected(self):
        resp = self.post({"name": "A" * 201, "email": "jane@kitchen.com"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(DemoRequest.objects.count(), 0)

    def test_non_dict_body_is_a_400_not_a_500(self):
        """A bare JSON list must not reach the honeypot lookup and crash it."""
        resp = self.post([1, 2, 3])
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(DemoRequest.objects.count(), 0)

    def test_honeypot_saves_nothing(self):
        resp = self.post({
            "name": "Bot Botson", "email": "bot@spam.com",
            "events_per_month": "999", DEMO_HONEYPOT_FIELD: "http://spam.example",
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(DemoRequest.objects.count(), 0)

    def test_honeypot_response_is_indistinguishable_from_a_real_one(self):
        """The trapped response must match a genuine one byte for byte.

        Two failure modes ride on this. A bot that can tell the difference just
        stops filling the field; and a human whose password manager filled it
        gets whatever the client does with the body — an empty one made the
        modal show "Something went wrong" for a lead we had silently dropped.
        """
        payload = {"name": "Jane Doe", "email": "jane@kitchen.com", "events_per_month": "12"}
        trapped = self.post({**payload, DEMO_HONEYPOT_FIELD: "http://spam.example"})
        genuine = self.post(payload)

        self.assertEqual(trapped.status_code, genuine.status_code)
        self.assertEqual(trapped["Content-Type"], genuine["Content-Type"])
        self.assertEqual(json.loads(trapped.content), json.loads(genuine.content))
        # …and only the genuine one actually left a row behind.
        self.assertEqual(DemoRequest.objects.count(), 1)

    def test_get_not_allowed(self):
        self.assertEqual(self.client.get(URL).status_code, 405)

    def test_throttled_after_ten_requests(self):
        for i in range(10):
            resp = self.post({"name": f"Guest {i}", "email": f"g{i}@kitchen.com"})
            self.assertEqual(resp.status_code, 201)
        resp = self.post({"name": "One Too Many", "email": "extra@kitchen.com"})
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(DemoRequest.objects.count(), 10)

    def test_throttle_ignores_a_spoofed_forwarded_for_prefix(self):
        """The limit must key on the IP our proxy appended, not the client's text.

        Behind one trusted proxy the header reads "<whatever the caller sent>,
        <real client ip>". Keying on the whole header — DRF's default when
        NUM_PROXIES is unset — lets a spammer mint a fresh bucket per request
        by varying the prefix, so the limit may as well not be there.
        """
        real_ip = "203.0.113.9"
        for i in range(10):
            resp = self.post(
                {"name": f"Guest {i}", "email": f"g{i}@kitchen.com"},
                HTTP_X_FORWARDED_FOR=f"10.0.0.{i}, {real_ip}",
            )
            self.assertEqual(resp.status_code, 201)

        resp = self.post(
            {"name": "Spoofer", "email": "spoof@kitchen.com"},
            HTTP_X_FORWARDED_FOR=f"10.0.0.99, {real_ip}",
        )
        self.assertEqual(resp.status_code, 429)

        # A genuinely different client still gets its own budget.
        resp = self.post(
            {"name": "Someone Else", "email": "else@kitchen.com"},
            HTTP_X_FORWARDED_FOR="10.0.0.1, 198.51.100.4",
        )
        self.assertEqual(resp.status_code, 201)
