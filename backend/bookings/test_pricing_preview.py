"""The live preview must BE the engine, not a second opinion (REL-465).

The frontend re-implemented the money rules so totals could update as you type, and
the two drifted repeatedly — a tax rate read as a fraction on one screen and a
percentage on another, add-ons summed differently on quotes and events. Every
divergence was a number the customer saw that the invoice disagreed with.

The property these tests defend is a single sentence: **what the preview says, a
save of the same draft stores.**
"""
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Contact, Quote
from bookings.models.addons import BookingLineItem
from bookings.models.quotes import LineItemCategory, LineItemUnit
from events.models import BookingGuestCount, BookingMeal, Event
from rules.models import GuestSegment
from tests.base import get_test_user

PREVIEW_URL = '/api/pricing/preview/'


def _flatten(node, path=''):
    """Every leaf in a nested response, as ``(path, value)``."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from _flatten(value, f'{path}.{key}' if path else key)
    elif isinstance(node, (list, tuple)):
        for i, value in enumerate(node):
            yield from _flatten(value, f'{path}[{i}]')
    else:
        yield path, node


class PricingPreviewTests(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        GuestSegment.objects.filter(organisation=self.org).update(is_default=False)
        self.adults = GuestSegment.objects.create(
            organisation=self.org, name='Adults465', is_default=True,
            counts_toward_total=True, sort_order=0)
        self.kids = GuestSegment.objects.create(
            organisation=self.org, name='Kids465', counts_toward_total=True,
            price_multiplier=Decimal('0.5000'), portion_multiplier=0.6, sort_order=1)

    # The one draft used by both halves of the parity test.
    def _draft(self):
        return {
            'guest_count': 100,
            'price_per_head': '100.00',
            'is_taxable': True,
            'tax_rate': '0.0875',
            'service_charge_pct': '20',
            'service_charge_taxable': True,
            'gratuity_pct': '15',
            'guest_counts': [{'segment': self.kids.name, 'count': 20}],
            'additional_meals': [
                {'label': 'Canapés', 'price_per_head': '10.00', 'guest_count': 30}],
            'line_items': [
                {'category': 'food', 'unit': 'per_guest', 'quantity': '1',
                 'unit_price': '6.00', 'description': 'Late night'},
                {'category': 'discount', 'unit': 'flat', 'quantity': '1',
                 'unit_price': '50.00', 'description': 'Goodwill'},
            ],
        }

    def _save_the_same_draft(self, draft):
        """Build the booking the draft describes, through the real write path."""
        quote = Quote.objects.create(
            organisation=self.org, primary_contact=self.contact,
            event_date='2026-05-01', guest_count=draft['guest_count'],
            price_per_head=Decimal(draft['price_per_head']),
            is_taxable=draft['is_taxable'], tax_rate=Decimal(draft['tax_rate']),
            service_charge_pct=Decimal(draft['service_charge_pct']),
            service_charge_taxable=draft['service_charge_taxable'],
            gratuity_pct=Decimal(draft['gratuity_pct']),
        )
        # Through the REAL write path, not by creating rows directly: that is what
        # derives the default segment's remainder, and a test that bypasses it would
        # be comparing the preview against something no save produces.
        from events.models import write_booking_segments
        write_booking_segments(quote, draft['guest_counts'])
        for meal in draft['additional_meals']:
            BookingMeal.objects.create(
                quote=quote, label=meal['label'],
                price_per_head=Decimal(meal['price_per_head']),
                guest_count=meal['guest_count'])
        for line in draft['line_items']:
            BookingLineItem.objects.create(
                quote=quote, category=line['category'], unit=line['unit'],
                quantity=Decimal(line['quantity']),
                unit_price=Decimal(line['unit_price']),
                description=line['description'])
        quote.recalculate_totals()
        quote.refresh_from_db()
        return quote

    def test_the_preview_is_what_the_save_stores(self):
        """AC1 — the whole point. Not "close to", not "usually": the same numbers."""
        draft = self._draft()

        res = self.client.post(PREVIEW_URL, draft, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        previewed = res.data['totals']

        quote = self._save_the_same_draft(draft)

        self.assertEqual(previewed['subtotal'], str(quote.subtotal))
        self.assertEqual(previewed['service_charge'], str(quote.service_charge))
        self.assertEqual(previewed['tax_amount'], str(quote.tax_amount))
        self.assertEqual(previewed['gratuity'], str(quote.gratuity))
        self.assertEqual(previewed['total'], str(quote.total))
        # And against the snapshot the documents render from.
        self.assertEqual(res.data['totals'], quote.pricing_snapshot['totals'])

    def test_the_previewed_breakdown_is_the_breakdown_that_saves(self):
        """The derived remainder must appear in the preview too, or the screen shows
        20 covers while the save stores 100 (REL-459)."""
        draft = self._draft()

        res = self.client.post(PREVIEW_URL, draft, format='json')
        rows = res.data['food']['food_rows']

        # In the ORG's segment order — the order a save stores and re-reads them in.
        # This used to assert payload order (Kids first, the derived remainder last),
        # and the saved rows below were compared as a DICT, so the fact that the two
        # disagreed about order was invisible: the list visibly reshuffled the moment
        # you pressed Save.
        self.assertEqual(
            [(r['name'], r['count']) for r in rows],
            [(self.adults.name, 80), (self.kids.name, 20)],
        )
        quote = self._save_the_same_draft(draft)
        self.assertEqual(
            [(r.segment.name, r.count) for r in quote.guest_counts.all()],
            [(r['name'], r['count']) for r in rows],
        )

    def test_a_non_taxable_draft_previews_no_tax(self):
        draft = dict(self._draft(), is_taxable=False)
        res = self.client.post(PREVIEW_URL, draft, format='json')
        self.assertEqual(res.data['totals']['tax_amount'], '0.00')

    def test_the_rate_comes_back_unrounded(self):
        """A 4-dp rate must survive the round trip — the snapshot bug, at the door."""
        res = self.client.post(PREVIEW_URL, self._draft(), format='json')
        self.assertEqual(res.data['rates']['tax_rate'], '0.0875')

    def test_a_half_typed_draft_prices_as_nothing_rather_than_erroring(self):
        """A draft is half-typed by definition. A preview that 400s mid-keystroke is
        worse than one that treats a blank field as zero — and the save path
        validates independently, so nothing bad can be stored either way."""
        for draft in (
            {},
            {'guest_count': '', 'price_per_head': ''},
            {'guest_count': 'abc', 'price_per_head': 'xyz', 'tax_rate': ''},
            {'guest_count': 10, 'line_items': [{'unit_price': '1e400', 'quantity': '1'}]},
            {'guest_count': 10, 'guest_counts': [{'segment': 'nonexistent', 'count': 5}]},
            # Found by hand in a real browser: a JSON body is whatever the caller
            # sent, and these made the endpoint 500 — the one thing its docstring
            # promises it will not do.
            {'guest_counts': 42, 'line_items': 'notalist', 'additional_meals': 7},
            {'guest_count': {'a': 1}, 'price_per_head': [1, 2]},
            {'guest_counts': None, 'line_items': None, 'additional_meals': None},
        ):
            with self.subTest(draft=draft):
                res = self.client.post(PREVIEW_URL, draft, format='json')
                self.assertEqual(res.status_code, 200, res.data)
                self.assertIn('total', res.data['totals'])

    def test_a_draft_the_save_would_refuse_says_so(self):
        """A breakdown bigger than the guest count prices honestly and then 400s on
        save, so the card would show a confident number that cannot exist. The
        preview now names the reason — in the save path's own words — while still
        returning the figures and still answering 200."""
        draft = dict(self._draft(), guest_count=10)
        draft['guest_counts'] = [{'segment': self.kids.name, 'count': 999}]

        res = self.client.post(PREVIEW_URL, draft, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['warnings'], 'expected a warning')
        self.assertIn('999', res.data['warnings'][0])
        # Still priced — the caller decides how loudly to say it.
        self.assertNotEqual(res.data['totals']['total'], '0.00')

        # And the wording is the save path's, not a second one that can drift.
        from events.models import guest_counts_error
        self.assertEqual(
            res.data['warnings'][0],
            guest_counts_error(self.org, 10, draft['guest_counts']),
        )

    def test_a_save_of_that_draft_really_is_refused(self):
        """The warning is only worth trusting if the save genuinely rejects it."""
        quote = Quote.objects.create(
            organisation=self.org, primary_contact=self.contact,
            event_date='2026-05-01', guest_count=10, price_per_head=Decimal('100'))

        res = self.client.patch(
            f'/api/bookings/quotes/{quote.id}/',
            {'guest_count': 10,
             'guest_counts': [{'segment': self.kids.name, 'count': 999}]},
            format='json')

        self.assertEqual(res.status_code, 400, res.data)

    def test_an_ordinary_draft_carries_no_warnings(self):
        """The quiet case: a warning that fires on healthy drafts would be ignored."""
        res = self.client.post(PREVIEW_URL, self._draft(), format='json')
        self.assertEqual(res.data['warnings'], [])

    def test_no_money_value_is_ever_negative_zero(self):
        """Found by hand in a real browser: a negative guest count previewed a tax of
        `-0.00`, which renders as "-$0.00" on the customer's card. The codebase
        already refuses that shape (`parse_segment_rate` normalises -0 for exactly
        this reason); `round2` now does it for every money value the engine emits."""
        res = self.client.post(
            PREVIEW_URL,
            {'guest_count': -50, 'price_per_head': '100', 'is_taxable': True,
             'tax_rate': '0', 'service_charge_pct': '0', 'gratuity_pct': '0'},
            format='json')

        for section in ('totals', 'food', 'lines'):
            for key, value in _flatten(res.data[section]):
                if isinstance(value, str):
                    self.assertFalse(
                        value.startswith('-0.00'), f'{section}.{key} == {value}')

    def test_it_writes_nothing(self):
        """A preview is a read. Nothing may be created, and no booking re-priced."""
        before = (Quote.objects.count(), Event.objects.count(),
                  BookingGuestCount.objects.count(), BookingLineItem.objects.count(),
                  BookingMeal.objects.count())

        self.client.post(PREVIEW_URL, self._draft(), format='json')

        self.assertEqual(
            (Quote.objects.count(), Event.objects.count(),
             BookingGuestCount.objects.count(), BookingLineItem.objects.count(),
             BookingMeal.objects.count()),
            before,
        )

    def test_it_needs_a_login(self):
        anon = APIClient()
        res = anon.post(PREVIEW_URL, self._draft(), format='json')
        self.assertIn(res.status_code, (401, 403))

    def test_it_prices_with_the_callers_own_org_segments(self):
        """Org scoping: the segment names in the payload are resolved against the
        REQUESTING user's org, so one tenant cannot price with another's segments."""
        from users.models import Organisation
        other_org = Organisation.objects.create(name='Other Co 465', slug='other-co-465')
        GuestSegment.objects.create(
            organisation=other_org, name='Kids465',
            counts_toward_total=True, price_multiplier=Decimal('0.1000'), sort_order=1)

        res = self.client.post(PREVIEW_URL, self._draft(), format='json')

        # Priced at OUR Kids rate (0.5 x 100 = 50), not the other org's 0.1.
        kids = next(r for r in res.data['food']['food_rows'] if r['name'] == self.kids.name)
        self.assertEqual(kids['rate'], '50.00')


class TaxContractTests(TestCase):
    """Tax is a GATE times a RATE, and the caller states both.

    Reading tax out of whichever key happened to be present is how an event-shaped
    draft — which carries `is_taxable` and no rate — came to preview ZERO tax, and
    how a quote whose `is_taxable` had been turned off previewed tax it would never
    be charged. Both are silent, and both are the direction that loses an argument
    with a customer.
    """

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _preview(self, **over):
        body = {
            'guest_count': 100, 'price_per_head': '100.00',
            'service_charge_pct': '0', 'gratuity_pct': '0',
        }
        body.update(over)
        res = self.client.post(PREVIEW_URL, body, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def test_an_event_shaped_draft_is_taxed_at_its_own_rate(self):
        """The gap this contract closes: `is_taxable` + a rate, no `tax_rate` guess."""
        data = self._preview(is_taxable=True, tax_rate='0.08875')
        self.assertEqual(data['totals']['tax_amount'], '887.50')
        self.assertEqual(data['totals']['total'], '10887.50')

    def test_the_gate_off_means_no_tax_however_high_the_rate(self):
        data = self._preview(is_taxable=False, tax_rate='0.08875')
        self.assertEqual(data['totals']['tax_amount'], '0.00')
        self.assertEqual(data['totals']['total'], '10000.00')

    def test_a_taxable_draft_with_no_rate_prices_as_zero_and_says_so(self):
        """Priced honestly, but never silently — this looked like a tax-free booking."""
        data = self._preview(is_taxable=True)
        self.assertEqual(data['totals']['tax_amount'], '0.00')
        self.assertTrue(any('No tax rate is set' in w for w in data['warnings']))

    def test_a_non_taxable_draft_with_no_rate_is_not_a_complaint(self):
        """Nothing is missing — the booking simply isn't taxed."""
        data = self._preview(is_taxable=False)
        self.assertEqual(data['warnings'], [])

    def test_a_rate_of_zero_is_a_stated_rate_not_a_missing_one(self):
        data = self._preview(is_taxable=True, tax_rate='0.00000')
        self.assertEqual(data['totals']['tax_amount'], '0.00')
        self.assertEqual(data['warnings'], [])


class MealAudienceParityTests(TestCase):
    """An audience-scoped meal is priced by the count the SAVE will give it.

    The preview used to take the browser's number on trust, so the frontend's mirror
    of `derive_meal_guest_count` stayed load-bearing for a priced figure: stop
    computing it there and the preview silently under-prices by a whole meal. These
    pin the derivation server-side, where the save already does it.
    """

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        GuestSegment.objects.filter(organisation=self.org).update(is_default=False)
        self.adults = GuestSegment.objects.create(
            organisation=self.org, name='AdultsMA', is_default=True,
            counts_toward_total=True, sort_order=0)
        self.kids = GuestSegment.objects.create(
            organisation=self.org, name='KidsMA', counts_toward_total=True,
            price_multiplier=Decimal('0.5000'), portion_multiplier=0.6, sort_order=1)
        self.vendors = GuestSegment.objects.create(
            organisation=self.org, name='VendorsMA', counts_toward_total=False,
            price_multiplier=Decimal('1.0000'), portion_multiplier=1.0, sort_order=2)

    def _preview(self, meal):
        res = self.client.post(PREVIEW_URL, {
            'guest_count': 100,
            'price_per_head': '0',
            'is_taxable': False,
            'service_charge_pct': '0', 'gratuity_pct': '0',
            # 80 adults (derived) + 20 kids, plus 5 vendors who don't count toward
            # the 100.
            'guest_counts': [
                {'segment': self.kids.name, 'count': 20},
                {'segment': self.vendors.name, 'count': 5},
            ],
            'additional_meals': [meal],
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def _meal(self, audience, segment=None, sent_count=0):
        return {'label': 'Late supper', 'price_per_head': '10.00',
                'audience': audience, 'audience_segment': segment,
                # Deliberately WRONG. The server must ignore it for a derived
                # audience — that is the whole point.
                'guest_count': sent_count}

    def test_everyone_covers_the_vendors_too(self):
        data = self._preview(self._meal('everyone'))
        # 80 + 20 + 5 = 105 covers at $10.
        self.assertEqual(data['food']['meals_food'], '1050.00')
        self.assertEqual(data['food']['meal_rows'][0]['count'], 105)

    def test_guests_only_leaves_the_vendors_out(self):
        data = self._preview(self._meal('guests'))
        self.assertEqual(data['food']['meals_food'], '1000.00')  # 100 covers

    def test_a_single_segment_is_just_that_segment(self):
        data = self._preview(self._meal('segment', segment=self.kids.name))
        self.assertEqual(data['food']['meals_food'], '200.00')  # 20 kids

    def test_a_segment_that_is_not_in_the_mix_serves_nobody(self):
        data = self._preview(self._meal('segment', segment='NoSuchSegment'))
        self.assertEqual(data['food']['meals_food'], '0.00')

    def test_custom_keeps_the_number_that_was_typed(self):
        data = self._preview(self._meal('custom', sent_count=7))
        self.assertEqual(data['food']['meals_food'], '70.00')

    def test_a_meal_with_no_audience_at_all_is_custom(self):
        meal = {'label': 'Legacy', 'price_per_head': '10.00', 'guest_count': 12}
        data = self._preview(meal)
        self.assertEqual(data['food']['meals_food'], '120.00')

    def test_the_clients_count_cannot_change_a_derived_price(self):
        """The mirror is no longer load-bearing: send nonsense, get the right answer."""
        honest = self._preview(self._meal('everyone', sent_count=105))
        nonsense = self._preview(self._meal('everyone', sent_count=0))
        self.assertEqual(honest['totals']['total'], nonsense['totals']['total'])
        self.assertEqual(nonsense['food']['meals_food'], '1050.00')


class PreviewOrderAndTypesTests(TestCase):
    """The preview must agree with the save about ORDER and about what a boolean is.

    Neither changes a total, which is exactly why they went unnoticed: the first
    reshuffles a customer-facing list the moment you press Save, and the second
    decides whether tax is charged at all.
    """

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        GuestSegment.objects.filter(organisation=self.org).update(is_default=False)
        self.adults = GuestSegment.objects.create(
            organisation=self.org, name='AdultsOrd', is_default=True,
            counts_toward_total=True, sort_order=0)
        self.kids = GuestSegment.objects.create(
            organisation=self.org, name='KidsOrd', counts_toward_total=True,
            price_multiplier=Decimal('0.5000'), portion_multiplier=0.6, sort_order=1)
        self.vendors = GuestSegment.objects.create(
            organisation=self.org, name='VendorsOrd', counts_toward_total=False,
            price_multiplier=Decimal('1.0000'), portion_multiplier=1.0, sort_order=2)

    def test_the_food_rows_come_back_in_the_order_a_save_stores_them(self):
        """Same rows, same amounts — but the list must not reshuffle on save.

        `derive_segment_rows` appends the derived default remainder LAST, because
        that is when it learns the number. `BookingGuestCount` reads in segment
        order. So the itemised food lines used to jump from "Kids, Vendors, Adults"
        to "Adults, Kids, Vendors" the moment you pressed Save — which, on a card
        the customer is reading, looks like the numbers changed.
        """
        counts = [
            {'segment': self.kids.name, 'count': 20},
            {'segment': self.vendors.name, 'count': 5},
        ]
        res = self.client.post(PREVIEW_URL, {
            'guest_count': 100, 'price_per_head': '100.00', 'is_taxable': False,
            'service_charge_pct': '0', 'gratuity_pct': '0', 'guest_counts': counts,
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        previewed = [r['name'] for r in res.data['food']['food_rows']]

        quote = Quote.objects.create(
            organisation=self.org, primary_contact=self.contact,
            event_date='2026-05-01', guest_count=100, price_per_head=Decimal('100'),
            is_taxable=False, tax_rate=Decimal('0'),
            service_charge_pct=Decimal('0'), gratuity_pct=Decimal('0'))
        save = self.client.patch(
            f'/api/bookings/quotes/{quote.id}/',
            {'guest_count': 100, 'guest_counts': counts}, format='json')
        self.assertEqual(save.status_code, 200, save.data)
        quote.refresh_from_db()
        stored = [r['name'] for r in quote.pricing_snapshot['food']['food_rows']]

        self.assertEqual(previewed, stored)
        # And it is the org's own segment order, not payload order.
        self.assertEqual(stored, [self.adults.name, self.kids.name, self.vendors.name])

    def test_a_stringified_false_does_not_charge_tax(self):
        """`bool("false")` is True, and this gate decides whether someone pays."""
        res = self.client.post(PREVIEW_URL, {
            'guest_count': 10, 'price_per_head': '10.00',
            'is_taxable': 'false', 'tax_rate': '0.10000',
            'service_charge_pct': '0', 'gratuity_pct': '0',
        }, format='json')
        self.assertEqual(res.data['totals']['tax_amount'], '0.00')
        self.assertEqual(res.data['totals']['total'], '100.00')

    def test_a_stringified_true_still_charges_tax(self):
        res = self.client.post(PREVIEW_URL, {
            'guest_count': 10, 'price_per_head': '10.00',
            'is_taxable': 'true', 'tax_rate': '0.10000',
            'service_charge_pct': '0', 'gratuity_pct': '0',
        }, format='json')
        self.assertEqual(res.data['totals']['tax_amount'], '10.00')

    def test_junk_in_the_guest_breakdown_does_not_500(self):
        """A body is whatever the caller sent; a draft being typed must never error."""
        for junk in (['nope'], [None], [42], 'not-a-list', {'a': 1}):
            res = self.client.post(PREVIEW_URL, {
                'guest_count': 10, 'price_per_head': '10.00',
                'is_taxable': False, 'guest_counts': junk,
            }, format='json')
            self.assertEqual(res.status_code, 200, f'{junk!r} → {res.status_code}')
            self.assertEqual(res.data['totals']['total'], '100.00')
