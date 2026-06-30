"""Booking totals — the single source of truth (bookings/services/totals.py),
used by quotes and events. These guard the money math that has regressed before:
food + all line items (taxable/non-taxable/discount) + tax."""
import json
import os
from decimal import Decimal

from django.test import TestCase

from bookings.models import BookingLineItem
from bookings.services.totals import compute_booking_totals
from bookings.tests import make_quote, _make_org

# Shared cross-language spec — the SAME file is loaded by the frontend mirror's
# tests (frontend/lib/quoteTotals.test.ts). See docs/CALCULATION_PARITY.md.
GOLDEN_CASES_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "docs", "calculation-golden-cases.json"
)


class _Item:
    def __init__(self, line_total, is_taxable=True):
        self.line_total = Decimal(str(line_total))
        self.is_taxable = is_taxable


class TestGoldenCaseParity(TestCase):
    """Run the shared golden cases through the backend engine. The frontend
    mirror runs the SAME file through its engine — together they lock parity
    across the two languages. Changing the rule means updating the golden file,
    which forces both engines to conform."""

    def test_backend_matches_golden_cases(self):
        with open(GOLDEN_CASES_PATH) as f:
            data = json.load(f)
        for case in data["cases"]:
            items = [_Item(i["line_total"], i["is_taxable"]) for i in case["items"]]
            t = compute_booking_totals(
                Decimal(case["food_total"]), items, Decimal(case["tax_rate"])
            )
            exp = case["expected"]
            self.assertEqual(t.subtotal, Decimal(exp["subtotal"]), case["name"])
            self.assertEqual(t.tax_amount, Decimal(exp["tax_amount"]), case["name"])
            self.assertEqual(t.total, Decimal(exp["total"]), case["name"])


class TestComputeBookingTotals(TestCase):
    def test_food_only_with_tax(self):
        t = compute_booking_totals(Decimal("1000.00"), [], Decimal("0.20"))
        self.assertEqual(t.subtotal, Decimal("1000.00"))
        self.assertEqual(t.tax_amount, Decimal("200.00"))
        self.assertEqual(t.total, Decimal("1200.00"))

    def test_taxable_and_non_taxable_items(self):
        t = compute_booking_totals(Decimal("0"), [_Item("100", True), _Item("50", False)], Decimal("0.10"))
        self.assertEqual(t.taxable_subtotal, Decimal("100.00"))
        self.assertEqual(t.non_taxable_subtotal, Decimal("50.00"))
        self.assertEqual(t.subtotal, Decimal("150.00"))
        self.assertEqual(t.tax_amount, Decimal("10.00"))  # tax only on the taxable item
        self.assertEqual(t.total, Decimal("160.00"))

    def test_food_plus_items_tax_only_on_food_and_taxable(self):
        t = compute_booking_totals(Decimal("1000"), [_Item("200", True), _Item("100", False)], Decimal("0.20"))
        self.assertEqual(t.taxable_subtotal, Decimal("1200.00"))  # 1000 food + 200
        self.assertEqual(t.subtotal, Decimal("1300.00"))
        self.assertEqual(t.tax_amount, Decimal("240.00"))         # 1200 * 0.20
        self.assertEqual(t.total, Decimal("1540.00"))

    def test_discount_reduces_subtotal(self):
        t = compute_booking_totals(Decimal("0"), [_Item("500", True), _Item("-100", True)], Decimal("0"))
        self.assertEqual(t.subtotal, Decimal("400.00"))
        self.assertEqual(t.total, Decimal("400.00"))

    def test_zero_and_none_safe(self):
        self.assertEqual(compute_booking_totals(Decimal("0"), [], Decimal("0")).total, Decimal("0.00"))
        self.assertEqual(compute_booking_totals(None, [], None).total, Decimal("0.00"))

    def test_rounding_to_two_places(self):
        t = compute_booking_totals(Decimal("33.33"), [], Decimal("0.175"))  # 5.83275 -> 5.83
        self.assertEqual(t.tax_amount, Decimal("5.83"))


class TestQuoteTotalsIntegration(TestCase):
    def setUp(self):
        self.org = _make_org()

    def test_food_plus_taxable_nontaxable_and_discount(self):
        quote = make_quote(org=self.org, guest_count=100,
                           price_per_head=Decimal("30.00"), tax_rate=Decimal("0.20"))
        # food = 30 * 100 = 3000 (taxable)
        BookingLineItem.objects.create(quote=quote, category="rental", description="Tables",
                                       quantity=Decimal("10"), unit="each", unit_price=Decimal("50.00"), is_taxable=True)
        BookingLineItem.objects.create(quote=quote, category="fee", description="Service",
                                       quantity=Decimal("1"), unit="flat", unit_price=Decimal("200.00"), is_taxable=False)
        BookingLineItem.objects.create(quote=quote, category="discount", description="Promo",
                                       quantity=Decimal("1"), unit="flat", unit_price=Decimal("100.00"))
        quote.refresh_from_db()
        # taxable = 3000 + 500 - 100 = 3400 ; non-taxable = 200 ; subtotal = 3600
        # tax = 3400 * 0.20 = 680 ; total = 4280
        self.assertEqual(quote.subtotal, Decimal("3600.00"))
        self.assertEqual(quote.tax_amount, Decimal("680.00"))
        self.assertEqual(quote.total, Decimal("4280.00"))

    def test_quote_total_includes_additional_meals(self):
        # Parity with events: a quote's food total now includes its additional meals.
        from events.models import BookingMeal
        quote = make_quote(org=self.org, guest_count=20,
                           price_per_head=Decimal("50.00"), tax_rate=Decimal("0"))
        BookingMeal.objects.create(quote=quote, label="Welcome drinks",
                                   guest_count=20, price_per_head=Decimal("15.00"))
        quote.recalculate_totals()
        quote.refresh_from_db()
        # main food = 50*20 = 1000 + meal 15*20 = 300 -> 1300
        self.assertEqual(quote.subtotal, Decimal("1300.00"))
        self.assertEqual(quote.total, Decimal("1300.00"))

    def test_quote_not_taxable_has_no_tax(self):
        quote = make_quote(org=self.org, guest_count=10,
                           price_per_head=Decimal("50.00"), tax_rate=Decimal("0.20"),
                           is_taxable=False)
        quote.recalculate_totals()
        quote.refresh_from_db()
        self.assertEqual(quote.subtotal, Decimal("500.00"))
        self.assertEqual(quote.tax_amount, Decimal("0.00"))


class TestEventTotalsIntegration(TestCase):
    """Events total up via the SAME engine: food + add-on items + tax."""

    def setUp(self):
        self.org = _make_org()

    def test_event_food_plus_items_with_tax(self):
        from events.models import Event
        event = Event.objects.create(organisation=self.org, name="E", event_date="2026-09-01",
                                     gents=20, ladies=30, price_per_head=Decimal("40.00"),
                                     is_taxable=True, tax_rate=Decimal("0.15"))
        # food = 40 * (20+30) = 2000 (taxable)
        BookingLineItem.objects.create(event=event, category="rental", description="Chairs",
                                       quantity=Decimal("10"), unit="each", unit_price=Decimal("20.00"), is_taxable=True)
        BookingLineItem.objects.create(event=event, category="fee", description="Travel",
                                       quantity=Decimal("1"), unit="flat", unit_price=Decimal("300.00"), is_taxable=False)
        event.refresh_from_db()
        # taxable = 2000 + 200 = 2200 ; non-taxable = 300 ; subtotal = 2500
        # tax = 2200 * 0.15 = 330 ; total = 2830
        self.assertEqual(event.subtotal, Decimal("2500.00"))
        self.assertEqual(event.tax_amount, Decimal("330.00"))
        self.assertEqual(event.total, Decimal("2830.00"))

    def test_event_not_taxable_has_no_tax(self):
        from events.models import Event
        event = Event.objects.create(organisation=self.org, name="E2", event_date="2026-09-01",
                                     gents=10, ladies=10, price_per_head=Decimal("50.00"),
                                     is_taxable=False, tax_rate=Decimal("0.20"))
        BookingLineItem.objects.create(event=event, category="rental", description="X",
                                       quantity=Decimal("1"), unit="flat", unit_price=Decimal("100.00"))
        event.refresh_from_db()
        # food = 50*20 = 1000 ; items 100 ; subtotal 1100 ; is_taxable False -> no tax
        self.assertEqual(event.subtotal, Decimal("1100.00"))
        self.assertEqual(event.tax_amount, Decimal("0.00"))
        self.assertEqual(event.total, Decimal("1100.00"))

    def test_event_total_includes_additional_meals(self):
        from events.models import Event, BookingMeal
        event = Event.objects.create(organisation=self.org, name="E3", event_date="2026-09-01",
                                     gents=10, ladies=10, price_per_head=Decimal("50.00"), is_taxable=False)
        BookingMeal.objects.create(event=event, label="Sehri", guest_count=20, price_per_head=Decimal("15.00"))
        event.recalculate_totals()
        event.refresh_from_db()
        # main food = 50*20 = 1000 + meal 15*20 = 300 -> 1300
        self.assertEqual(event.subtotal, Decimal("1300.00"))
        self.assertEqual(event.total, Decimal("1300.00"))
