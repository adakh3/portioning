"""Accepting a quote must hand the event the WHOLE pricing snapshot.

``accept_quote`` copied ``tax_rate``/``is_taxable`` but not the service charge or
gratuity, so the event recomputed those at 0% and its total silently came out below
the quote the customer accepted — by the entire service charge (20% by default for a
US org). The existing total-preservation test only exercised the OFF state (a quote
with no service charge), which is why it stayed green.

Same failure family as the guest-breakdown drop fixed in REL-426: the conversion
loses a field and the money quietly changes.
"""
from decimal import Decimal

from django.test import TestCase

from bookings.models import Contact, Quote
from bookings.services.quote_acceptance import accept_quote
from tests.base import get_test_user


class QuoteAcceptancePricingTests(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')

    def _quote(self, **kwargs):
        # Tax off by default so each assertion below isolates the service
        # charge / gratuity arithmetic; the taxable combination gets its own test.
        fields = dict(
            organisation=self.org, primary_contact=self.contact,
            event_date='2026-05-01', guest_count=100, price_per_head=Decimal('50'),
            is_taxable=False, tax_rate=Decimal('0'),
        )
        fields.update(kwargs)
        quote = Quote.objects.create(**fields)
        quote.recalculate_totals()
        quote.refresh_from_db()
        return quote

    def test_service_charge_and_gratuity_carry_to_the_event(self):
        quote = self._quote(
            service_charge_pct=Decimal('20'), service_charge_taxable=True,
            gratuity_pct=Decimal('5'),
        )
        # Guard the fixture: the charge is really ON, so this is not the 0% path.
        self.assertEqual(quote.service_charge, Decimal('1000.00'))  # 20% of 5000
        self.assertEqual(quote.total, Decimal('6250.00'))           # + 5% gratuity

        event = accept_quote(quote, user=self.user)

        self.assertEqual(event.service_charge_pct, Decimal('20'))
        self.assertEqual(event.service_charge_taxable, True)
        self.assertEqual(event.gratuity_pct, Decimal('5'))
        self.assertEqual(event.service_charge, Decimal('1000.00'))
        self.assertEqual(event.gratuity, Decimal('250.00'))
        # The whole point: the accepted number is what the event is worth.
        self.assertEqual(event.total, quote.total)

    def test_a_non_taxable_service_charge_carries_its_taxable_flag(self):
        quote = self._quote(
            is_taxable=True, tax_rate=Decimal('0.1000'),
            service_charge_pct=Decimal('20'), service_charge_taxable=False,
        )
        event = accept_quote(quote, user=self.user)

        self.assertEqual(event.service_charge_taxable, False)
        # Tax is charged on the subtotal only, not on the service charge.
        self.assertEqual(event.tax_amount, Decimal('500.00'))
        self.assertEqual(event.total, quote.total)
        self.assertEqual(event.total, Decimal('6500.00'))  # 5000 + 1000 sc + 500 tax

    def test_a_quote_with_no_service_charge_is_unchanged(self):
        # The OFF state the original test covered — must stay byte-identical.
        quote = self._quote()
        event = accept_quote(quote, user=self.user)

        self.assertEqual(event.service_charge_pct, Decimal('0'))
        self.assertEqual(event.gratuity_pct, Decimal('0'))
        self.assertEqual(event.service_charge, Decimal('0.00'))
        self.assertEqual(event.total, quote.total)
        self.assertEqual(event.total, Decimal('5000.00'))
