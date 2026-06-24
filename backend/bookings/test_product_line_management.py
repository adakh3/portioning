"""In-app management (Settings) of product lines: create / rename / delete."""
from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Lead, ProductLine
from bookings.tests import _authenticated_client
from tests.base import get_test_user
from users.models import User

BASE = "/api/bookings/settings/product-lines/"


class TestProductLineManagement(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = _authenticated_client()

    def test_create_and_list(self):
        res = self.client.post(BASE, {"name": "Weddings", "colour": "#3B82F6"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(ProductLine.objects.filter(organisation=self.org, name="Weddings").exists())
        names = [p["name"] for p in self.client.get(f"{BASE}?page_size=all").json()]
        self.assertIn("Weddings", names)

    def test_rename_and_recolour(self):
        pl = ProductLine.objects.create(organisation=self.org, name="Corp")
        r = self.client.patch(f"{BASE}{pl.id}/", {"name": "Corporate", "colour": "#10B981"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        pl.refresh_from_db()
        self.assertEqual(pl.name, "Corporate")
        self.assertEqual(pl.colour, "#10B981")

    def test_delete_blocked_when_in_use(self):
        pl = ProductLine.objects.create(organisation=self.org, name="InUse")
        Lead.objects.create(organisation=self.org, contact_name="X", product=pl)
        res = self.client.delete(f"{BASE}{pl.id}/")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(ProductLine.objects.filter(pk=pl.pk).exists())

    def test_delete_unused(self):
        pl = ProductLine.objects.create(organisation=self.org, name="Temp")
        self.assertEqual(self.client.delete(f"{BASE}{pl.id}/").status_code, 204)

    def test_salesperson_cannot_manage(self):
        sp = User.objects.create(email="sp-pl@test.com", role="salesperson", organisation=self.org, is_active=True)
        client = APIClient()
        client.force_authenticate(sp)
        self.assertIn(client.post(BASE, {"name": "Nope"}, format="json").status_code, (401, 403))
