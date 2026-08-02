"""REL-449 — a per-segment per-head rate must be a usable amount.

Before this, `BookingGuestCount.price_per_head` was bounded nowhere that actually
ran: the model's `MinValueValidator(0)` is dead code because `write_booking_segments`
writes via `update_or_create` (no `full_clean`), and the serializer didn't check it.
So `"abc"` and `"1e400"` raised `InvalidOperation` out as an unhandled **500**, and a
negative rate reached the money engine — caught, if at all, only by the subtotal
guard, which then blamed discounts that didn't exist.

Covers AC1-AC3 (rejected at the API, on the write path, and non-numeric refused) and
AC6 (valid bookings unchanged). AC4 (engines never non-finite) lives in
bookings/test_totals.py via the shared golden cases.
"""
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user
from bookings.models import Contact, Quote
from events.models import BookingGuestCount, parse_segment_rate, write_booking_segments


class ParseSegmentRateTests(TestCase):
    """The one place that decides what a per-head override may be."""

    def test_blank_is_no_override_not_an_error(self):
        for blank in (None, ''):
            value, error = parse_segment_rate(blank)
            self.assertIsNone(value)
            self.assertIsNone(error)

    def test_valid_amounts_pass_through(self):
        for raw, expected in [('0', Decimal('0')), ('18', Decimal('18')),
                              ('18.50', Decimal('18.50')), (22.5, Decimal('22.5'))]:
            value, error = parse_segment_rate(raw)
            self.assertIsNone(error, raw)
            self.assertEqual(value, expected)

    def test_non_numeric_is_refused_rather_than_raising(self):
        for raw in ['abc', '5,5', '$40', ' ', 'null', '[]']:
            value, error = parse_segment_rate(raw)
            self.assertIsNone(value, raw)
            self.assertEqual(error, 'must be a number', raw)

    def test_nan_and_infinity_are_refused(self):
        # Decimal("NaN") / Decimal("Infinity") PARSE fine — they have to be caught
        # on finiteness, not by the try/except.
        for raw in ['NaN', 'Infinity', '-Infinity', '1e400']:
            value, error = parse_segment_rate(raw)
            self.assertIsNone(value, raw)
            self.assertIsNotNone(error, raw)

    def test_negative_is_refused(self):
        for raw in ['-1', '-0.01', '-1000']:
            value, error = parse_segment_rate(raw)
            self.assertIsNone(value, raw)
            self.assertEqual(error, 'cannot be negative', raw)

    def test_beyond_the_column_is_refused(self):
        # DecimalField(max_digits=10, decimal_places=2) — anything larger fails the
        # DB write itself, so refuse it with a message instead of a 500.
        value, error = parse_segment_rate('100000000')
        self.assertIsNone(value)
        self.assertIn('cannot be more than', error)


class SegmentRateApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.contact = Contact.objects.create(organisation=self.org, name='C')
        from rules.models import GuestSegment
        segs = list(GuestSegment.objects.filter(organisation=self.org).order_by('sort_order'))
        # A non-default segment is the only one that may carry an override at all.
        self.seg = [s for s in segs if not (s.is_default and s.counts_toward_total)][0]
        self.default_seg = [s for s in segs if s.is_default and s.counts_toward_total][0]

    def _post(self, rate):
        # Mirror what the UI actually sends: buildGuestCountsPayload always appends
        # the default segment's remainder row. Omitting it prices ONLY the rows sent
        # (resolve_booking_segments uses stored rows when any exist), so a partial
        # breakdown underprices the booking — a raw-API gap, reported separately.
        row = {'segment': self.seg.name, 'count': 10}
        if rate is not None:
            row['price_per_head'] = rate
        return self.client.post('/api/bookings/quotes/', {
            'primary_contact': self.contact.id, 'event_date': '2026-09-01',
            'guest_count': 100, 'price_per_head': '40.00', 'is_taxable': False,
            'guest_counts': [row, {'segment': self.default_seg.name, 'count': 90}],
        }, format='json')

    def test_negative_rate_is_rejected_naming_the_segment(self):  # AC1
        res = self._post('-1000')
        self.assertEqual(res.status_code, 400, res.content)
        body = res.json()
        self.assertIn('guest_counts', body)
        message = str(body['guest_counts'])
        # The point of the ticket: it names the rate that's wrong, and does NOT
        # blame a discount the booking doesn't have.
        self.assertIn(self.seg.name, message)
        self.assertIn('cannot be negative', message)
        self.assertNotIn('discount', message.lower())

    def test_non_numeric_rate_is_a_400_not_a_500(self):  # AC3
        for bad in ['abc', '1e400', 'NaN', 'Infinity']:
            res = self._post(bad)
            self.assertEqual(res.status_code, 400, f'{bad} -> {res.status_code}')
            self.assertIn('guest_counts', res.json(), bad)

    def test_nothing_is_stored_when_the_rate_is_rejected(self):
        self._post('-1000')
        self.assertFalse(Quote.objects.filter(organisation=self.org).exists())
        self.assertFalse(BookingGuestCount.objects.exists())

    def test_a_valid_override_still_saves_and_prices(self):  # AC6
        res = self._post('18.50')
        self.assertEqual(res.status_code, 201, res.content)
        row = BookingGuestCount.objects.get(quote_id=res.json()['id'], segment=self.seg)
        self.assertEqual(row.price_per_head, Decimal('18.50'))
        # 90 default @40 + 10 @18.50 = 3600 + 185 = 3785
        self.assertEqual(Decimal(res.json()['food_total']), Decimal('3785.00'))

    def test_a_booking_with_no_override_is_untouched(self):  # AC6
        res = self._post(None)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(Decimal(res.json()['food_total']), Decimal('4000.00'))  # 100 × 40

    def test_patching_a_bad_rate_onto_a_saved_booking_is_rejected(self):  # AC1 (edit)
        quote_id = self._post('18.50').json()['id']
        res = self.client.patch(f'/api/bookings/quotes/{quote_id}/', {
            'guest_counts': [
                {'segment': self.seg.name, 'count': 10, 'price_per_head': '-5'},
                {'segment': self.default_seg.name, 'count': 90},
            ],
        }, format='json')
        self.assertEqual(res.status_code, 400, res.content)
        # ...and the good value is still there.
        row = BookingGuestCount.objects.get(quote_id=quote_id, segment=self.seg)
        self.assertEqual(row.price_per_head, Decimal('18.50'))


class SegmentRateWritePathTests(TestCase):
    """AC2 — the raw/agent path, below the serializer."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        contact = Contact.objects.create(organisation=self.org, name='C')
        self.quote = Quote.objects.create(
            organisation=self.org, primary_contact=contact,
            event_date='2026-09-01', guest_count=100, price_per_head=Decimal('40'),
        )
        from rules.models import GuestSegment
        segs = list(GuestSegment.objects.filter(organisation=self.org).order_by('sort_order'))
        self.seg = [s for s in segs if not (s.is_default and s.counts_toward_total)][0]

    def test_write_path_stores_no_override_for_an_unusable_rate(self):
        for bad in ['abc', '-1000', '1e400', 'NaN']:
            write_booking_segments(self.quote, [
                {'segment': self.seg.name, 'count': 10, 'price_per_head': bad},
            ])
            row = BookingGuestCount.objects.get(quote=self.quote, segment=self.seg)
            # Falls back to "no override" — never a stored rate nobody chose, and
            # never an InvalidOperation escaping as a 500.
            self.assertIsNone(row.price_per_head, bad)

    def test_write_path_keeps_a_valid_override(self):
        write_booking_segments(self.quote, [
            {'segment': self.seg.name, 'count': 10, 'price_per_head': '18.50'},
        ])
        row = BookingGuestCount.objects.get(quote=self.quote, segment=self.seg)
        self.assertEqual(row.price_per_head, Decimal('18.50'))
