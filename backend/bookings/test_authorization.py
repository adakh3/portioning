"""Authorization regression tests.

Verifies that org *configuration* endpoints (equipment catalog, labor roles,
allocation rules) are readable by operational users but writable only by admins,
and that bulk lead actions can't be abused by a salesperson to touch leads they
don't own or to reassign / delete in bulk.
"""

from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Lead
from bookings.tests import _make_org
from users.models import User


class ConfigEndpointAuthorizationTests(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.owner = User.objects.create(
            email="owner@authz.test", first_name="Own", last_name="Er",
            role="owner", organisation=self.org,
        )
        self.rep = User.objects.create(
            email="rep@authz.test", first_name="Rep", last_name="Sales",
            role="salesperson", organisation=self.org,
        )
        self.client = APIClient()

    # Each tuple: (url, a minimally-valid-ish POST body)
    CONFIG_WRITE_ENDPOINTS = [
        ("/api/equipment/items/", {"name": "Chafing dish", "quantity": 5}),
        ("/api/staff/labor-roles/", {"name": "Server", "hourly_rate": "15.00"}),
        ("/api/staff/allocation-rules/", {}),
    ]

    def test_salesperson_can_read_config_catalogs(self):
        self.client.force_authenticate(user=self.rep)
        for url, _ in self.CONFIG_WRITE_ENDPOINTS:
            res = self.client.get(url)
            self.assertEqual(res.status_code, 200, f"{url} read should be allowed: {res.content}")

    def test_salesperson_cannot_write_config_catalogs(self):
        self.client.force_authenticate(user=self.rep)
        for url, body in self.CONFIG_WRITE_ENDPOINTS:
            res = self.client.post(url, body, format="json")
            self.assertEqual(res.status_code, 403, f"{url} write should be forbidden, got {res.status_code}")

    def test_owner_is_not_forbidden_from_writing_config(self):
        self.client.force_authenticate(user=self.owner)
        for url, body in self.CONFIG_WRITE_ENDPOINTS:
            res = self.client.post(url, body, format="json")
            # Owner may hit validation (400) but must never be forbidden (403).
            self.assertNotEqual(res.status_code, 403, f"{url} owner write was forbidden")


class LeadBulkAuthorizationTests(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.rep = User.objects.create(
            email="rep2@authz.test", first_name="Rep", last_name="Two",
            role="salesperson", organisation=self.org,
        )
        self.other = User.objects.create(
            email="other@authz.test", first_name="Other", last_name="Rep",
            role="salesperson", organisation=self.org,
        )
        self.my_lead = Lead.objects.create(
            organisation=self.org, contact_name="Mine", assigned_to=self.rep, status="new",
        )
        self.their_lead = Lead.objects.create(
            organisation=self.org, contact_name="Theirs", assigned_to=self.other, status="new",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.rep)

    URL = "/api/bookings/leads/bulk/"

    def test_salesperson_cannot_bulk_delete(self):
        res = self.client.post(self.URL, {"ids": [self.my_lead.id], "action": "delete"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertTrue(Lead.objects.filter(id=self.my_lead.id).exists())

    def test_salesperson_cannot_bulk_reassign(self):
        res = self.client.post(
            self.URL,
            {"ids": [self.my_lead.id], "action": "assign", "value": self.other.id},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_salesperson_bulk_status_only_affects_their_own_leads(self):
        res = self.client.post(
            self.URL,
            {"ids": [self.my_lead.id, self.their_lead.id], "action": "status", "value": "contacted"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["updated"], 1)  # only their own lead counted
        self.my_lead.refresh_from_db()
        self.their_lead.refresh_from_db()
        self.assertEqual(self.my_lead.status, "contacted")
        self.assertEqual(self.their_lead.status, "new")  # untouched
