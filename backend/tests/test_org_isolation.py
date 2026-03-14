"""Cross-org isolation tests.

Proves that a user in Org B cannot access Org A's resources via any API endpoint.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from users.models import Organisation, User
from bookings.models import Customer, Venue, Lead, Quote
from bookings.models.choices import (
    EventTypeOption, SourceOption, ServiceStyleOption,
    LeadStatusOption, LostReasonOption,
)
from bookings.models.settings import OrgSettings
from events.models import Event
from dishes.models import DishCategory, Dish
from menus.models import MenuTemplate
from staff.models import LaborRole, StaffMember
from equipment.models import EquipmentItem
from rules.models import GlobalConfig, GlobalConstraint


@override_settings(
    LOGGING={},  # Suppress tenant.security warnings during tests
)
class OrgIsolationTestBase(TestCase):
    """Base class: creates Org A (with data) and Org B (user trying to access Org A's data)."""

    @classmethod
    def setUpTestData(cls):
        # Org A — the "victim" org
        cls.org_a = Organisation.objects.create(name="Org A", slug="org-a", country="GB")
        cls.user_a = User.objects.create_user(
            email="alice@orga.com", password="testpass123",
            first_name="Alice", last_name="A", role="owner", organisation=cls.org_a,
        )

        # Org B — the "attacker" org
        cls.org_b = Organisation.objects.create(name="Org B", slug="org-b", country="US")
        cls.user_b = User.objects.create_user(
            email="bob@orgb.com", password="testpass123",
            first_name="Bob", last_name="B", role="owner", organisation=cls.org_b,
        )

        # Seed choice options for Org A
        LeadStatusOption.objects.create(organisation=cls.org_a, value="new", label="New", sort_order=0)
        LeadStatusOption.objects.create(organisation=cls.org_a, value="contacted", label="Contacted", sort_order=1)
        LeadStatusOption.objects.create(organisation=cls.org_a, value="won", label="Won", sort_order=5)
        LeadStatusOption.objects.create(organisation=cls.org_a, value="lost", label="Lost", sort_order=6)
        EventTypeOption.objects.create(organisation=cls.org_a, value="wedding", label="Wedding")
        LostReasonOption.objects.create(organisation=cls.org_a, value="budget", label="Budget")

        # Seed choice options for Org B too
        LeadStatusOption.objects.create(organisation=cls.org_b, value="new", label="New", sort_order=0)
        EventTypeOption.objects.create(organisation=cls.org_b, value="wedding", label="Wedding")

        # Org A data
        cls.customer_a = Customer.objects.create(
            organisation=cls.org_a, name="Jane Doe", customer_type="consumer",
            email="jane@orga.com",
        )
        cls.venue_a = Venue.objects.create(
            organisation=cls.org_a, name="Org A Venue", city="London",
        )
        cls.lead_a = Lead.objects.create(
            organisation=cls.org_a, customer=cls.customer_a,
            event_type="wedding", status="new",
        )
        cls.quote_a = Quote.objects.create(
            organisation=cls.org_a, customer=cls.customer_a, lead=cls.lead_a,
            event_date=date.today() + timedelta(days=30), guest_count=100,
        )

        # Dishes & menus for Org A
        cls.cat_a = DishCategory.objects.create(
            organisation=cls.org_a, name="protein-a", display_name="Protein A",
            pool="protein", baseline_budget_grams=200,
        )
        cls.dish_a = Dish.objects.create(
            organisation=cls.org_a, name="Dish A", category=cls.cat_a,
            default_portion_grams=150, is_active=True,
        )
        cls.menu_a = MenuTemplate.objects.create(
            organisation=cls.org_a, name="Menu A",
        )

        # Staff & equipment for Org A
        cls.role_a = LaborRole.objects.create(
            organisation=cls.org_a, name="Chef A", default_hourly_rate=Decimal("15.00"),
        )
        cls.staff_a = StaffMember.objects.create(
            organisation=cls.org_a, name="Staff A",
        )
        cls.equip_a = EquipmentItem.objects.create(
            organisation=cls.org_a, name="Chafing Dish A", stock_quantity=10,
        )

        # Event for Org A
        cls.event_a = Event.objects.create(
            organisation=cls.org_a, name="Event A", date=date.today() + timedelta(days=30),
            gents=50, ladies=50, customer=cls.customer_a, status="tentative",
        )

        # Rules for Org A
        cls.config_a = GlobalConfig.objects.create(organisation=cls.org_a)
        cls.constraint_a = GlobalConstraint.objects.create(organisation=cls.org_a)

    def setUp(self):
        """Authenticate as Org B user (the attacker)."""
        self.client = APIClient()
        self.client.force_authenticate(user=self.user_b)


class TestLeadIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/bookings/leads/")
        self.assertEqual(resp.status_code, 200)
        ids = [l["id"] for l in resp.data]
        self.assertNotIn(self.lead_a.id, ids)

    def test_detail_404(self):
        resp = self.client.get(f"/api/bookings/leads/{self.lead_a.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_transition_404(self):
        resp = self.client.post(
            f"/api/bookings/leads/{self.lead_a.id}/transition/",
            {"status": "contacted"},
        )
        self.assertEqual(resp.status_code, 404)

    def test_create_quote_404(self):
        resp = self.client.post(f"/api/bookings/leads/{self.lead_a.id}/create-quote/")
        self.assertEqual(resp.status_code, 404)

    def test_activity_404(self):
        resp = self.client.get(f"/api/bookings/leads/{self.lead_a.id}/activity/")
        self.assertEqual(resp.status_code, 404)


class TestQuoteIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/bookings/quotes/")
        self.assertEqual(resp.status_code, 200)
        ids = [q["id"] for q in resp.data]
        self.assertNotIn(self.quote_a.id, ids)

    def test_detail_404(self):
        resp = self.client.get(f"/api/bookings/quotes/{self.quote_a.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_transition_404(self):
        resp = self.client.post(
            f"/api/bookings/quotes/{self.quote_a.id}/transition/",
            {"status": "sent"},
        )
        self.assertEqual(resp.status_code, 404)

    def test_line_items_404(self):
        resp = self.client.get(f"/api/bookings/quotes/{self.quote_a.id}/line-items/")
        self.assertEqual(resp.status_code, 404)

    def test_pdf_404(self):
        resp = self.client.get(f"/api/bookings/quotes/{self.quote_a.id}/pdf/")
        self.assertEqual(resp.status_code, 404)


class TestCustomerIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/bookings/customers/")
        self.assertEqual(resp.status_code, 200)
        ids = [a["id"] for a in resp.data]
        self.assertNotIn(self.customer_a.id, ids)

    def test_detail_404(self):
        resp = self.client.get(f"/api/bookings/customers/{self.customer_a.id}/")
        self.assertEqual(resp.status_code, 404)


class TestEventIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/events/")
        self.assertEqual(resp.status_code, 200)
        ids = [e["id"] for e in resp.data]
        self.assertNotIn(self.event_a.id, ids)

    def test_detail_404(self):
        resp = self.client.get(f"/api/events/{self.event_a.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_calculate_404(self):
        resp = self.client.post(f"/api/events/{self.event_a.id}/calculate/")
        self.assertEqual(resp.status_code, 404)


class TestVenueIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/bookings/venues/")
        self.assertEqual(resp.status_code, 200)
        ids = [v["id"] for v in resp.data]
        self.assertNotIn(self.venue_a.id, ids)

    def test_detail_404(self):
        resp = self.client.get(f"/api/bookings/venues/{self.venue_a.id}/")
        self.assertEqual(resp.status_code, 404)


class TestDishIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/dishes/")
        self.assertEqual(resp.status_code, 200)
        ids = [d["id"] for d in resp.data]
        self.assertNotIn(self.dish_a.id, ids)

    def test_categories_excludes_other_org(self):
        resp = self.client.get("/api/dishes/categories/")
        # May be 200 with empty list or 404 depending on view
        if resp.status_code == 200:
            ids = [c["id"] for c in resp.data]
            self.assertNotIn(self.cat_a.id, ids)


class TestMenuIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/menus/")
        self.assertEqual(resp.status_code, 200)
        ids = [m["id"] for m in resp.data]
        self.assertNotIn(self.menu_a.id, ids)


class TestStaffIsolation(OrgIsolationTestBase):
    def test_roles_excludes_other_org(self):
        resp = self.client.get("/api/staff/labor-roles/")
        self.assertEqual(resp.status_code, 200)
        ids = [r["id"] for r in resp.data]
        self.assertNotIn(self.role_a.id, ids)

    def test_members_excludes_other_org(self):
        resp = self.client.get("/api/staff/members/")
        self.assertEqual(resp.status_code, 200)
        ids = [m["id"] for m in resp.data]
        self.assertNotIn(self.staff_a.id, ids)


class TestEquipmentIsolation(OrgIsolationTestBase):
    def test_items_excludes_other_org(self):
        resp = self.client.get("/api/equipment/items/")
        self.assertEqual(resp.status_code, 200)
        ids = [e["id"] for e in resp.data]
        self.assertNotIn(self.equip_a.id, ids)


class TestDashboardIsolation(OrgIsolationTestBase):
    def test_stats_excludes_other_org(self):
        resp = self.client.get("/api/bookings/dashboard/stats/")
        self.assertEqual(resp.status_code, 200)
        # Org B has no leads, so counts should all be 0
        data = resp.data
        self.assertEqual(data.get("total_leads", 0), 0)


class TestSuperuserOrgSwitch(OrgIsolationTestBase):
    """Test superuser org switching.

    Note: force_authenticate() bypasses middleware, so session-based switching
    cannot be tested via the API with force_authenticate. Instead we test:
    1. Default behavior (force_authenticate falls back to user.organisation)
    2. The SwitchOrgView API itself
    3. The MeView response for the all_orgs flag
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.superuser = User.objects.create_superuser(
            email="admin@super.com", password="testpass123",
            first_name="Admin", last_name="Super", organisation=cls.org_a,
        )

    def test_superuser_defaults_to_own_org(self):
        """Superuser without explicit override sees only their own org's data."""
        client = APIClient()
        client.force_authenticate(user=self.superuser)
        resp = client.get("/api/bookings/leads/")
        self.assertEqual(resp.status_code, 200)
        # force_authenticate fallback uses user.organisation = org_a
        ids = [l["id"] for l in resp.data]
        self.assertIn(self.lead_a.id, ids)

    def test_switch_org_requires_superuser(self):
        """Non-superuser gets 403 on switch-org."""
        client = APIClient()
        client.force_authenticate(user=self.user_b)
        resp = client.post("/api/auth/switch-org/", {"org_id": self.org_a.id})
        self.assertEqual(resp.status_code, 403)

    def test_switch_org_invalid_org_404(self):
        """Switching to nonexistent org returns 404."""
        client = APIClient()
        client.force_authenticate(user=self.superuser)
        resp = client.post("/api/auth/switch-org/", {"org_id": 99999})
        self.assertEqual(resp.status_code, 404)

    def test_switch_org_all_returns_all_orgs_flag(self):
        """Switching to 'all' sets the all_orgs flag in response."""
        client = APIClient()
        client.force_authenticate(user=self.superuser)
        resp = client.post("/api/auth/switch-org/", {"org_id": "all"})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data.get("all_orgs", False))

    def test_switch_org_to_specific_org(self):
        """Switching to a specific org returns that org in response."""
        client = APIClient()
        client.force_authenticate(user=self.superuser)
        resp = client.post("/api/auth/switch-org/", {"org_id": self.org_b.id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["organisation"]["id"], self.org_b.id)
        self.assertFalse(resp.data.get("all_orgs", False))

    def test_switch_org_clear_returns_own_org(self):
        """Clearing override returns superuser's own org."""
        client = APIClient()
        client.force_authenticate(user=self.superuser)
        resp = client.post("/api/auth/switch-org/", {})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["organisation"]["id"], self.org_a.id)
        self.assertFalse(resp.data.get("all_orgs", False))
