"""A booking may not be discounted below nothing.

A discount line item was never bounded by the value of the thing it discounts,
so a $100,000 discount on a $5,000 quote stored:

    subtotal        -95,000.00
    service charge  -19,000.00   <- 20% of a NEGATIVE subtotal, compounding it
    TOTAL          -114,000.00

and rendered a normal PDF with a negative GRAND TOTAL that could be sent to a
client. Two defects, fixed separately:

* percentage charges are no longer taken on a negative subtotal (engine change,
  pinned by the shared golden cases so both engines agree), and
* the save is rejected rather than persisted (here), inside the write's
  transaction so nothing is left behind.
"""
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Contact, Quote
from events.models import Event
from tests.base import get_test_user


class QuoteDiscountBoundsTests(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _post(self, discount):
        return self.client.post('/api/bookings/quotes/', {
            'primary_contact': self.contact.id,
            'event_date': '2026-09-01',
            'guest_count': 100,
            'price_per_head': '50',          # $5,000 of food
            'service_charge_pct': '20',
            'line_items': [{
                'category': 'discount', 'description': 'D', 'quantity': 1,
                'unit': 'flat', 'unit_price': discount,
            }],
        }, format='json')

    def test_a_discount_larger_than_the_booking_is_rejected(self):
        r = self._post('100000')
        self.assertEqual(r.status_code, 400)
        self.assertIn('line_items', r.data)

    def test_the_rejected_save_leaves_nothing_behind(self):
        before = Quote.objects.count()
        self._post('100000')
        self.assertEqual(Quote.objects.count(), before,
                         'a rejected save must roll back, not orphan a quote')

    def test_a_discount_down_to_exactly_zero_is_allowed(self):
        r = self._post('5000')
        self.assertEqual(r.status_code, 201, r.data)
        q = Quote.objects.get(id=r.data['id'])
        self.assertEqual(q.subtotal, Decimal('0.00'))
        self.assertEqual(q.service_charge, Decimal('0.00'))
        self.assertEqual(q.total, Decimal('0.00'))

    def test_a_legitimate_discount_still_reduces_the_service_charge_base(self):
        # Guard from the other side: the fix must not make discounts inert.
        r = self._post('500')
        self.assertEqual(r.status_code, 201, r.data)
        q = Quote.objects.get(id=r.data['id'])
        self.assertEqual(q.subtotal, Decimal('4500.00'))
        self.assertEqual(q.service_charge, Decimal('900.00'))  # 20% of 4,500

    def test_editing_an_existing_quote_into_the_negative_is_rejected(self):
        r = self._post('500')
        quote_id = r.data['id']
        before = Quote.objects.get(id=quote_id).total

        patch = self.client.patch(f'/api/bookings/quotes/{quote_id}/', {
            'line_items': [{
                'category': 'discount', 'description': 'D', 'quantity': 1,
                'unit': 'flat', 'unit_price': '100000',
            }],
        }, format='json')

        self.assertEqual(patch.status_code, 400)
        self.assertEqual(Quote.objects.get(id=quote_id).total, before,
                         'the rejected edit must not have changed the stored total')


class EventDiscountBoundsTests(TestCase):
    """The event mirror — same guard on the other booking type."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _post(self, discount):
        return self.client.post('/api/events/', {
            'name': 'E', 'date': '2026-09-01', 'primary_contact': self.contact.id,
            'guest_count': 100, 'price_per_head': '50', 'service_charge_pct': '20',
            'line_items': [{
                'category': 'discount', 'description': 'D', 'quantity': 1,
                'unit': 'flat', 'unit_price': discount,
            }],
        }, format='json')

    def test_a_discount_larger_than_the_event_is_rejected(self):
        before = Event.objects.count()
        r = self._post('100000')
        self.assertEqual(r.status_code, 400, r.data)
        self.assertEqual(Event.objects.count(), before)

    def test_a_legitimate_discount_is_accepted(self):
        r = self._post('500')
        self.assertEqual(r.status_code, 201, r.data)
        ev = Event.objects.get(id=r.data['id'])
        self.assertEqual(ev.subtotal, Decimal('4500.00'))
