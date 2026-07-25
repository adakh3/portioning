"""N-segment guest-breakdown write path (REL-415, AC3/AC4/AC7/AC15).

The count-first breakdown UI submits ``guest_counts: [{segment, count}]`` on both
quote and event. The backend persists BookingGuestCount rows, mirrors gents/ladies
into the legacy columns (data-driven), validates the in-count sum ≤ guest_count,
and returns the breakdown on read (round-trip).
"""
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models.quotes import Quote
from bookings.tests import make_contact, make_quote
from events.models import Event, BookingGuestCount
from rules.models import GuestSegment
from tests.base import get_test_user


class _Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        # A US-style Adults/Kids/Vendors org (replace whatever was seeded).
        GuestSegment.objects.filter(organisation=self.org).delete()
        self.adults = GuestSegment.objects.create(
            organisation=self.org, name='Adults', is_default=True,
            price_multiplier=Decimal('1.0'), counts_toward_total=True, sort_order=0)
        self.kids = GuestSegment.objects.create(
            organisation=self.org, name='Kids',
            price_multiplier=Decimal('0.5'), counts_toward_total=True, sort_order=1)
        self.vendors = GuestSegment.objects.create(
            organisation=self.org, name='Vendors',
            price_multiplier=Decimal('0.5'), counts_toward_total=False, sort_order=2)
        self.contact = make_contact(org=self.org)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    BREAKDOWN = [
        {'segment': 'Adults', 'count': 138},
        {'segment': 'Kids', 'count': 12},
        {'segment': 'Vendors', 'count': 8},
    ]


class EventBreakdownTests(_Base):
    def _post(self, **payload):
        base = {'name': 'E', 'date': '2026-05-01'}
        base.update(payload)
        return self.client.post('/api/events/', base, format='json')

    def test_event_breakdown_writes_rows(self):  # AC4
        res = self._post(guest_count=150, price_per_head='10',
                         guest_counts=self.BREAKDOWN)
        self.assertEqual(res.status_code, 201, res.content)
        ev = Event.objects.get(id=res.json()['id'])
        rows = {r.segment.name: r.count for r in ev.guest_counts.all()}
        self.assertEqual(rows, {'Adults': 138, 'Kids': 12, 'Vendors': 8})
        # No gents/ladies segments in this org → legacy columns untouched.
        self.assertEqual((ev.gents, ev.ladies), (0, 0))
        # Priced by multiplier: 138×10 + 12×5 + 8×5 = 1480.
        self.assertEqual(ev.food_total, Decimal('1480.00'))

    def test_event_per_segment_price_override_persists_and_prices(self):
        # Kids at a flat $18/head overrides the 0.5 multiplier; food reflects it.
        res = self._post(guest_count=150, price_per_head='10', guest_counts=[
            {'segment': 'Adults', 'count': 138},
            {'segment': 'Kids', 'count': 12, 'price_per_head': '18.00'},
            {'segment': 'Vendors', 'count': 8},
        ])
        self.assertEqual(res.status_code, 201, res.content)
        ev = Event.objects.get(id=res.json()['id'])
        kids = ev.guest_counts.get(segment__name='Kids')
        self.assertEqual(str(kids.price_per_head), '18.00')
        # 138×10 + 12×18 + 8×5 = 1380 + 216 + 40 = 1636.
        self.assertEqual(ev.food_total, Decimal('1636.00'))
        # Read returns the override so the form can rehydrate it.
        data = self.client.get(f'/api/events/{ev.id}/').json()
        kids_row = next(r for r in data['guest_counts'] if r['segment'] == 'Kids')
        self.assertEqual(kids_row['price_per_head'], '18.00')

    def test_default_segment_override_is_ignored_even_via_raw_api(self):
        # The default (Adults) segment must always use the base price/head — a raw
        # API / agent payload trying to override it is dropped, so the stored total
        # can't diverge from the live preview.
        res = self._post(guest_count=150, price_per_head='10', guest_counts=[
            {'segment': 'Adults', 'count': 138, 'price_per_head': '99'},  # attempt override
            {'segment': 'Kids', 'count': 12},
        ])
        self.assertEqual(res.status_code, 201, res.content)
        ev = Event.objects.get(id=res.json()['id'])
        self.assertIsNone(ev.guest_counts.get(segment__name='Adults').price_per_head)
        # Priced at base (138×10 + 12×5 = 1440), NOT 138×99.
        self.assertEqual(ev.food_total, Decimal('1440.00'))

    def test_event_read_returns_breakdown(self):  # AC15 round-trip
        ev_id = self._post(guest_count=150, price_per_head='10',
                           guest_counts=self.BREAKDOWN).json()['id']
        data = self.client.get(f'/api/events/{ev_id}/').json()
        got = {r['segment']: r['count'] for r in data['guest_counts']}
        self.assertEqual(got, {'Adults': 138, 'Kids': 12, 'Vendors': 8})

    def test_event_breakdown_over_count_is_rejected(self):  # AC3
        res = self._post(guest_count=150, price_per_head='10', guest_counts=[
            {'segment': 'Adults', 'count': 150},
            {'segment': 'Kids', 'count': 10},  # in-count 160 > 150
        ])
        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn('guest_counts', res.json())

    def test_event_vendor_covers_do_not_count_toward_limit(self):  # AC3/AC4
        # 150 in-count + 8 vendor covers is fine (vendors excluded from the limit).
        res = self._post(guest_count=150, price_per_head='10', guest_counts=[
            {'segment': 'Adults', 'count': 138},
            {'segment': 'Kids', 'count': 12},
            {'segment': 'Vendors', 'count': 8},
        ])
        self.assertEqual(res.status_code, 201, res.content)


class QuoteBreakdownTests(_Base):
    def _post(self, **payload):
        base = {'primary_contact': self.contact.id, 'event_date': '2026-05-01'}
        base.update(payload)
        return self.client.post('/api/bookings/quotes/', base, format='json')

    def test_quote_breakdown_dual_writes_rows(self):  # AC7
        res = self._post(guest_count=150, price_per_head='10',
                         guest_counts=self.BREAKDOWN)
        self.assertEqual(res.status_code, 201, res.content)
        q = Quote.objects.get(id=res.json()['id'])
        rows = {r.segment.name: r.count for r in q.guest_counts.all()}
        self.assertEqual(rows, {'Adults': 138, 'Kids': 12, 'Vendors': 8})
        self.assertEqual(q.food_total, Decimal('1480.00'))

    def test_quote_edit_updates_rows(self):  # AC7 (edit)
        q_id = self._post(guest_count=150, price_per_head='10',
                          guest_counts=self.BREAKDOWN).json()['id']
        res = self.client.patch(f'/api/bookings/quotes/{q_id}/', {
            'guest_counts': [{'segment': 'Adults', 'count': 150}],
        }, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        q = Quote.objects.get(id=q_id)
        rows = {r.segment.name: r.count for r in q.guest_counts.all()}
        self.assertEqual(rows, {'Adults': 150})

    def test_quote_read_returns_breakdown(self):  # AC15 round-trip
        q_id = self._post(guest_count=150, price_per_head='10',
                          guest_counts=self.BREAKDOWN).json()['id']
        data = self.client.get(f'/api/bookings/quotes/{q_id}/').json()
        got = {r['segment']: r['count'] for r in data['guest_counts']}
        self.assertEqual(got, {'Adults': 138, 'Kids': 12, 'Vendors': 8})


class GentsLadiesMirrorTests(TestCase):
    """A gents/ladies org uses the same breakdown path; the counts mirror into the
    legacy columns so PDFs still render '60 gents / 40 ladies' (AC5, data-driven)."""

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        GuestSegment.objects.filter(organisation=self.org).delete()
        GuestSegment.objects.create(
            organisation=self.org, name='ladies', is_default=False,
            price_multiplier=Decimal('1.0'), sort_order=1)
        GuestSegment.objects.create(
            organisation=self.org, name='gents', is_default=True,
            price_multiplier=Decimal('1.0'), sort_order=0)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_breakdown_mirrors_into_legacy_columns(self):
        res = self.client.post('/api/events/', {
            'name': 'E', 'date': '2026-05-01', 'guest_count': 100,
            'guest_counts': [{'segment': 'gents', 'count': 60},
                             {'segment': 'ladies', 'count': 40}],
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        ev = Event.objects.get(id=res.json()['id'])
        self.assertEqual((ev.gents, ev.ladies), (60, 40))


class BackfillMigrationTests(TestCase):
    """Complementary backfill (migration 0029): genuine splits without rows get
    rows; count-only bookings do not; idempotent. AC8/AC9."""

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        GuestSegment.objects.filter(organisation=self.org).delete()
        GuestSegment.objects.create(
            organisation=self.org, name='gents', is_default=True, sort_order=0)
        GuestSegment.objects.create(
            organisation=self.org, name='ladies', sort_order=1)

    def _run_backfill(self):
        from importlib import import_module
        from django.apps import apps as global_apps
        mod = import_module('events.migrations.0029_backfill_split_guest_counts')
        mod.backfill(global_apps, None)

    def _event(self, **kw):
        base = dict(organisation=self.org, name='E', event_date='2026-05-01')
        base.update(kw)
        ev = Event.objects.create(**base)
        ev.guest_counts.all().delete()  # start from the pre-backfill state
        return ev

    def test_genuine_split_backfilled(self):  # AC8
        ev = self._event(guest_count=100, gents=60, ladies=40)
        self._run_backfill()
        rows = {r.segment.name: r.count for r in ev.guest_counts.all()}
        self.assertEqual(rows, {'gents': 60, 'ladies': 40})

    def test_count_only_not_backfilled(self):  # AC9
        ev = self._event(guest_count=100, gents=0, ladies=0)
        self._run_backfill()
        self.assertEqual(ev.guest_counts.count(), 0)

    def test_partial_split_not_backfilled(self):  # AC9 (doesn't add up)
        ev = self._event(guest_count=100, gents=60, ladies=0)  # 60 != 100
        self._run_backfill()
        self.assertEqual(ev.guest_counts.count(), 0)

    def test_idempotent(self):
        ev = self._event(guest_count=100, gents=60, ladies=40)
        self._run_backfill()
        self._run_backfill()
        self.assertEqual(ev.guest_counts.count(), 2)

    def test_quote_genuine_split_backfilled(self):  # AC8 (quote)
        q = make_quote(org=self.org, guest_count=100, gents=60, ladies=40)
        q.guest_counts.all().delete()
        self._run_backfill()
        rows = {r.segment.name: r.count for r in q.guest_counts.all()}
        self.assertEqual(rows, {'gents': 60, 'ladies': 40})
