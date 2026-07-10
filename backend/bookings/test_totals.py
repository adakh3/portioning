"""Booking totals — the single source of truth (bookings/services/totals.py),
used by quotes and events. These guard the money math that has regressed before:
food + all line items (taxable/non-taxable/discount) + tax."""
import json
import os
from decimal import Decimal

from django.test import TestCase

from bookings.models import BookingLineItem, Quote
from bookings.serializers.quotes import QuoteSerializer
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
            items = [_Item(i["line_total"]) for i in case["items"]]
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

    def test_items_taxed_on_whole_subtotal(self):
        # Tax now applies to the whole subtotal — no per-line taxable split.
        t = compute_booking_totals(Decimal("0"), [_Item("100"), _Item("50")], Decimal("0.10"))
        self.assertEqual(t.subtotal, Decimal("150.00"))
        self.assertEqual(t.tax_amount, Decimal("15.00"))  # 150 * 0.10
        self.assertEqual(t.total, Decimal("165.00"))

    def test_food_plus_items_whole_subtotal_taxed(self):
        t = compute_booking_totals(Decimal("1000"), [_Item("200"), _Item("100")], Decimal("0.20"))
        self.assertEqual(t.subtotal, Decimal("1300.00"))
        self.assertEqual(t.tax_amount, Decimal("260.00"))         # 1300 * 0.20
        self.assertEqual(t.total, Decimal("1560.00"))

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
        # whole subtotal taxed: 3000 + 500 + 200 - 100 = 3600
        # tax = 3600 * 0.20 = 720 ; total = 4320
        self.assertEqual(quote.subtotal, Decimal("3600.00"))
        self.assertEqual(quote.tax_amount, Decimal("720.00"))
        self.assertEqual(quote.total, Decimal("4320.00"))

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
        # whole subtotal taxed: food 2000 + 200 + 300 = 2500
        # tax = 2500 * 0.15 = 375 ; total = 2875
        self.assertEqual(event.subtotal, Decimal("2500.00"))
        self.assertEqual(event.tax_amount, Decimal("375.00"))
        self.assertEqual(event.total, Decimal("2875.00"))

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


class TestTotalsReconciliation(TestCase):
    """Guard the invariant Q-59 violated: everything in the subtotal is accounted
    for, and the money adds up — subtotal = food_total + line items, tax = the
    effective rate × the WHOLE subtotal, total = subtotal + tax. A regression
    that hides a charge in the subtotal (the phantom food line) breaks this."""

    def setUp(self):
        self.org = _make_org()

    def _assert_reconciles(self, booking, effective_rate):
        booking.refresh_from_db()
        items = sum((li.line_total for li in booking.line_items.all()), Decimal("0.00"))
        self.assertEqual(booking.subtotal, booking.food_total + items,
                         "subtotal must equal food_total + every line item")
        self.assertEqual(booking.tax_amount, (booking.subtotal * effective_rate).quantize(Decimal("0.01")),
                         "tax must be the effective rate × the whole subtotal")
        self.assertEqual(booking.total, booking.subtotal + booking.tax_amount)

    def test_q59_quote_reconciles(self):
        # The real Q-59 shape at the model level: a per-head food charge + priced
        # add-ons + a discount, taxed at 5% on the whole subtotal.
        quote = make_quote(org=self.org, guest_count=40,
                           price_per_head=Decimal("50.00"), tax_rate=Decimal("0.05"))
        BookingLineItem.objects.create(quote=quote, category="beverage", description="Tea & Coffee",
                                       quantity=Decimal("40"), unit="each", unit_price=Decimal("1200"))
        BookingLineItem.objects.create(quote=quote, category="rental", description="Boxes",
                                       quantity=Decimal("40"), unit="each", unit_price=Decimal("1880"))
        BookingLineItem.objects.create(quote=quote, category="discount", description="Lumsum",
                                       quantity=Decimal("1"), unit="flat", unit_price=Decimal("11200"))
        quote.refresh_from_db()
        self.assertEqual(quote.food_total, Decimal("2000.00"))   # 50 × 40 (must be visible on the PDF)
        self.assertEqual(quote.subtotal, Decimal("114000.00"))   # 2000 + 48000 + 75200 - 11200
        self.assertEqual(quote.tax_amount, Decimal("5700.00"))   # 5% of the whole subtotal
        self.assertEqual(quote.total, Decimal("119700.00"))
        self._assert_reconciles(quote, Decimal("0.05"))

    def test_quote_with_meals_reconciles(self):
        from events.models import BookingMeal
        quote = make_quote(org=self.org, guest_count=20,
                           price_per_head=Decimal("50"), tax_rate=Decimal("0.10"))
        BookingMeal.objects.create(quote=quote, label="Welcome drinks", guest_count=20, price_per_head=Decimal("15"))
        BookingLineItem.objects.create(quote=quote, category="rental", description="Chairs",
                                       quantity=Decimal("1"), unit="flat", unit_price=Decimal("500"))
        quote.recalculate_totals()
        quote.refresh_from_db()
        self.assertEqual(quote.food_total, Decimal("1300.00"))   # 50×20 main + 15×20 meal
        self._assert_reconciles(quote, Decimal("0.10"))

    def test_event_not_taxable_reconciles_at_zero_rate(self):
        from events.models import Event
        event = Event.objects.create(organisation=self.org, name="E", event_date="2026-09-01",
                                     gents=25, ladies=25, price_per_head=Decimal("40"),
                                     is_taxable=False, tax_rate=Decimal("0.15"))
        BookingLineItem.objects.create(event=event, category="rental", description="X",
                                       quantity=Decimal("1"), unit="flat", unit_price=Decimal("300"))
        # is_taxable False → the effective rate is 0 even though tax_rate is 0.15.
        self._assert_reconciles(event, Decimal("0"))

    def test_discount_is_pre_tax(self):
        # A discount is a negative line, so it reduces the subtotal *before* tax.
        quote = make_quote(org=self.org, guest_count=10,
                           price_per_head=Decimal("100"), tax_rate=Decimal("0.20"))
        BookingLineItem.objects.create(quote=quote, category="discount", description="Promo",
                                       quantity=Decimal("1"), unit="flat", unit_price=Decimal("200"))
        quote.refresh_from_db()
        self.assertEqual(quote.subtotal, Decimal("800.00"))     # 1000 food - 200
        self.assertEqual(quote.tax_amount, Decimal("160.00"))   # 20% of the NET 800, not 1000
        self._assert_reconciles(quote, Decimal("0.20"))


class TestSavePathReconciliation(TestCase):
    """Regression for the prefetch-cache totals bug. QuoteDetailView loads a quote
    with prefetch_related('line_items'); editing it to ADD an add-on used to leave
    the stored subtotal computed against the STALE prefetch cache — so the new item
    saved fine but silently vanished from the subtotal (and the PDF). recalc must
    read line items fresh. This drives the REAL serializer update path."""

    def setUp(self):
        self.org = _make_org()

    def _ctx(self):
        from rest_framework.test import APIRequestFactory
        from django.contrib.auth import get_user_model
        req = APIRequestFactory().patch("/")
        req.user = get_user_model().objects.filter(organisation=self.org).first()
        return {"request": req}

    def test_adding_addon_via_prefetched_update_updates_stored_subtotal(self):
        quote = make_quote(org=self.org, guest_count=30,
                           price_per_head=Decimal("1000.00"), tax_rate=Decimal("0.05"))
        quote.recalculate_totals()
        # Reload EXACTLY as the detail/edit endpoint does — this poisons the cache.
        prefetched = Quote.objects.prefetch_related("line_items").get(pk=quote.pk)
        list(prefetched.line_items.all())  # evaluate the (empty) prefetch cache
        ser = QuoteSerializer(prefetched, partial=True, context=self._ctx(), data={
            "line_items": [{"category": "fee", "description": "Decor", "quantity": "1",
                            "unit": "each", "unit_price": "5000", "is_taxable": True}],
        })
        ser.is_valid(raise_exception=True)
        ser.save()
        quote.refresh_from_db()
        # food 30000 + add-on 5000 = 35000 (the stale-cache bug left it at 30000).
        self.assertEqual(quote.subtotal, Decimal("35000.00"))
        self.assertEqual(quote.tax_amount, Decimal("1750.00"))   # 5% of 35000
        self.assertEqual(quote.line_items.count(), 1)

    def test_big_eaters_does_not_change_food_total(self):
        # big_eaters is a portioning modifier (grams), not a price multiplier.
        from events.models import Event
        plain = Event.objects.create(organisation=self.org, name="A", event_date="2026-09-01",
                                     gents=10, ladies=10, price_per_head=Decimal("50"))
        big = Event.objects.create(organisation=self.org, name="B", event_date="2026-09-01",
                                   gents=10, ladies=10, price_per_head=Decimal("50"),
                                   big_eaters=True, big_eaters_percentage=30.0)
        self.assertEqual(plain.food_total, big.food_total)
