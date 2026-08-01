"""Rate fields must refuse values that corrupt the money.

`guest_count` and `price_per_head` already carried validators; `tax_rate`,
`service_charge_pct` and `gratuity_pct` carried none. The API therefore accepted
a NEGATIVE tax (a tax that pays the customer), a 150% tax, and negative service
charge / gratuity — each recomputed the stored totals and rendered happily into
a sendable PDF:

    tax_rate = -0.20      -> tax  -$1,200 on a $5,000 quote
    tax_rate =  1.50      -> tax  +$9,000
    service_charge_pct=-20-> charge -$1,000
    gratuity_pct = -10    -> gratuity -$500

Mirrored on quote and event, because both models own the same three fields.
"""
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Contact, Quote
from tests.base import get_test_user


class RateBoundsApiTests(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _post(self, **overrides):
        body = {
            'primary_contact': self.contact.id,
            'event_date': '2026-09-01',
            'guest_count': 100,
            'price_per_head': '50',
        }
        body.update(overrides)
        return self.client.post('/api/bookings/quotes/', body, format='json')

    def test_a_negative_tax_rate_is_rejected(self):
        self.assertEqual(self._post(tax_rate='-0.20').status_code, 400)

    def test_a_tax_rate_over_100_percent_is_rejected(self):
        self.assertEqual(self._post(tax_rate='1.50').status_code, 400)

    def test_a_negative_service_charge_is_rejected(self):
        self.assertEqual(self._post(service_charge_pct='-20').status_code, 400)

    def test_a_service_charge_over_100_percent_is_rejected(self):
        self.assertEqual(self._post(service_charge_pct='150').status_code, 400)

    def test_a_negative_gratuity_is_rejected(self):
        self.assertEqual(self._post(gratuity_pct='-10').status_code, 400)

    def test_legitimate_rates_still_save(self):
        # The bounds must not block real US values, including fractional tax.
        r = self._post(tax_rate='0.0850', service_charge_pct='20', gratuity_pct='18')
        self.assertEqual(r.status_code, 201, r.data)
        q = Quote.objects.get(id=r.data['id'])
        self.assertEqual(q.tax_rate, Decimal('0.0850'))
        self.assertEqual(q.service_charge_pct, Decimal('20'))
        self.assertEqual(q.gratuity_pct, Decimal('18'))

    def test_the_boundaries_themselves_are_allowed(self):
        self.assertEqual(self._post(tax_rate='0', service_charge_pct='0',
                                    gratuity_pct='0').status_code, 201)
        self.assertEqual(self._post(tax_rate='1', service_charge_pct='100',
                                    gratuity_pct='100').status_code, 201)


class EventRateBoundsTests(TestCase):
    """The event mirror — same three fields, same bounds."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation

    def _event(self, **kw):
        from django.core.exceptions import ValidationError

        from events.models import Event
        ev = Event(organisation=self.org, name='E', event_date='2026-09-01',
                   guest_count=10, **kw)
        try:
            ev.full_clean(exclude=['created_by', 'assigned_to', 'primary_contact',
                                   'account', 'venue', 'product', 'based_on_template'])
            return None
        except ValidationError as e:
            return e.message_dict

    def test_negative_and_over_range_rates_fail_validation(self):
        self.assertIn('tax_rate', self._event(tax_rate=Decimal('-0.2')) or {})
        self.assertIn('tax_rate', self._event(tax_rate=Decimal('1.5')) or {})
        self.assertIn('service_charge_pct', self._event(service_charge_pct=Decimal('-20')) or {})
        self.assertIn('gratuity_pct', self._event(gratuity_pct=Decimal('-10')) or {})

    def test_a_legitimate_fractional_rate_passes(self):
        errs = self._event(tax_rate=Decimal('0.0850'), service_charge_pct=Decimal('20'),
                           gratuity_pct=Decimal('18')) or {}
        for field in ('tax_rate', 'service_charge_pct', 'gratuity_pct'):
            self.assertNotIn(field, errs)
