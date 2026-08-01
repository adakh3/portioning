"""A booking too large to store must say so, not crash.

Every input passed its own validator — `price_per_head` up to 9,999,999.99,
`guest_count` up to 50,000, a per-guest `unit_price` up to 9,999.99 — but nothing
checked their **product** against the column that has to hold it:

    price_per_head 9,999,999.99 x 50,000 guests -> 499,999,999,500.00
        ...into DecimalField(12, 2), max 9,999,999,999.99          -> HTTP 500
    per-guest item 9,999.99 x 50,000 guests     ->     499,999,500.00
        ...into line_total DecimalField(10, 2), max 99,999,999.99  -> HTTP 500

The second is the sharper trap: a line item's `line_total` column is two orders
of magnitude smaller than the booking's, and `BookingLineItem.save()`
recalculates its parent, so the overflow fired *mid-write* — the value went into
sqlite and then blew up on the way back out (`decimal.InvalidOperation` in
Django's sqlite converter). Checking the inputs up front means no partial write.

The numbers are absurd; "absurd" should read back as a validation message.
"""
from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Contact, Quote
from events.models import Event
from tests.base import get_test_user


class QuoteOverflowTests(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _post(self, **overrides):
        body = {'primary_contact': self.contact.id, 'event_date': '2026-09-01',
                'guest_count': 100, 'price_per_head': '50'}
        body.update(overrides)
        return self.client.post('/api/bookings/quotes/', body, format='json')

    def test_price_per_head_times_guests_overflowing_the_booking_is_a_400(self):
        r = self._post(guest_count=50000, price_per_head='9999999.99')
        self.assertEqual(r.status_code, 400)
        self.assertIn('price_per_head', r.data)

    def test_a_per_guest_line_overflowing_line_total_is_a_400(self):
        r = self._post(guest_count=50000, line_items=[{
            'category': 'food', 'description': 'X', 'quantity': 1,
            'unit': 'per_guest', 'unit_price': '9999.99',
        }])
        self.assertEqual(r.status_code, 400)
        self.assertIn('line_items', r.data)

    def test_the_rejected_save_leaves_nothing_behind(self):
        before = Quote.objects.count()
        self._post(guest_count=50000, price_per_head='9999999.99')
        self._post(guest_count=50000, line_items=[{
            'category': 'food', 'description': 'X', 'quantity': 1,
            'unit': 'per_guest', 'unit_price': '9999.99',
        }])
        self.assertEqual(Quote.objects.count(), before)

    def test_a_large_but_storable_booking_still_saves(self):
        # 50,000 guests x $50 = $2.5m — big, legitimate, and well within the column.
        r = self._post(guest_count=50000, price_per_head='50')
        self.assertEqual(r.status_code, 201, r.data)

    def test_a_large_but_storable_per_guest_line_still_saves(self):
        # $1,000 x 50,000 = $50m, inside line_total's 99,999,999.99.
        r = self._post(guest_count=50000, price_per_head='1', line_items=[{
            'category': 'food', 'description': 'X', 'quantity': 1,
            'unit': 'per_guest', 'unit_price': '1000',
        }])
        self.assertEqual(r.status_code, 201, r.data)

    def test_the_existing_field_bounds_still_apply(self):
        self.assertEqual(self._post(guest_count=50001).status_code, 400)
        self.assertEqual(self._post(guest_count=0).status_code, 400)
        self.assertEqual(self._post(price_per_head='-1').status_code, 400)


class EventOverflowTests(TestCase):
    """The event mirror — same guard, same two columns."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _post(self, **overrides):
        body = {'name': 'E', 'date': '2026-09-01', 'primary_contact': self.contact.id,
                'guest_count': 100, 'price_per_head': '50'}
        body.update(overrides)
        return self.client.post('/api/events/', body, format='json')

    def test_an_unstorable_event_is_a_400_and_creates_nothing(self):
        before = Event.objects.count()
        r = self._post(guest_count=50000, price_per_head='9999999.99')
        self.assertEqual(r.status_code, 400, r.data)
        self.assertEqual(Event.objects.count(), before)

    def test_a_large_but_storable_event_still_saves(self):
        self.assertEqual(self._post(guest_count=50000, price_per_head='50').status_code,
                         201)
