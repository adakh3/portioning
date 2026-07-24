"""Segment-aware per-head pricing (REL-415, AC10/AC11).

Food is priced ``price_per_head × price_multiplier × count`` summed over **all**
segments — in-count (Adults, Kids) and additional covers (Vendors) alike. With no
breakdown it reduces to ``price_per_head × guest_count`` (proven byte-identical by
test_legacy_org_snapshot). Mirrored on quote AND event (the single resolver +
``segment_food_total`` feed both).
"""
from decimal import Decimal

from django.test import TestCase

import io

from bookings.models.quotes import Quote
from bookings.services.totals import segment_food_total, segment_food_rows
from bookings.tests import _make_org, make_contact, make_quote
from events.models import Event, BookingGuestCount
from rules.models import GuestSegment

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover
    HAVE_PYPDF = False


class SegmentFoodTotalPureTests(TestCase):
    def test_no_breakdown_reduces_to_price_times_count(self):
        # AC2/AC13 reduce-to-legacy: single default segment, multiplier 1.0.
        self.assertEqual(
            segment_food_total(Decimal('10'), [{'count': 150, 'price_multiplier': 1.0}]),
            Decimal('1500'),
        )

    def test_kids_priced_by_multiplier(self):
        # AC10: 138×10 + 12×10×0.5 = 1380 + 60 = 1440.
        segs = [
            {'count': 138, 'price_multiplier': 1.0},
            {'count': 12, 'price_multiplier': 0.5},
        ]
        self.assertEqual(segment_food_total(Decimal('10'), segs), Decimal('1440'))

    def test_vendor_additional_covers_added_at_multiplier(self):
        # AC11: vendors are billed too (counts_toward_total is irrelevant to price).
        segs = [
            {'count': 138, 'price_multiplier': 1.0, 'counts_toward_total': True},
            {'count': 12, 'price_multiplier': 0.5, 'counts_toward_total': True},
            {'count': 8, 'price_multiplier': 0.5, 'counts_toward_total': False},
        ]
        self.assertEqual(segment_food_total(Decimal('10'), segs), Decimal('1480'))

    def test_zero_price_is_zero(self):
        self.assertEqual(
            segment_food_total(Decimal('0'), [{'count': 100, 'price_multiplier': 1.0}]),
            Decimal('0.00'),
        )

    def test_half_cent_rounds_half_up_matching_frontend(self):
        # 1.01 × 0.5 × 1 = 0.505 → 0.51 (HALF_UP), NOT 0.50 (banker's/HALF_EVEN).
        # Locks FE/BE parity for the half-cent class the multipliers newly expose.
        self.assertEqual(
            segment_food_total(Decimal('1.01'), [{'count': 1, 'price_multiplier': '0.5'}]),
            Decimal('0.51'),
        )

    def test_missing_or_null_multiplier_defaults_to_one(self):
        self.assertEqual(segment_food_total(Decimal('10'), [{'count': 10}]), Decimal('100'))
        self.assertEqual(
            segment_food_total(Decimal('10'), [{'count': 10, 'price_multiplier': None}]),
            Decimal('100'),
        )


class SegmentFoodRowsTests(TestCase):
    """Itemized food lines (count × effective rate = amount), summing to subtotal."""

    def test_itemizes_multi_rate_and_sums_to_subtotal(self):
        rows = segment_food_rows(Decimal('10'), [
            {'name': 'Adults', 'count': 138, 'price_multiplier': '1.0'},
            {'name': 'Kids', 'count': 12, 'price_multiplier': '0.5'},
            {'name': 'Vendors', 'count': 8, 'price_multiplier': '0.5'},
        ])
        self.assertEqual(
            [(r['name'], r['count'], str(r['rate']), str(r['amount'])) for r in rows],
            [('Adults', 138, '10.00', '1380.00'),
             ('Kids', 12, '5.00', '60.00'),
             ('Vendors', 8, '5.00', '40.00')],
        )
        # The itemized amounts sum EXACTLY to segment_food_total (per-cover rounding).
        self.assertEqual(sum(r['amount'] for r in rows), Decimal('1480.00'))

    def test_none_when_single_rate_or_single_segment(self):
        # Gents/Ladies both 1.0 → one rate → no itemization (single line, byte-identical).
        self.assertIsNone(segment_food_rows(Decimal('10'), [
            {'name': 'Gents', 'count': 60, 'price_multiplier': '1.0'},
            {'name': 'Ladies', 'count': 40, 'price_multiplier': '1.0'},
        ]))
        # Count-only (one segment) → None.
        self.assertIsNone(segment_food_rows(
            Decimal('10'), [{'name': 'Adults', 'count': 150, 'price_multiplier': '1.0'}]))
        # No price → None.
        self.assertIsNone(segment_food_rows(Decimal('0'), [
            {'name': 'Adults', 'count': 138, 'price_multiplier': '1.0'},
            {'name': 'Kids', 'count': 12, 'price_multiplier': '0.5'},
        ]))


class SegmentFoodTotalModelTests(TestCase):
    """End-to-end AC10/AC11 through the real models — mirrored quote AND event."""

    def setUp(self):
        self.org = _make_org(slug='seg-pricing-org', country='US')
        # Control the segment multipliers exactly (drop whatever the signal seeded).
        GuestSegment.objects.filter(organisation=self.org).delete()
        self.adults = GuestSegment.objects.create(
            organisation=self.org, name='Adults', price_multiplier=Decimal('1.0'),
            is_default=True, counts_toward_total=True, sort_order=0,
        )
        self.kids = GuestSegment.objects.create(
            organisation=self.org, name='Kids', price_multiplier=Decimal('0.5'),
            counts_toward_total=True, sort_order=1,
        )
        self.vendors = GuestSegment.objects.create(
            organisation=self.org, name='Vendors', price_multiplier=Decimal('0.5'),
            counts_toward_total=False, sort_order=2,
        )
        self.contact = make_contact(org=self.org)

    def _add_rows(self, booking):
        parent = {'event': booking} if isinstance(booking, Event) else {'quote': booking}
        BookingGuestCount.objects.create(segment=self.adults, count=138, **parent)
        BookingGuestCount.objects.create(segment=self.kids, count=12, **parent)
        BookingGuestCount.objects.create(segment=self.vendors, count=8, **parent)

    def test_event_food_total_prices_kids_and_vendor_covers(self):
        ev = Event.objects.create(
            organisation=self.org, name='E', event_date='2026-05-01',
            guest_count=150, price_per_head=Decimal('10'),
        )
        self._add_rows(ev)
        # 138×10 + 12×10×0.5 + 8×10×0.5 = 1380 + 60 + 40 = 1480.
        self.assertEqual(ev.food_total, Decimal('1480.00'))

    def test_quote_food_total_mirrors_event(self):
        q = make_quote(
            org=self.org, primary_contact=self.contact,
            guest_count=150, price_per_head=Decimal('10'),
        )
        self._add_rows(q)
        self.assertEqual(q.food_total, Decimal('1480.00'))

    def test_no_rows_prices_whole_count_as_default_segment(self):
        # AC2: no breakdown → whole 150 under the default segment (mult 1.0).
        ev = Event.objects.create(
            organisation=self.org, name='E2', event_date='2026-05-01',
            guest_count=150, price_per_head=Decimal('10'),
        )
        self.assertEqual(ev.food_total, Decimal('1500.00'))

    def test_quote_pdf_renders_segment_priced_total(self):
        # Document rule: a US kids/vendor booking's quote PDF must show the
        # segment-priced food/subtotal (138×10 + 12×5 + 8×5 = 1,480), not 150×10.
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        from bookings.pdf import generate_quote_pdf
        q = make_quote(
            org=self.org, primary_contact=self.contact,
            guest_count=150, gents=0, ladies=0, price_per_head=Decimal('10'),
            is_taxable=False,
        )
        self._add_rows(q)
        q.recalculate_totals()
        q.refresh_from_db()
        text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(generate_quote_pdf(q))).pages)
        self.assertIn("1,480.00", text)              # segment-priced subtotal
        self.assertNotIn("1,500.00", text)           # NOT the flat price × count
        # Itemized per segment: Adults 138 × $10, Kids 12 × $5, Vendors 8 × $5.
        self.assertIn("138 × $10.00", text)
        self.assertIn("Kids", text)
        self.assertIn("12 × $5.00", text)
        self.assertIn("Vendors", text)

    def test_event_pdf_renders_segment_priced_total(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        from bookings.pdf import generate_event_pdf
        ev = Event.objects.create(
            organisation=self.org, name='E', event_date='2026-05-01',
            guest_count=150, gents=0, ladies=0, price_per_head=Decimal('10'),
        )
        self._add_rows(ev)
        ev.recalculate_totals()
        ev.refresh_from_db()
        text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(generate_event_pdf(ev))).pages)
        self.assertIn("1,480.00", text)
        self.assertNotIn("1,500.00", text)
        self.assertIn("138 × $10.00", text)
        self.assertIn("12 × $5.00", text)
