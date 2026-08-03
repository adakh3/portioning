"""The seed_demo command must produce a deterministic, idempotent demo dataset so
every worktree / clone tests against the same accounts and commission data."""
from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from bookings.models import SalesTarget, RepCommissionPlan, Lead, OrgSettings
from events.models import Event
from users.models import Organisation, User


class SeedDemoTests(TestCase):
    def _run(self):
        call_command("seed_demo", stdout=StringIO())

    def test_seeds_org_users_and_commission_data(self):
        self._run()
        org = Organisation.objects.get(name="Demo Co")

        # Five known logins, all usable.
        self.assertEqual(User.objects.filter(organisation=org).count(), 5)
        rep = User.objects.get(email="rep@demo.test")
        self.assertEqual(rep.role, "salesperson")
        self.assertTrue(rep.check_password("Sales123!"))

        # Monthly targets for the whole financial year, per rep (2 reps x 12).
        self.assertEqual(SalesTarget.objects.filter(organisation=org).count(), 24)
        self.assertTrue(RepCommissionPlan.objects.filter(organisation=org, user=rep).exists())

        # A confirmed event per rep so the dashboard shows real attainment.
        self.assertEqual(Event.objects.filter(organisation=org, status="confirmed").count(), 2)
        self.assertTrue(Lead.objects.filter(organisation=org).exists())

    def test_is_idempotent(self):
        self._run()
        self._run()  # second run must not duplicate transactional rows or change counts
        org = Organisation.objects.get(name="Demo Co")
        self.assertEqual(Organisation.objects.filter(name="Demo Co").count(), 1)
        self.assertEqual(User.objects.filter(organisation=org).count(), 5)
        self.assertEqual(Event.objects.filter(organisation=org, name__startswith="[demo]").count(), 2)
        self.assertEqual(Lead.objects.filter(organisation=org, notes__startswith="[demo]").count(), 10)
        self.assertEqual(SalesTarget.objects.filter(organisation=org).count(), 24)

    def test_a_second_org_gets_its_own_logins_instead_of_stealing_them(self):
        # A User's email is unique account-wide, so seeding a second org used to
        # re-home owner@demo.test onto it and orphan the first — you could only ever
        # be inside whichever org was seeded last, which makes a two-org demo useless.
        self._run()
        call_command("seed_demo", org="Grand Buffet Caterers", profile="buffet", stdout=StringIO())

        demo = Organisation.objects.get(name="Demo Co")
        buffet = Organisation.objects.get(name="Grand Buffet Caterers")
        self.assertEqual(User.objects.get(email="owner@demo.test").organisation, demo)
        self.assertEqual(
            User.objects.get(email="owner@grand-buffet-caterers.test").organisation, buffet,
        )
        # Both orgs stay fully staffed and independently usable.
        self.assertEqual(User.objects.filter(organisation=demo).count(), 5)
        self.assertEqual(User.objects.filter(organisation=buffet).count(), 5)

    # The buffet menus are built from the org's dish catalogue, which the
    # org-creation signal seeds in dev/prod but not under the test runner.
    @override_settings(SEED_STARTER_CATALOG_ON_ORG_CREATE=True)
    def test_buffet_profile_seeds_a_flat_menu_and_a_stations_menu(self):
        # A caterer who never plates has two menu shapes a plated demo never produces:
        # a long list with no courses, and the same food broken into stations. Both
        # are buffet, so neither may carry a guest choice.
        call_command("seed_demo", org="Grand Buffet Caterers", profile="buffet", stdout=StringIO())
        org = Organisation.objects.get(name="Grand Buffet Caterers")

        flat = Event.objects.get(organisation=org, name__endswith="Corporate lunch buffet")
        self.assertEqual(flat.service_style, "buffet")
        self.assertEqual(flat.courses.count(), 0)
        self.assertGreater(flat.dishes.count(), 0)
        # Without a customer the event form refuses to save, so these demo menus
        # would be look-but-don't-touch.
        self.assertIsNotNone(flat.primary_contact)

        stations = Event.objects.get(organisation=org, name__endswith="stations")
        self.assertEqual(stations.service_style, "buffet")
        self.assertEqual(
            list(stations.courses.values_list("name", flat=True)),
            ["Salad Station", "Hot Buffet", "Dessert Table"],
        )
        # Buffet dishes are never offered as a choice, whatever the course structure.
        self.assertFalse(stations.dish_comments.filter(is_choice=True).exists())

    @override_settings(SEED_STARTER_CATALOG_ON_ORG_CREATE=True)
    def test_buffet_profile_is_idempotent(self):
        call_command("seed_demo", org="Grand Buffet Caterers", profile="buffet", stdout=StringIO())
        call_command("seed_demo", org="Grand Buffet Caterers", profile="buffet", stdout=StringIO())
        org = Organisation.objects.get(name="Grand Buffet Caterers")
        # 2 rep events + the 2 buffet menus, not doubled.
        self.assertEqual(Event.objects.filter(organisation=org, name__startswith="[demo]").count(), 4)

    def test_settings_configured_for_commission(self):
        self._run()
        org = Organisation.objects.get(name="Demo Co")
        s = OrgSettings.for_org(org)
        self.assertEqual(s.target_period, "monthly")
        self.assertEqual(s.commission_basis, "event_date")
        self.assertEqual(s.fiscal_year_start_month, 1)

    def test_demo_org_gets_its_country_locale_and_service_charge(self):
        # The demo org is US, so it must have the US locale + a 20% service charge —
        # even when restored (via seed.json/loaddata) with stale/zero settings that
        # bypassed the org-creation signal. This is the bug that made a seeded Demo Co
        # show no service charge (and broke the pricing e2e in CI).
        from decimal import Decimal
        self._run()
        org = Organisation.objects.get(name="Demo Co")
        # Simulate the loaddata-restored state: wrong locale + no service charge.
        s = OrgSettings.for_org(org)
        s.service_charge_default_pct = Decimal("0.00")
        s.currency_symbol = "£"
        s.save()
        self._run()  # re-seeding must correct it back to the org's country defaults
        s = OrgSettings.for_org(org)
        self.assertEqual(s.service_charge_default_pct, Decimal("20.00"))
        self.assertEqual(s.currency_symbol, "$")
        self.assertEqual(s.currency_code, "USD")
