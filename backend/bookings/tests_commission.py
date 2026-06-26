"""Tests for the commission engine (pure math), period helpers, service and API."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.commission import compute_commission, FLAT, ACCELERATED
from bookings.models import CommissionPlan, CommissionBand, OrgSettings, SalesTarget
from bookings.services.commission import commission_summary, period_bounds
from bookings.tests import _make_org
from events.models import Event
from users.models import User


M = Decimal  # shorthand


class CommissionEngineFlatTests(TestCase):
    def test_flat_rate_on_all_revenue(self):
        r = compute_commission(M("6000000"), M("5000000"), model=FLAT, flat_rate=M("5"), bands=[])
        self.assertEqual(r["commission"], M("300000"))
        self.assertEqual(r["attainment_pct"], M("120"))

    def test_flat_with_no_target_still_pays(self):
        r = compute_commission(M("1000000"), M("0"), model=FLAT, flat_rate=M("5"), bands=[])
        self.assertEqual(r["commission"], M("50000"))
        self.assertEqual(r["attainment_pct"], M("0"))

    def test_zero_revenue(self):
        r = compute_commission(M("0"), M("5000000"), model=FLAT, flat_rate=M("5"), bands=[])
        self.assertEqual(r["commission"], M("0"))


class CommissionEngineAcceleratedTests(TestCase):
    BANDS = [(M("0"), M("4")), (M("100"), M("7"))]  # 4% up to target, 7% above

    def test_over_target_only_excess_at_higher_rate(self):
        # target 5M, closed 6M -> 5M@4% + 1M@7% = 270k
        r = compute_commission(M("6000000"), M("5000000"), model=ACCELERATED, flat_rate=M("0"), bands=self.BANDS)
        self.assertEqual(r["commission"], M("270000"))
        self.assertEqual(r["attainment_pct"], M("120"))
        self.assertEqual(len(r["breakdown"]), 2)

    def test_under_target_only_first_band(self):
        # target 5M, closed 4M -> 4M@4% = 160k, second band untouched
        r = compute_commission(M("4000000"), M("5000000"), model=ACCELERATED, flat_rate=M("0"), bands=self.BANDS)
        self.assertEqual(r["commission"], M("160000"))
        self.assertEqual(r["attainment_pct"], M("80"))
        self.assertEqual(len(r["breakdown"]), 1)

    def test_exactly_at_target(self):
        r = compute_commission(M("5000000"), M("5000000"), model=ACCELERATED, flat_rate=M("0"), bands=self.BANDS)
        self.assertEqual(r["commission"], M("200000"))  # 5M @ 4%, nothing above
        self.assertEqual(r["attainment_pct"], M("100"))

    def test_three_bands(self):
        # 0-100% @3%, 100-120% @6%, >120% @9%; target 5M, closed 7M
        # 5M@3% + 1M@6% + 1M@9% = 150k + 60k + 90k = 300k
        bands = [(M("0"), M("3")), (M("100"), M("6")), (M("120"), M("9"))]
        r = compute_commission(M("7000000"), M("5000000"), model=ACCELERATED, flat_rate=M("0"), bands=bands)
        self.assertEqual(r["commission"], M("300000"))
        self.assertEqual(len(r["breakdown"]), 3)

    def test_unsorted_bands_are_sorted(self):
        bands = [(M("100"), M("7")), (M("0"), M("4"))]
        r = compute_commission(M("6000000"), M("5000000"), model=ACCELERATED, flat_rate=M("0"), bands=bands)
        self.assertEqual(r["commission"], M("270000"))

    def test_accelerated_without_target_falls_back_to_flat(self):
        # No target -> attainment undefined -> use flat_rate, ignore bands
        r = compute_commission(M("1000000"), M("0"), model=ACCELERATED, flat_rate=M("5"), bands=self.BANDS)
        self.assertEqual(r["commission"], M("50000"))

    def test_accelerated_without_bands_falls_back_to_flat(self):
        r = compute_commission(M("1000000"), M("5000000"), model=ACCELERATED, flat_rate=M("5"), bands=[])
        self.assertEqual(r["commission"], M("50000"))


class CommissionEngineEdgeCaseTests(TestCase):
    def test_lowest_band_above_zero_leaves_a_gap(self):
        # Misconfigured: lowest band starts at 50% of target, so revenue below
        # 50% of target earns nothing. target 5M, band starts at 2.5M.
        bands = [(M("50"), M("5"))]
        r = compute_commission(M("4000000"), M("5000000"), model=ACCELERATED, flat_rate=M("0"), bands=bands)
        # only 4M - 2.5M = 1.5M is in the band
        self.assertEqual(r["commission"], M("75000"))
        self.assertEqual(len(r["breakdown"]), 1)
        self.assertEqual(r["breakdown"][0]["revenue_in_band"], M("1500000"))

    def test_revenue_below_lowest_band_earns_nothing(self):
        bands = [(M("50"), M("5"))]  # starts at 2.5M
        r = compute_commission(M("2000000"), M("5000000"), model=ACCELERATED, flat_rate=M("0"), bands=bands)
        self.assertEqual(r["commission"], M("0"))
        self.assertEqual(r["breakdown"], [])

    def test_none_inputs_are_treated_as_zero(self):
        r = compute_commission(None, None, model=FLAT, flat_rate=M("5"), bands=[])
        self.assertEqual(r["commission"], M("0"))
        self.assertEqual(r["attainment_pct"], M("0"))

    def test_negative_revenue_is_clamped_to_zero(self):
        r = compute_commission(M("-1000"), M("5000000"), model=FLAT, flat_rate=M("5"), bands=[])
        self.assertEqual(r["commission"], M("0"))

    def test_negative_target_is_clamped(self):
        # negative target -> treated as no target -> flat fallback, no crash
        r = compute_commission(M("1000000"), M("-5000000"), model=ACCELERATED, flat_rate=M("5"),
                               bands=[(M("0"), M("4"))])
        self.assertEqual(r["commission"], M("50000"))
        self.assertEqual(r["attainment_pct"], M("0"))

    def test_commission_is_exact_decimal_not_prerounded(self):
        # 333.33 @ 5.55% = 18.499815 — engine keeps full precision; the view rounds.
        r = compute_commission(M("333.33"), M("0"), model=FLAT, flat_rate=M("5.55"), bands=[])
        self.assertEqual(r["commission"], M("18.499815"))


class MoneyRoundingTests(TestCase):
    def test_money_rounds_half_up_to_two_dp(self):
        from bookings.views.commission import _money
        self.assertEqual(_money(Decimal("18.499815")), "18.50")
        self.assertEqual(_money(Decimal("18.494")), "18.49")
        self.assertEqual(_money(Decimal("18.495")), "18.50")  # half up
        self.assertEqual(_money(Decimal("0")), "0.00")

    def test_pct_rounds_half_up_to_two_dp(self):
        from bookings.views.commission import _pct
        self.assertEqual(_pct(Decimal("83.333")), "83.33")
        self.assertEqual(_pct(Decimal("120")), "120.00")


class PeriodBoundsTests(TestCase):
    DAY = date(2026, 6, 15)

    def test_monthly(self):
        start, end, label = period_bounds("monthly", self.DAY)
        self.assertEqual(start, date(2026, 6, 1))
        self.assertEqual(end, date(2026, 7, 1))
        self.assertEqual(label, "June 2026")

    def test_quarterly(self):
        start, end, label = period_bounds("quarterly", self.DAY)
        self.assertEqual((start, end), (date(2026, 4, 1), date(2026, 7, 1)))
        self.assertEqual(label, "Q2 2026")

    def test_yearly(self):
        start, end, label = period_bounds("yearly", self.DAY)
        self.assertEqual((start, end), (date(2026, 1, 1), date(2027, 1, 1)))
        self.assertEqual(label, "2026")

    def test_december_rolls_over(self):
        start, end, _ = period_bounds("monthly", date(2026, 12, 10))
        self.assertEqual((start, end), (date(2026, 12, 1), date(2027, 1, 1)))


def _set_commission(org, *, model="flat", flat_rate="0", bands=None, period="monthly", basis="event_date"):
    """Configure the org's default plan + period/basis (reps fall back to it)."""
    OrgSettings.objects.update_or_create(
        organisation=org,
        defaults={"target_period": period, "commission_basis": basis},
    )
    plan = _set_plan(org, is_default=True, name="Default", model=model, flat_rate=flat_rate, bands=bands)
    return plan


def _set_plan(org, *, name, model="flat", flat_rate="0", bands=None, is_default=False):
    plan, _ = CommissionPlan.objects.get_or_create(
        organisation=org, name=name, defaults={"is_default": is_default},
    )
    plan.commission_model = model
    plan.commission_flat_rate = Decimal(flat_rate)
    plan.is_default = is_default or plan.is_default
    plan.save()
    CommissionBand.objects.filter(plan=plan).delete()
    for pct, rate in (bands or []):
        CommissionBand.objects.create(organisation=org, plan=plan, min_attainment_pct=Decimal(pct), rate=Decimal(rate))
    return plan


def _event(org, user, total, *, date=None, booking_date=None, status="confirmed"):
    """A confirmed event with a fixed total, attributed to `user`."""
    return Event.objects.create(
        organisation=org, name="E", gents=50, ladies=50,
        date=date or "2099-01-01", booking_date=booking_date,
        assigned_to=user, status=status, total=Decimal(str(total)),
    )


class CommissionSummaryTests(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.user = User.objects.create(
            email="rep@example.com", first_name="Rep", last_name="One",
            role="salesperson", organisation=self.org,
        )
        self.today = timezone.now().date()

    def test_flat_summary(self):
        _set_commission(self.org, model="flat", flat_rate="5")
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("5000000"))
        _event(self.org, self.user, "6000000", date=self.today)

        s = commission_summary(self.org, self.user, today=self.today)
        self.assertEqual(s["revenue"], Decimal("6000000"))
        self.assertEqual(s["target"], Decimal("5000000"))
        self.assertEqual(s["commission"], Decimal("300000"))
        self.assertEqual(s["attainment_pct"], Decimal("120"))
        self.assertEqual(s["deals"], 1)

    def test_accelerated_summary(self):
        _set_commission(self.org, model="accelerated", bands=[("0", "4"), ("100", "7")])
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("5000000"))
        _event(self.org, self.user, "6000000", date=self.today)

        s = commission_summary(self.org, self.user, today=self.today)
        self.assertEqual(s["commission"], Decimal("270000"))  # 5M@4% + 1M@7%

    def test_tentative_and_cancelled_events_are_excluded(self):
        _set_commission(self.org, model="flat", flat_rate="5")
        _event(self.org, self.user, "1000000", date=self.today, status="confirmed")
        _event(self.org, self.user, "9000000", date=self.today, status="tentative")
        _event(self.org, self.user, "9000000", date=self.today, status="cancelled")

        s = commission_summary(self.org, self.user, today=self.today)
        self.assertEqual(s["revenue"], Decimal("1000000"))  # only the confirmed one
        self.assertEqual(s["deals"], 1)

    def test_only_events_assigned_to_the_rep_count(self):
        other = User.objects.create(
            email="other@example.com", first_name="O", last_name="T",
            role="salesperson", organisation=self.org,
        )
        _set_commission(self.org, model="flat", flat_rate="5")
        _event(self.org, self.user, "1000000", date=self.today)
        _event(self.org, other, "9000000", date=self.today)  # someone else's credit

        s = commission_summary(self.org, self.user, today=self.today)
        self.assertEqual(s["revenue"], Decimal("1000000"))

    def test_commission_basis_event_date_vs_booking_date(self):
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("1000000"))
        last_month = self.today.replace(day=1) - timedelta(days=1)
        # Event takes place this month, but was booked last month.
        _event(self.org, self.user, "1000000", date=self.today, booking_date=last_month)

        _set_commission(self.org, model="flat", flat_rate="5", basis="event_date")
        s = commission_summary(self.org, self.user, today=self.today)
        self.assertEqual(s["revenue"], Decimal("1000000"))  # counts in the month it happens

        _set_commission(self.org, model="flat", flat_rate="5", basis="booking_date")
        s = commission_summary(self.org, self.user, today=self.today)
        self.assertEqual(s["revenue"], Decimal("0"))  # booked last month -> not this period

    def test_only_current_period_counts_but_year_includes_whole_year(self):
        _set_commission(self.org, model="flat", flat_rate="5")
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("1000000"))
        today = date(2026, 6, 26)
        _event(self.org, self.user, "1000000", date=today)                # this period (June)
        _event(self.org, self.user, "2000000", date=date(2026, 2, 10))    # earlier this calendar year
        _event(self.org, self.user, "5000000", date=date(2025, 11, 1))    # last calendar year

        s = commission_summary(self.org, self.user, today=today)
        self.assertEqual(s["revenue"], Decimal("1000000"))       # current month only
        self.assertEqual(s["deals"], 1)
        self.assertEqual(s["year_revenue"], Decimal("3000000"))  # Jan–Dec 2026 (default calendar year)
        self.assertEqual(s["year_deals"], 2)
        self.assertEqual(s["year_label"], "2026")

    def test_fiscal_year_window_for_april_start(self):
        # Org runs an April–March financial year.
        _set_commission(self.org, model="flat", flat_rate="5")
        OrgSettings.objects.filter(organisation=self.org).update(fiscal_year_start_month=4)
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("1000000"))
        today = date(2026, 6, 26)                                         # FY 2026/27 (starts Apr 2026)
        _event(self.org, self.user, "1000000", date=date(2026, 5, 1))     # in FY 2026/27
        _event(self.org, self.user, "2000000", date=date(2026, 3, 31))    # in prior FY 2025/26
        _event(self.org, self.user, "4000000", date=date(2027, 4, 1))     # in next FY 2027/28

        s = commission_summary(self.org, self.user, today=today)
        self.assertEqual(s["year_revenue"], Decimal("1000000"))  # only the May event falls in this FY
        self.assertEqual(s["year_deals"], 1)
        self.assertEqual(s["year_label"], "FY 2026/27")

    def test_rep_plan_overrides_the_default(self):
        # default plan = 5% flat; a Senior plan = 10% flat; assign the rep to Senior.
        _set_commission(self.org, model="flat", flat_rate="5")
        senior = _set_plan(self.org, name="Senior", model="flat", flat_rate="10")
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("1000000"), plan=senior)
        _event(self.org, self.user, "1000000", date=self.today)

        s = commission_summary(self.org, self.user, today=self.today)
        self.assertEqual(s["commission"], Decimal("100000"))  # 10%, not the default 5%
        self.assertEqual(s["plan"], "Senior")

    def test_unassigned_rep_uses_default_plan(self):
        _set_commission(self.org, model="flat", flat_rate="5")
        _event(self.org, self.user, "1000000", date=self.today)
        s = commission_summary(self.org, self.user, today=self.today)
        self.assertEqual(s["commission"], Decimal("50000"))  # default 5%
        self.assertEqual(s["plan"], "Default")


class MyCommissionAPITests(TestCase):
    URL = "/api/bookings/commission/me/"

    def setUp(self):
        self.org = _make_org()
        self.user = User.objects.create(
            email="rep2@example.com", first_name="Rep", last_name="Two",
            role="salesperson", organisation=self.org,
        )
        _set_commission(self.org, model="flat", flat_rate="5")
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("5000000"))
        _event(self.org, self.user, "6000000", date=timezone.now().date())
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_commission_and_target(self):
        res = self.client.get(self.URL)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["revenue"], "6000000.00")
        self.assertEqual(data["target"], "5000000.00")
        self.assertEqual(data["commission"], "300000.00")
        self.assertEqual(data["attainment_pct"], "120.00")
        self.assertEqual(data["deals"], 1)
        self.assertEqual(data["model"], "flat")
        self.assertEqual(data["basis"], "event_date")


class CommissionConfigAPITests(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.owner = User.objects.create(
            email="owner@example.com", first_name="Own", last_name="Er",
            role="owner", organisation=self.org,
        )
        self.rep = User.objects.create(
            email="rep3@example.com", first_name="R", last_name="P",
            role="salesperson", organisation=self.org,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def _default_plan(self):
        return CommissionPlan.objects.get(organisation=self.org, is_default=True)

    def test_update_commission_settings(self):
        # period + basis are org-wide; model/rate are per-plan now.
        res = self.client.patch("/api/bookings/settings/", {
            "target_period": "quarterly", "commission_basis": "booking_date",
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        s = OrgSettings.for_org(self.org)
        self.assertEqual(s.target_period, "quarterly")
        self.assertEqual(s.commission_basis, "booking_date")
        self.assertTrue(res.json()["commission_model_choices"])  # for the plan form

    def test_commission_plan_crud(self):
        res = self.client.post("/api/bookings/settings/commission-plans/",
                               {"name": "Senior", "commission_model": "accelerated", "commission_flat_rate": "0"},
                               format="json")
        self.assertEqual(res.status_code, 201, res.content)
        plan_id = res.json()["id"]
        self.assertFalse(res.json()["is_default"])

        res = self.client.patch(f"/api/bookings/settings/commission-plans/{plan_id}/",
                                {"commission_flat_rate": "8"}, format="json")
        self.assertEqual(res.status_code, 200)

        # the default plan cannot be deleted
        default_id = self._default_plan().id
        res = self.client.delete(f"/api/bookings/settings/commission-plans/{default_id}/")
        self.assertEqual(res.status_code, 400)

        res = self.client.delete(f"/api/bookings/settings/commission-plans/{plan_id}/")
        self.assertEqual(res.status_code, 204)

    def test_commission_band_crud(self):
        plan_id = self._default_plan().id
        res = self.client.post("/api/bookings/settings/commission-bands/",
                               {"plan": plan_id, "min_attainment_pct": "100", "rate": "7"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        band_id = res.json()["id"]

        res = self.client.get(f"/api/bookings/settings/commission-bands/?plan={plan_id}&page_size=all")
        self.assertEqual(len(res.json()), 1)

        res = self.client.patch(f"/api/bookings/settings/commission-bands/{band_id}/",
                                {"rate": "9"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(CommissionBand.objects.get(pk=band_id).rate, Decimal("9"))

        res = self.client.delete(f"/api/bookings/settings/commission-bands/{band_id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(CommissionBand.objects.filter(pk=band_id).exists())

    def test_sales_target_upsert(self):
        res = self.client.put("/api/bookings/settings/sales-targets/",
                              {"user": self.rep.id, "amount": "5000000"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(
            SalesTarget.objects.get(organisation=self.org, user=self.rep).amount, Decimal("5000000"),
        )
        # second PUT updates, not duplicates
        self.client.put("/api/bookings/settings/sales-targets/",
                        {"user": self.rep.id, "amount": "6000000"}, format="json")
        self.assertEqual(SalesTarget.objects.filter(organisation=self.org, user=self.rep).count(), 1)
        self.assertEqual(
            SalesTarget.objects.get(organisation=self.org, user=self.rep).amount, Decimal("6000000"),
        )

    def test_sales_target_rejects_user_from_another_org(self):
        other = _make_org(slug="other-org")
        outsider = User.objects.create(email="out@example.com", role="salesperson", organisation=other)
        res = self.client.put("/api/bookings/settings/sales-targets/",
                              {"user": outsider.id, "amount": "1"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_non_admin_is_forbidden(self):
        self.client.force_authenticate(user=self.rep)
        res = self.client.post("/api/bookings/settings/commission-bands/",
                               {"min_attainment_pct": "0", "rate": "5"}, format="json")
        self.assertEqual(res.status_code, 403)


class DashboardTargetAttainmentAPITests(TestCase):
    """The manager dashboard surfaces each rep's progress to target."""

    URL = "/api/bookings/dashboard/stats/"

    def setUp(self):
        self.org = _make_org()
        self.owner = User.objects.create(
            email="owner4@example.com", first_name="Own", last_name="Er",
            role="owner", organisation=self.org,
        )
        self.rep = User.objects.create(
            email="rep4@example.com", first_name="Rep", last_name="Four",
            role="salesperson", organisation=self.org,
        )
        _set_commission(self.org, model="flat", flat_rate="5")
        SalesTarget.objects.create(organisation=self.org, user=self.rep, amount=Decimal("5000000"))
        _event(self.org, self.rep, "6000000", date=timezone.now().date())
        self.client = APIClient()

    def test_dashboard_includes_target_attainment(self):
        self.client.force_authenticate(user=self.owner)
        res = self.client.get(self.URL)
        self.assertEqual(res.status_code, 200)
        rows = res.json()["target_attainment"]
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["user_id"], self.rep.id)
        self.assertEqual(row["target"], "5000000.00")
        self.assertEqual(row["revenue"], "6000000.00")
        self.assertEqual(row["attainment_pct"], "120.00")

    def test_reps_without_a_target_are_excluded(self):
        # A second rep with no target should not appear.
        User.objects.create(
            email="rep5@example.com", first_name="No", last_name="Target",
            role="salesperson", organisation=self.org,
        )
        self.client.force_authenticate(user=self.owner)
        rows = self.client.get(self.URL).json()["target_attainment"]
        self.assertEqual([r["user_id"] for r in rows], [self.rep.id])

    def test_salesperson_cannot_see_team_dashboard(self):
        self.client.force_authenticate(user=self.rep)
        res = self.client.get(self.URL)
        self.assertEqual(res.status_code, 403)
