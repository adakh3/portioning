"""Tests for the commission engine (pure math), period helpers, service and API."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.commission import compute_commission, FLAT, ACCELERATED
from bookings.models import CommissionBand, Lead, OrgSettings, Quote, SalesTarget
from bookings.services.commission import commission_summary, period_bounds
from bookings.tests import _make_org, make_account, make_quote
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


def _set_commission(org, *, model="flat", flat_rate="0", bands=None, period="monthly"):
    OrgSettings.objects.update_or_create(
        organisation=org,
        defaults={
            "commission_model": model,
            "commission_flat_rate": Decimal(flat_rate),
            "target_period": period,
        },
    )
    CommissionBand.objects.filter(organisation=org).delete()
    for pct, rate in (bands or []):
        CommissionBand.objects.create(organisation=org, min_attainment_pct=Decimal(pct), rate=Decimal(rate))


def _won_lead(org, user, account, total, when):
    quote = make_quote(org=org, account=account)
    Quote.objects.filter(pk=quote.pk).update(total=Decimal(str(total)))
    return Lead.objects.create(
        organisation=org, assigned_to=user, account=account,
        contact_name="Cust", source="", event_type="wedding",
        status="won", won_at=when, won_quote=quote,
    )


class CommissionSummaryTests(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.user = User.objects.create(
            email="rep@example.com", first_name="Rep", last_name="One",
            role="salesperson", organisation=self.org,
        )
        self.account = make_account(org=self.org)
        self.now = timezone.now()

    def test_flat_summary(self):
        _set_commission(self.org, model="flat", flat_rate="5", period="monthly")
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("5000000"))
        _won_lead(self.org, self.user, self.account, "6000000", self.now)

        s = commission_summary(self.org, self.user, today=self.now.date())
        self.assertEqual(s["revenue"], Decimal("6000000"))
        self.assertEqual(s["target"], Decimal("5000000"))
        self.assertEqual(s["commission"], Decimal("300000"))
        self.assertEqual(s["attainment_pct"], Decimal("120"))
        self.assertEqual(s["deals"], 1)

    def test_accelerated_summary(self):
        _set_commission(self.org, model="accelerated", bands=[("0", "4"), ("100", "7")], period="monthly")
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("5000000"))
        _won_lead(self.org, self.user, self.account, "6000000", self.now)

        s = commission_summary(self.org, self.user, today=self.now.date())
        self.assertEqual(s["commission"], Decimal("270000"))  # 5M@4% + 1M@7%

    def test_only_current_period_counts_but_lifetime_includes_all(self):
        _set_commission(self.org, model="flat", flat_rate="5", period="monthly")
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("1000000"))
        _won_lead(self.org, self.user, self.account, "1000000", self.now)             # this month
        _won_lead(self.org, self.user, self.account, "2000000", self.now - timedelta(days=60))  # earlier

        s = commission_summary(self.org, self.user, today=self.now.date())
        self.assertEqual(s["revenue"], Decimal("1000000"))          # period only
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
        self.account = make_account(org=self.org)
        _set_commission(self.org, model="flat", flat_rate="5", period="monthly")
        SalesTarget.objects.create(organisation=self.org, user=self.user, amount=Decimal("5000000"))
        _won_lead(self.org, self.user, self.account, "6000000", timezone.now())
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
