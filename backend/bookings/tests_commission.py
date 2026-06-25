"""Tests for the commission engine (pure math), period helpers, service and API."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.commission import compute_commission, FLAT, ACCELERATED
from bookings.models import CommissionBand, OrgSettings, SalesTarget
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
    OrgSettings.objects.update_or_create(
        organisation=org,
        defaults={
            "commission_model": model,
            "commission_flat_rate": Decimal(flat_rate),
            "target_period": period,
            "commission_basis": basis,
        },
    )
    CommissionBand.objects.filter(organisation=org).delete()
    for pct, rate in (bands or []):
        CommissionBand.objects.create(organisation=org, min_attainment_pct=Decimal(pct), rate=Decimal(rate))


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

    def test_only_current_period_counts_but_lifetime_includes_all(self):
        _set_commission(self.org, model="flat", flat_rate="5")
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("1000000"))
        _event(self.org, self.user, "1000000", date=self.today)                    # this period
        _event(self.org, self.user, "2000000", date=self.today - timedelta(days=60))  # earlier

        s = commission_summary(self.org, self.user, today=self.today)
        self.assertEqual(s["revenue"], Decimal("1000000"))           # period only
        self.assertEqual(s["deals"], 1)
        self.assertEqual(s["lifetime_revenue"], Decimal("3000000"))  # all-time
        self.assertEqual(s["lifetime_deals"], 2)


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

    def test_update_commission_settings(self):
        res = self.client.patch("/api/bookings/settings/", {
            "commission_model": "accelerated", "commission_flat_rate": "5.00",
            "target_period": "quarterly", "commission_basis": "booking_date",
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        s = OrgSettings.for_org(self.org)
        self.assertEqual(s.commission_model, "accelerated")
        self.assertEqual(s.target_period, "quarterly")
        self.assertEqual(s.commission_basis, "booking_date")
        # choices are exposed for the UI dropdowns
        self.assertTrue(res.json()["commission_model_choices"])

    def test_commission_band_crud(self):
        res = self.client.post("/api/bookings/settings/commission-bands/",
                               {"min_attainment_pct": "100", "rate": "7"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        band_id = res.json()["id"]

        res = self.client.get("/api/bookings/settings/commission-bands/?page_size=all")
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
