"""Org-customizable lead statuses: seeding, management API, dynamic kanban,
and the flag-driven won/lost semantics."""
from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Lead
from bookings.models.choices import LeadStatusOption
from bookings.tests import _authenticated_client
from tests.base import get_test_user
from users.models import User

MANAGE = "/api/bookings/settings/lead-statuses/"


class TestLeadStatusSeeding(TestCase):
    def test_new_org_seeded_with_colours_and_flags(self):
        org = get_test_user().organisation
        opts = {o.value: o for o in LeadStatusOption.objects.filter(organisation=org)}
        self.assertTrue(opts["new"].is_default)
        self.assertTrue(opts["won"].is_won)
        self.assertTrue(opts["lost"].is_lost)
        self.assertEqual(opts["won"].color, "green")
        self.assertEqual(opts["new"].color, "blue")


class TestLeadStatusManagementAPI(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = _authenticated_client()

    def test_create_generates_stable_value_from_label(self):
        res = self.client.post(MANAGE, {"label": "Site Visit", "color": "teal", "sort_order": 10}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["value"], "site_visit")
        self.assertTrue(LeadStatusOption.objects.filter(organisation=self.org, value="site_visit").exists())

    def test_create_dedupes_value(self):
        self.client.post(MANAGE, {"label": "Won"}, format="json")  # collides with seeded 'won'
        opt = LeadStatusOption.objects.filter(organisation=self.org, label="Won").latest("id")
        self.assertEqual(opt.value, "won_2")

    def test_rename_keeps_value_stable(self):
        opt = LeadStatusOption.objects.get(organisation=self.org, value="contacted")
        res = self.client.patch(f"{MANAGE}{opt.id}/", {"label": "Reached Out"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        opt.refresh_from_db()
        self.assertEqual(opt.value, "contacted")
        self.assertEqual(opt.label, "Reached Out")

    def test_setting_default_clears_previous_default(self):
        contacted = LeadStatusOption.objects.get(organisation=self.org, value="contacted")
        self.client.patch(f"{MANAGE}{contacted.id}/", {"is_default": True}, format="json")
        defaults = list(
            LeadStatusOption.objects.filter(organisation=self.org, is_default=True).values_list("value", flat=True)
        )
        self.assertEqual(defaults, ["contacted"])

    def test_cannot_delete_status_in_use(self):
        Lead.objects.create(organisation=self.org, contact_name="X", status="contacted")
        opt = LeadStatusOption.objects.get(organisation=self.org, value="contacted")
        res = self.client.delete(f"{MANAGE}{opt.id}/")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(LeadStatusOption.objects.filter(pk=opt.pk).exists())

    def test_cannot_delete_default(self):
        opt = LeadStatusOption.objects.get(organisation=self.org, value="new")
        res = self.client.delete(f"{MANAGE}{opt.id}/")
        self.assertEqual(res.status_code, 400)

    def test_can_delete_unused_non_default(self):
        opt = LeadStatusOption.objects.create(organisation=self.org, value="temp", label="Temp")
        res = self.client.delete(f"{MANAGE}{opt.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(LeadStatusOption.objects.filter(pk=opt.pk).exists())

    def test_salesperson_cannot_manage(self):
        sp = User.objects.create(email="sp@test.com", role="salesperson", organisation=self.org, is_active=True)
        client = APIClient()
        client.force_authenticate(sp)
        res = client.post(MANAGE, {"label": "Nope"}, format="json")
        self.assertIn(res.status_code, (403, 401))


class TestDynamicKanban(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        self.client = _authenticated_client()

    def test_columns_follow_org_options_including_custom(self):
        LeadStatusOption.objects.create(
            organisation=self.org, value="site_visit", label="Site Visit", sort_order=10,
        )
        res = self.client.get("/api/bookings/leads/kanban/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("site_visit", data["columns"])
        self.assertIn("site_visit", data["order"])
        # sort_order respected: seeded 'new' (0) before the custom status (10)
        self.assertLess(data["order"].index("new"), data["order"].index("site_visit"))

    def test_inactive_status_with_leads_still_shown(self):
        opt = LeadStatusOption.objects.get(organisation=self.org, value="qualified")
        Lead.objects.create(organisation=self.org, contact_name="Q", status="qualified")
        opt.is_active = False
        opt.save(update_fields=["is_active"])
        data = self.client.get("/api/bookings/leads/kanban/").json()
        self.assertIn("qualified", data["columns"])  # appended so its lead isn't hidden


class TestFlagDrivenSemantics(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        self.client = _authenticated_client()

    def test_custom_won_status_stamps_won_at(self):
        res = self.client.post(MANAGE, {"label": "Closed Won", "is_won": True}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        # the previous 'won' lost its flag (single won per org)
        self.assertFalse(LeadStatusOption.objects.get(organisation=self.org, value="won").is_won)
        lead = Lead.objects.create(organisation=self.org, contact_name="Z", status="new")
        lead.transition_to("closed_won")
        lead.refresh_from_db()
        self.assertIsNotNone(lead.won_at)

    def test_lost_requires_reason_via_flag(self):
        lead = Lead.objects.create(organisation=self.org, contact_name="L", status="new")
        res = self.client.post(f"/api/bookings/leads/{lead.id}/transition/", {"status": "lost"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("lost_reason_option", str(res.json()))
