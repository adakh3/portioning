"""Segment-aware per-head pricing (REL-415, AC10/AC11).

Food is priced ``price_per_head × price_multiplier × count`` summed over **all**
segments — in-count (Adults, Kids) and additional covers (Vendors) alike. With no
breakdown it reduces to ``price_per_head × guest_count`` (proven byte-identical by
test_legacy_org_snapshot). Mirrored on quote AND event (the single resolver +
``segment_food_total`` feed both).
"""
from decimal import Decimal

from django.test import TestCase

from bookings.models.quotes import Quote
from bookings.services.totals import segment_food_total
from bookings.tests import _make_org, make_contact, make_quote
from events.models import Event, BookingGuestCount
from rules.models import GuestSegment


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

    def test_missing_or_null_multiplier_defaults_to_one(self):
        self.assertEqual(segment_food_total(Decimal('10'), [{'count': 10}]), Decimal('100'))
        self.assertEqual(
            segment_food_total(Decimal('10'), [{'count': 10, 'price_multiplier': None}]),
            Decimal('100'),
        )


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
