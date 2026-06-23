"""In-app management (Settings) of the simple org choice-option lists:
event types, sources, service styles, meal types, lost reasons."""
from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models.choices import (
    EventTypeOption, SourceOption, ServiceStyleOption, MealTypeOption, LostReasonOption,
)
from bookings.tests import _authenticated_client
from tests.base import get_test_user
from users.models import User

CASES = [
    ("event-types", EventTypeOption),
    ("sources", SourceOption),
    ("service-styles", ServiceStyleOption),
    ("meal-types", MealTypeOption),
    ("lost-reasons", LostReasonOption),
]


class TestChoiceOptionManagement(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = _authenticated_client()

    def test_create_generates_value_and_lists_for_each_type(self):
        for slug, model in CASES:
            base = f"/api/bookings/settings/{slug}/"
            res = self.client.post(base, {"label": "Garden Party", "sort_order": 9}, format="json")
            self.assertEqual(res.status_code, 201, f"{slug}: {res.content}")
            self.assertEqual(res.json()["value"], "garden_party", slug)
            self.assertTrue(model.objects.filter(organisation=self.org, value="garden_party").exists(), slug)
            # management list returns it
            names = [o["value"] for o in self.client.get(f"{base}?page_size=all").json()]
            self.assertIn("garden_party", names, slug)

    def test_rename_keeps_value_then_delete(self):
        base = "/api/bookings/settings/sources/"
        opt = SourceOption.objects.create(organisation=self.org, value="tiktok", label="TikTok")
        r = self.client.patch(f"{base}{opt.id}/", {"label": "TikTok Ads"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        opt.refresh_from_db()
        self.assertEqual(opt.value, "tiktok")          # value stable
        self.assertEqual(opt.label, "TikTok Ads")
        self.assertEqual(self.client.delete(f"{base}{opt.id}/").status_code, 204)
        self.assertFalse(SourceOption.objects.filter(pk=opt.pk).exists())

    def test_salesperson_cannot_manage(self):
        sp = User.objects.create(email="sp-choice@test.com", role="salesperson",
                                 organisation=self.org, is_active=True)
        client = APIClient()
        client.force_authenticate(sp)
        res = client.post("/api/bookings/settings/event-types/", {"label": "Nope"}, format="json")
        self.assertIn(res.status_code, (401, 403))
