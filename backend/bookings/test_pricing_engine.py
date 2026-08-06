"""Pricing engine v2 — raw inputs in, every printable number out (REL-463).

The engine used to take pre-chewed inputs: a `food_total` someone else summed and
line items whose `line_total` someone else computed. So real arithmetic lived out on
the surfaces — meals math duplicated in both models, line math in the line-item
model, and the quote PDF deriving its own pre-tax total. Every fragment is a place
the printed number can drift from the stored one.

These tests pin the widened contract: one call, from raw material, returning
everything anybody prints.
"""
from decimal import Decimal

from django.test import TestCase

from bookings.models import Contact, Quote
from bookings.models.addons import BookingLineItem
from bookings.models.quotes import LineItemCategory, LineItemUnit
from bookings.services import totals as totals_module
from bookings.services.booking_pricing import pricing_input_for
from bookings.services.totals import PricingInput, line_item_total, price_booking
from events.models import BookingGuestCount, BookingMeal, Event, resolve_booking_segments
from rules.models import GuestSegment
from tests.base import get_test_user


class PriceBookingContractTests(TestCase):
    """AC1 — one call returns every number, with no arithmetic left for the caller."""

    def test_a_full_booking_returns_every_printable_number(self):
        result = price_booking(PricingInput(
            price_per_head=Decimal('100'),
            guest_count=100,
            segments=(
                {'name': 'Adults', 'count': 80, 'price_multiplier': Decimal('1.0')},
                {'name': 'Kids', 'count': 20, 'price_multiplier': Decimal('0.5')},
            ),
            meals=({'label': 'Canapés', 'price_per_head': Decimal('10'), 'guest_count': 30},),
            line_items=(
                {'category': 'food', 'unit': 'per_guest', 'quantity': Decimal('1'),
                 'unit_price': Decimal('6.00'), 'description': 'Late night'},
                {'category': 'discount', 'unit': 'flat', 'quantity': Decimal('1'),
                 'unit_price': Decimal('50.00'), 'description': 'Goodwill'},
            ),
            tax_rate=Decimal('0.08'),
            service_charge_pct=Decimal('20'),
            service_charge_taxable=True,
            gratuity_pct=Decimal('15'),
        ))

        # Food: itemized per segment, then the meal, then the sum.
        self.assertEqual(result.food['food_rows'], [
            {'name': 'Adults', 'count': 80, 'rate': Decimal('100.00'), 'amount': Decimal('8000.00')},
            {'name': 'Kids', 'count': 20, 'rate': Decimal('50.00'), 'amount': Decimal('1000.00')},
        ])
        self.assertEqual(result.food['menu_food'], Decimal('9000.00'))
        self.assertEqual(result.food['meal_rows'], [
            {'label': 'Canapés', 'count': 30, 'rate': Decimal('10.00'), 'amount': Decimal('300.00')},
        ])
        self.assertEqual(result.food['meals_food'], Decimal('300.00'))
        self.assertEqual(result.food['food_total'], Decimal('9300.00'))

        # Lines: echoed with their computed totals. per_guest uses guest_count (100),
        # NOT the quantity — $6 × 100 = $600.
        self.assertEqual(
            [line['line_total'] for line in result.lines['items']],
            [Decimal('600.00'), Decimal('-50.00')],
        )
        self.assertEqual(result.lines['add_ons_subtotal'], Decimal('550.00'))

        # Totals: the whole pipeline, including the pre-tax total the PDF invented.
        self.assertEqual(result.totals['subtotal'], Decimal('9850.00'))
        self.assertEqual(result.totals['charge_base'], Decimal('9850.00'))
        self.assertEqual(result.totals['service_charge'], Decimal('1970.00'))
        self.assertEqual(result.totals['pre_tax_total'], Decimal('11820.00'))
        self.assertEqual(result.totals['tax_base'], Decimal('11820.00'))
        self.assertEqual(result.totals['tax_amount'], Decimal('945.60'))
        self.assertEqual(result.totals['gratuity'], Decimal('1477.50'))
        self.assertEqual(result.totals['total'], Decimal('14243.10'))

        # Rates echoed, so a document can print "20% service charge" without
        # reaching back to the booking.
        self.assertEqual(result.rates['service_charge_pct'], Decimal('20'))
        self.assertEqual(result.rates['gratuity_pct'], Decimal('15'))
        self.assertEqual(result.rates['tax_rate'], Decimal('0.08'))
        self.assertTrue(result.rates['service_charge_taxable'])

    def test_the_total_is_the_sum_of_its_published_parts(self):
        """Whatever the inputs, the printed parts must add up to the printed total —
        otherwise a document shows a total its own rows don't justify."""
        result = price_booking(PricingInput(
            price_per_head=Decimal('33.33'), guest_count=7,
            segments=({'name': 'Adults', 'count': 7, 'price_multiplier': Decimal('1.0')},),
            tax_rate=Decimal('0.075'), service_charge_pct=Decimal('18'),
            gratuity_pct=Decimal('12'),
        ))
        t = result.totals
        self.assertEqual(
            t['total'], t['subtotal'] + t['service_charge'] + t['tax_amount'] + t['gratuity'])
        self.assertEqual(t['pre_tax_total'], t['subtotal'] + t['service_charge'])

    def test_the_result_serializes_without_floats(self):
        """`to_dict` is what the preview endpoint and the stored snapshot will send.
        A float would reintroduce the drift this engine exists to remove."""
        result = price_booking(PricingInput(
            price_per_head=Decimal('100'), guest_count=10,
            segments=({'name': 'Adults', 'count': 10, 'price_multiplier': Decimal('1.0')},),
            tax_rate=Decimal('0.08'),
        ))
        data = result.to_dict()
        self.assertEqual(data['totals']['subtotal'], '1000.00')
        self.assertEqual(data['totals']['tax_amount'], '80.00')

        def assert_no_floats(node, path='root'):
            if isinstance(node, dict):
                for k, v in node.items():
                    assert_no_floats(v, f'{path}.{k}')
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    assert_no_floats(v, f'{path}[{i}]')
            else:
                self.assertNotIsInstance(node, float, path)

        assert_no_floats(data)

    def test_a_meal_nobody_eats_is_not_a_row(self):
        """A zero-count or unpriced meal is left out entirely rather than printed as
        a £0.00 line on the customer's quote."""
        result = price_booking(PricingInput(
            price_per_head=Decimal('0'), guest_count=0,
            meals=(
                {'label': 'Cancelled', 'price_per_head': Decimal('10'), 'guest_count': 0},
                {'label': 'Free', 'price_per_head': Decimal('0'), 'guest_count': 20},
                {'label': 'Real', 'price_per_head': Decimal('5'), 'guest_count': 4},
            ),
        ))
        self.assertEqual([r['label'] for r in result.food['meal_rows']], ['Real'])
        self.assertEqual(result.food['meals_food'], Decimal('20.00'))


class LineMathIsSingleSourcedTests(TestCase):
    """AC2 — the model stores the answer; the engine decides it."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.quote = Quote.objects.create(
            organisation=self.org, event_date='2026-05-01', guest_count=10,
            price_per_head=Decimal('0'), is_taxable=False, tax_rate=Decimal('0'),
            primary_contact=Contact.objects.create(organisation=self.org, name='C'),
        )

    def test_saving_a_line_calls_the_engine(self):
        """Asserted by interception, not by value: matching numbers would also pass
        if the model kept its own copy of the rule, which is how the two drifted."""
        calls = []
        real = totals_module.line_item_total

        def spy(*args, **kwargs):
            calls.append((args, kwargs))
            return real(*args, **kwargs)

        totals_module.line_item_total = spy
        try:
            line = BookingLineItem.objects.create(
                quote=self.quote, category=LineItemCategory.RENTAL, description='Chairs',
                quantity=Decimal('3'), unit=LineItemUnit.EACH, unit_price=Decimal('5'),
            )
        finally:
            totals_module.line_item_total = real

        self.assertTrue(calls, 'BookingLineItem.save did not go through the engine')
        self.assertEqual(line.line_total, Decimal('15.00'))


class ModelsDelegateToTheEngineTests(TestCase):
    """AC3 — a quote and an event with identical inputs store identical money."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        GuestSegment.objects.filter(organisation=self.org).update(is_default=False)
        self.adults = GuestSegment.objects.create(
            organisation=self.org, name='Adults463', is_default=True,
            counts_toward_total=True, sort_order=0)
        self.kids = GuestSegment.objects.create(
            organisation=self.org, name='Kids463', counts_toward_total=True,
            price_multiplier=Decimal('0.5000'), portion_multiplier=0.6, sort_order=1)

    def _both(self):
        common = dict(
            organisation=self.org, event_date='2026-05-01', guest_count=100,
            price_per_head=Decimal('100'), is_taxable=True, tax_rate=Decimal('0.08'),
            service_charge_pct=Decimal('20'), service_charge_taxable=True,
            gratuity_pct=Decimal('15'),
        )
        quote = Quote.objects.create(
            primary_contact=Contact.objects.create(organisation=self.org, name='C'), **common)
        event = Event.objects.create(name='E', status='confirmed', **common)
        for booking in (quote, event):
            parent = {'quote': booking} if isinstance(booking, Quote) else {'event': booking}
            BookingGuestCount.objects.create(segment=self.adults, count=80, **parent)
            BookingGuestCount.objects.create(segment=self.kids, count=20, **parent)
            BookingMeal.objects.create(
                label='Canapés', guest_count=30, price_per_head=Decimal('10'), **parent)
            BookingLineItem.objects.create(
                category=LineItemCategory.FOOD, description='Late night',
                quantity=Decimal('1'), unit=LineItemUnit.PER_GUEST,
                unit_price=Decimal('6.00'), **parent)
            booking.recalculate_totals()
            booking.refresh_from_db()
        return quote, event

    def test_a_quote_and_an_event_agree_field_for_field(self):
        quote, event = self._both()
        for field in ('subtotal', 'service_charge', 'tax_amount', 'gratuity', 'total'):
            self.assertEqual(getattr(quote, field), getattr(event, field), field)

    def test_the_stored_fields_equal_the_engine_result(self):
        """No caller may massage the engine's answer on its way to the column."""
        from bookings.services.totals import price_booking as engine
        quote, event = self._both()
        for booking in (quote, event):
            expected = engine(pricing_input_for(booking)).totals
            self.assertEqual(booking.subtotal, expected['subtotal'])
            self.assertEqual(booking.service_charge, expected['service_charge'])
            self.assertEqual(booking.tax_amount, expected['tax_amount'])
            self.assertEqual(booking.gratuity, expected['gratuity'])
            self.assertEqual(booking.total, expected['total'])


class ResolverPassesDecimalsTests(TestCase):
    """AC7 — money reaches the engine as Decimal, never via binary floating point."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        GuestSegment.objects.filter(organisation=self.org).update(is_default=False)
        self.adults = GuestSegment.objects.create(
            organisation=self.org, name='AdultsDec', is_default=True,
            counts_toward_total=True, sort_order=0)
        self.kids = GuestSegment.objects.create(
            organisation=self.org, name='KidsDec', counts_toward_total=True,
            price_multiplier=Decimal('0.5000'), portion_multiplier=0.6, sort_order=1)
        self.event = Event.objects.create(
            organisation=self.org, name='E', event_date='2026-05-01', guest_count=100,
            price_per_head=Decimal('100'), status='confirmed')

    def test_the_price_fields_arrive_as_decimals(self):
        BookingGuestCount.objects.create(
            event=self.event, segment=self.kids, count=20, price_per_head=Decimal('12.34'))
        BookingGuestCount.objects.create(event=self.event, segment=self.adults, count=80)

        by_name = {s['name']: s for s in resolve_booking_segments(self.event)}

        self.assertIsInstance(by_name['KidsDec']['price_multiplier'], Decimal)
        self.assertIsInstance(by_name['KidsDec']['price_override'], Decimal)
        self.assertEqual(by_name['KidsDec']['price_override'], Decimal('12.34'))

    def test_the_default_segment_still_ignores_an_override(self):
        """Resolver behaviour, not engine behaviour — the override is stripped before
        the engine ever sees it, which is why it can't be a shared golden case. The
        default segment IS the base rate; a legacy row carrying an override on it
        must not re-price the whole booking."""
        BookingGuestCount.objects.create(
            event=self.event, segment=self.adults, count=100, price_per_head=Decimal('7.00'))

        by_name = {s['name']: s for s in resolve_booking_segments(self.event)}

        self.assertIsNone(by_name['AdultsDec']['price_override'])

    def test_a_decimal_multiplier_prices_the_same_as_the_old_float(self):
        """Guards AC4 at the seam that changed: dropping `float()` must not move a
        single stored cent."""
        self.assertEqual(
            line_item_total('each', 'rental', Decimal('1.50'), Decimal('0.03')),
            Decimal('0.05'),
        )
        BookingGuestCount.objects.create(event=self.event, segment=self.kids, count=20)
        BookingGuestCount.objects.create(event=self.event, segment=self.adults, count=80)
        self.event.recalculate_totals()
        self.event.refresh_from_db()
        # 80 × 100 + 20 × 50 = 9,000 — the number the float path produced.
        self.assertEqual(self.event.subtotal, Decimal('9000.00'))
