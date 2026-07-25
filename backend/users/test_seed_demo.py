"""The seed_demo command must produce a deterministic, idempotent demo dataset so
every worktree / clone tests against the same accounts and commission data."""
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

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
