"""Cross-org isolation tests.

Proves that a user in Org B cannot access Org A's resources via any API endpoint.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from users.models import Organisation, User
from bookings.models import Account, Contact, Venue, Lead, Quote
from bookings.models.choices import (
    EventTypeOption, LostReasonOption,
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

        # Choice options: event types (incl. "wedding") + workflow options are
        # auto-created for each org by the post_save signal; get_or_create keeps
        # this idempotent alongside that.
        EventTypeOption.objects.get_or_create(organisation=cls.org_a, value="wedding", defaults={"label": "Wedding"})
        LostReasonOption.objects.get_or_create(organisation=cls.org_a, value="budget", defaults={"label": "Budget"})
        EventTypeOption.objects.get_or_create(organisation=cls.org_b, value="wedding", defaults={"label": "Wedding"})

        # Org A data
        cls.account_a = Account.objects.create(
            organisation=cls.org_a, name="Org A Account", account_type="company",
        )
        cls.contact_a = Contact.objects.create(
            organisation=cls.org_a, account=cls.account_a, name="Contact A", email="contact@orga.com",
        )
        cls.venue_a = Venue.objects.create(
            organisation=cls.org_a, name="Org A Venue", city="London",
        )
        cls.lead_a = Lead.objects.create(
            organisation=cls.org_a, contact_name="Lead A", contact_email="lead@orga.com",
            event_type="wedding", status="new", account=cls.account_a,
        )
        cls.quote_a = Quote.objects.create(
            organisation=cls.org_a, account=cls.account_a, primary_contact=cls.contact_a,
            is_b2b=True, lead=cls.lead_a,
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
            organisation=cls.org_a, name="Event A", event_date=date.today() + timedelta(days=30),
            gents=50, ladies=50, account=cls.account_a, status="tentative",
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
        resp = self.client.get("/api/bookings/leads/?page_size=all")
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
        resp = self.client.get("/api/bookings/quotes/?page_size=all")
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


class TestAccountIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/bookings/accounts/?page_size=all")
        self.assertEqual(resp.status_code, 200)
        ids = [a["id"] for a in resp.data]
        self.assertNotIn(self.account_a.id, ids)

    def test_detail_404(self):
        resp = self.client.get(f"/api/bookings/accounts/{self.account_a.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_contacts_for_other_org_account_empty(self):
        resp = self.client.get(f"/api/bookings/accounts/{self.account_a.id}/contacts/?page_size=all")
        # Either 404 or empty list depending on implementation
        if resp.status_code == 200:
            self.assertEqual(len(resp.data), 0)


class TestEventIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/events/?page_size=all")
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
        resp = self.client.get("/api/bookings/venues/?page_size=all")
        self.assertEqual(resp.status_code, 200)
        ids = [v["id"] for v in resp.data]
        self.assertNotIn(self.venue_a.id, ids)

    def test_detail_404(self):
        resp = self.client.get(f"/api/bookings/venues/{self.venue_a.id}/")
        self.assertEqual(resp.status_code, 404)


class TestDishIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/dishes/?page_size=all")
        self.assertEqual(resp.status_code, 200)
        ids = [d["id"] for d in resp.data]
        self.assertNotIn(self.dish_a.id, ids)

    def test_categories_excludes_other_org(self):
        resp = self.client.get("/api/dishes/categories/?page_size=all")
        # May be 200 with empty list or 404 depending on view
        if resp.status_code == 200:
            ids = [c["id"] for c in resp.data]
            self.assertNotIn(self.cat_a.id, ids)


class TestMenuIsolation(OrgIsolationTestBase):
    def test_list_excludes_other_org(self):
        resp = self.client.get("/api/menus/?page_size=all")
        self.assertEqual(resp.status_code, 200)
        ids = [m["id"] for m in resp.data]
        self.assertNotIn(self.menu_a.id, ids)


class TestStaffIsolation(OrgIsolationTestBase):
    def test_roles_excludes_other_org(self):
        resp = self.client.get("/api/staff/labor-roles/?page_size=all")
        self.assertEqual(resp.status_code, 200)
        ids = [r["id"] for r in resp.data]
        self.assertNotIn(self.role_a.id, ids)

    def test_members_excludes_other_org(self):
        resp = self.client.get("/api/staff/members/?page_size=all")
        self.assertEqual(resp.status_code, 200)
        ids = [m["id"] for m in resp.data]
        self.assertNotIn(self.staff_a.id, ids)


class TestCrossOrgWriteIsolation(OrgIsolationTestBase):
    """Writes, not reads (REL-483).

    Every test above proves Org B cannot *read* Org A's rows. These prove it
    cannot *plant* one either: a writable FK that isn't org-scoped accepts any
    PK in the table, so Org B could attach its own row to an Org A parent and
    have it surface inside Org A's legitimately-scoped views.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.contact_b = Contact.objects.create(
            organisation=cls.org_b, name="Contact B", email="contact@orgb.com",
        )

    # ── Contact.account ──

    def test_create_contact_against_other_org_account_is_rejected(self):
        resp = self.client.post("/api/bookings/contacts/", {
            "first_name": "Mallory", "phone": "+15551234567",
            "account": self.account_a.id,
        }, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("account", resp.data)
        self.assertFalse(
            Contact.objects.filter(account=self.account_a, organisation=self.org_b).exists()
        )

    def test_patch_contact_onto_other_org_account_is_rejected(self):
        resp = self.client.patch(
            f"/api/bookings/contacts/{self.contact_b.id}/",
            {"account": self.account_a.id}, format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.contact_b.refresh_from_db()
        self.assertIsNone(self.contact_b.account_id)

    def test_injected_contact_does_not_appear_in_the_victims_account(self):
        """The payload the exploit in REL-483 used, checked from Org A's side."""
        self.client.post("/api/bookings/contacts/", {
            "first_name": "Mallory", "phone": "+15551234567",
            "account": self.account_a.id,
        }, format="json")

        victim = APIClient()
        victim.force_authenticate(user=self.user_a)
        resp = victim.get(f"/api/bookings/accounts/{self.account_a.id}/")
        self.assertEqual(resp.status_code, 200, resp.content)
        names = [c["name"] for c in resp.data["contacts"]]
        self.assertNotIn("Mallory", names)

    def test_model_layer_rejects_a_cross_org_account(self):
        """Backstop for the write paths DRF never sees (admin, shell, commands)."""
        with self.assertRaises(DjangoValidationError) as ctx:
            Contact.objects.create(
                organisation=self.org_b, name="Mallory", account=self.account_a,
            )
        self.assertIn("account", ctx.exception.message_dict)

    # ── StaffMember.roles (M2M) ──

    def test_create_staff_member_with_other_org_role_is_rejected(self):
        resp = self.client.post("/api/staff/members/", {
            "first_name": "Mallory", "roles": [self.role_a.id],
        }, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("roles", resp.data)

    def test_patch_staff_member_onto_other_org_role_is_rejected(self):
        member = StaffMember.objects.create(organisation=self.org_b, name="Staff B")
        resp = self.client.patch(
            f"/api/staff/members/{member.id}/",
            {"roles": [self.role_a.id]}, format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(member.roles.count(), 0)

    # ── BookingMeal.based_on_template / dishes, nested in a quote ──

    def _quote_payload(self, meal):
        return {
            "primary_contact": self.contact_b.id,
            "event_date": str(date.today() + timedelta(days=30)),
            "guest_count": 20, "price_per_head": "50.00", "tax_rate": "0",
            "additional_meals": [meal],
        }

    def test_meal_based_on_other_org_template_is_rejected(self):
        resp = self.client.post("/api/bookings/quotes/", self._quote_payload({
            "label": "Welcome drinks", "guest_count": 20,
            "based_on_template": self.menu_a.id,
        }), format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertFalse(Quote.objects.filter(organisation=self.org_b).exists())

    def test_meal_with_other_org_dish_is_rejected(self):
        """`dishes` is writable too, and was scoped only via its `dish_ids` twin."""
        resp = self.client.post("/api/bookings/quotes/", self._quote_payload({
            "label": "Welcome drinks", "guest_count": 20,
            "dishes": [self.dish_a.id],
        }), format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertFalse(Quote.objects.filter(organisation=self.org_b).exists())

    def test_own_org_meal_template_still_saves(self):
        """The scoping must narrow the queryset, not empty it."""
        menu_b = MenuTemplate.objects.create(organisation=self.org_b, name="Menu B")
        resp = self.client.post("/api/bookings/quotes/", self._quote_payload({
            "label": "Welcome drinks", "guest_count": 20,
            "based_on_template": menu_b.id,
        }), format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(
            resp.data["additional_meals"][0]["based_on_template"], menu_b.id,
        )


class TestEquipmentIsolation(OrgIsolationTestBase):
    def test_items_excludes_other_org(self):
        resp = self.client.get("/api/equipment/items/?page_size=all")
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
        resp = client.get("/api/bookings/leads/?page_size=all")
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

    def test_switch_org_all_is_rejected(self):
        """All-orgs mode is disabled — a superuser views one org at a time."""
        client = APIClient()
        client.force_authenticate(user=self.superuser)
        resp = client.post("/api/auth/switch-org/", {"org_id": "all"})
        self.assertEqual(resp.status_code, 400)

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
class TestSuperuserOrgSwitchRealFlow(OrgIsolationTestBase):
    """The PROD flow: JWT-cookie login (no Django session auth) → switch org →
    fetch data. OrgMiddleware runs BEFORE DRF authentication, so for app/API
    traffic it sees an anonymous user and never applies the session override —
    it must be resolved at the DRF layer (get_request_org). Regression for the
    prod bug where a switched superuser kept seeing their own org's data."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.superuser = User.objects.create_superuser(
            email="root@super.com", password="testpass123",
            first_name="Root", last_name="Super", organisation=cls.org_a,
        )
        cls.lead_b = Lead.objects.create(
            organisation=cls.org_b, contact_name="Org B Lead",
            contact_email="lead@orgb.com", event_type="wedding",
            event_date=date.today() + timedelta(days=30), guest_estimate=50,
        )

    def _login(self):
        client = APIClient()
        resp = client.post("/api/auth/login/", {
            "email": "root@super.com", "password": "testpass123",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        return client

    def _lead_ids(self, client):
        resp = client.get("/api/bookings/leads/?page_size=all")
        self.assertEqual(resp.status_code, 200, resp.content)
        return [l["id"] for l in resp.data]

    def test_switched_org_scopes_data_over_jwt(self):
        client = self._login()
        # Before switching: own org's data only.
        ids = self._lead_ids(client)
        self.assertIn(self.lead_a.id, ids)
        self.assertNotIn(self.lead_b.id, ids)
        # Switch to Org B.
        resp = client.post("/api/auth/switch-org/", {"org_id": self.org_b.id}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data["organisation"]["id"], self.org_b.id)
        # Follow-up data requests must be scoped to Org B (the bug returned Org A).
        ids = self._lead_ids(client)
        self.assertIn(self.lead_b.id, ids)
        self.assertNotIn(self.lead_a.id, ids)

    def test_me_reports_the_switched_org_over_jwt(self):
        client = self._login()
        client.post("/api/auth/switch-org/", {"org_id": self.org_b.id}, format="json")
        me = client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["organisation"]["id"], self.org_b.id)

    def test_clearing_the_switch_returns_to_own_org(self):
        client = self._login()
        client.post("/api/auth/switch-org/", {"org_id": self.org_b.id}, format="json")
        client.post("/api/auth/switch-org/", {}, format="json")
        ids = self._lead_ids(client)
        self.assertIn(self.lead_a.id, ids)
        self.assertNotIn(self.lead_b.id, ids)
