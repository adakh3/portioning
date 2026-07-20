"""Stage-2 read-path + dual-write tests for guest segments.

Covers: portioning_guests resolving BookingGuestCount rows, additional covers
(vendors) counting toward portioning but not the guest count, the count-first
fallback to the org's default segment, and the dual-write that keeps
BookingGuestCount in sync with the legacy gents/ladies columns.
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user
from events.models import Event, BookingGuestCount
from rules.models import GuestSegment


class PortioningReadPathTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation

    def _segment(self, name, mult=1.0, counts=True, default=False, order=0):
        return GuestSegment.objects.create(
            organisation=self.org, name=name, portion_multiplier=mult,
            counts_toward_total=counts, is_default=default, sort_order=order,
        )

    def _event(self, **kw):
        base = dict(organisation=self.org, name='E', event_date='2026-05-01')
        base.update(kw)
        return Event.objects.create(**base)

    def test_portioning_reads_per_segment_rows(self):
        adults = self._segment('Adults', 1.0, default=True, order=0)
        kids = self._segment('Kids', 0.6, order=1)
        ev = self._event(guest_count=140)
        BookingGuestCount.objects.create(event=ev, segment=adults, count=100)
        BookingGuestCount.objects.create(event=ev, segment=kids, count=40)

        segs = ev.portioning_guests()['segments']
        by_name = {s['name']: s for s in segs}
        self.assertEqual(by_name['Adults']['count'], 100)
        self.assertEqual(by_name['Kids']['count'], 40)
        self.assertEqual(by_name['Kids']['portion_multiplier'], 0.6)

    def test_additional_covers_portioned_but_not_in_the_guest_count(self):
        adults = self._segment('Adults', 1.0, counts=True, default=True, order=0)
        vendors = self._segment('Vendors', 1.0, counts=False, order=1)
        ev = self._event(guest_count=150)
        BookingGuestCount.objects.create(event=ev, segment=adults, count=150)
        BookingGuestCount.objects.create(event=ev, segment=vendors, count=8)

        segs = ev.portioning_guests()['segments']
        total_covers = sum(s['count'] for s in segs)
        in_count = sum(s['count'] for s in segs if s['counts_toward_total'])
        self.assertEqual(total_covers, 158)   # portions computed over all covers
        self.assertEqual(in_count, 150)        # vendors excluded from the count
        self.assertEqual(ev.guest_count, 150)  # headline number unchanged

    def test_no_rows_no_split_falls_back_to_default_segment(self):
        default = self._segment('Adults', 1.0, default=True)
        self._segment('Kids', 0.6, order=1)
        ev = self._event(guest_count=120)  # no rows, no gents/ladies split

        segs = ev.portioning_guests()['segments']
        self.assertEqual(segs, [{
            'name': 'Adults', 'count': 120,
            'portion_multiplier': 1.0, 'counts_toward_total': True,
        }])
        self.assertTrue(default.is_default)


class DualWriteTests(TestCase):
    """Editing gents/ladies via the API mirrors into BookingGuestCount rows."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        # A desi org: seed_data already defines gents/ladies segments.
        self.gents = GuestSegment.objects.get(organisation=self.org, name='gents')
        self.ladies = GuestSegment.objects.get(organisation=self.org, name='ladies')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _post(self, **payload):
        base = {'name': 'G', 'date': '2026-05-01'}
        base.update(payload)
        return self.client.post('/api/events/', base, format='json')

    def test_creating_with_a_split_writes_both_rows_and_columns(self):
        res = self._post(guest_count=100, gents=60, ladies=40)
        self.assertEqual(res.status_code, 201, res.content)
        ev = Event.objects.get(id=res.json()['id'])
        # legacy columns still set (deprecated, kept in sync)
        self.assertEqual((ev.gents, ev.ladies), (60, 40))
        # rows mirror them
        rows = {r.segment.name: r.count for r in ev.guest_counts.all()}
        self.assertEqual(rows, {'gents': 60, 'ladies': 40})

    def test_editing_the_split_updates_the_rows(self):
        ev_id = self._post(guest_count=100, gents=60, ladies=40).json()['id']
        res = self.client.patch(
            f'/api/events/{ev_id}/', {'gents': 70, 'ladies': 30}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        ev = Event.objects.get(id=ev_id)
        rows = {r.segment.name: r.count for r in ev.guest_counts.all()}
        self.assertEqual(rows, {'gents': 70, 'ladies': 30})

    def test_removing_the_split_clears_the_rows(self):
        ev_id = self._post(guest_count=100, gents=60, ladies=40).json()['id']
        # Drop the split back to a bare count (count-first).
        res = self.client.patch(
            f'/api/events/{ev_id}/',
            {'guest_count': 100, 'gents': 0, 'ladies': 0}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        ev = Event.objects.get(id=ev_id)
        self.assertEqual(ev.guest_counts.count(), 0)
