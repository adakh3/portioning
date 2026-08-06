"""Every booking carries the engine's whole answer, and disagreement is detectable.

Before this, a booking stored five decimal columns and nothing else, so a document
recomputed its food rows live and printed them next to possibly-stale stored
totals — two points in time on one page. The snapshot ends that: one write, one
answer, rendered by everyone.

The other half is detection. A stored total that drifts should be found by a
command we run, not by a customer reading their invoice — hence the DB invariant
(the last line of defence) and `reconcile_booking_totals` (the sweep).
"""
import datetime
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Contact, Quote
from bookings.models.addons import BookingLineItem
from bookings.models.quotes import LineItemCategory, LineItemUnit
from events.models import BookingGuestCount, Event
from rules.models import GuestSegment
from tests.base import get_test_user


class SnapshotBase(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        GuestSegment.objects.filter(organisation=self.org).update(is_default=False)
        self.adults = GuestSegment.objects.create(
            organisation=self.org, name='Adults464', is_default=True,
            counts_toward_total=True, sort_order=0)
        self.kids = GuestSegment.objects.create(
            organisation=self.org, name='Kids464', counts_toward_total=True,
            price_multiplier=Decimal('0.5000'), portion_multiplier=0.6, sort_order=1)

    def _quote(self, **kwargs):
        fields = dict(
            organisation=self.org, primary_contact=self.contact,
            event_date='2026-05-01', guest_count=100, price_per_head=Decimal('100'),
            is_taxable=True, tax_rate=Decimal('0.08'),
            service_charge_pct=Decimal('20'), gratuity_pct=Decimal('15'),
        )
        fields.update(kwargs)
        quote = Quote.objects.create(**fields)
        quote.recalculate_totals()
        quote.refresh_from_db()
        return quote

    def _event(self, **kwargs):
        fields = dict(
            organisation=self.org, name='Gala', event_date='2026-05-01',
            guest_count=100, price_per_head=Decimal('100'), status='draft',
            is_taxable=True, tax_rate=Decimal('0.08'),
            service_charge_pct=Decimal('20'), gratuity_pct=Decimal('15'),
        )
        fields.update(kwargs)
        event = Event.objects.create(**fields)
        event.recalculate_totals()
        event.refresh_from_db()
        return event


class SnapshotIsWrittenTests(SnapshotBase):
    """AC1–AC3."""

    def test_a_saved_quote_carries_the_whole_result(self):
        quote = self._quote()
        BookingLineItem.objects.create(
            quote=quote, category=LineItemCategory.RENTAL, description='Chairs',
            quantity=Decimal('10'), unit=LineItemUnit.EACH, unit_price=Decimal('5'))
        quote.refresh_from_db()

        snap = quote.pricing_snapshot
        self.assertIsNotNone(snap)
        # Every section the documents will render from.
        self.assertIn('food', snap)
        self.assertIn('lines', snap)
        self.assertIn('totals', snap)
        self.assertIn('rates', snap)
        self.assertEqual(snap['lines']['items'][0]['line_total'], '50.00')
        self.assertEqual(snap['lines']['add_ons_subtotal'], '50.00')
        # And it agrees with the columns — the whole point.
        self.assertEqual(snap['totals']['total'], str(quote.total))
        self.assertEqual(snap['totals']['subtotal'], str(quote.subtotal))

    def test_the_snapshot_moves_with_the_booking(self):
        """AC2. A stale snapshot is worse than none: it is what gets printed."""
        quote = self._quote()
        before = quote.pricing_snapshot['totals']['total']

        res = self.client.patch(
            f'/api/bookings/quotes/{quote.id}/', {'guest_count': 150}, format='json')
        self.assertEqual(res.status_code, 200, res.data)

        quote.refresh_from_db()
        snap = quote.pricing_snapshot
        self.assertNotEqual(snap['totals']['total'], before)
        self.assertEqual(snap['totals']['total'], str(quote.total))
        # The food section reflects the NEW count, not just the totals.
        self.assertEqual(snap['food']['menu_food'], '15000.00')

    def test_an_event_carries_the_same_snapshot(self):
        """AC3 — the mirror."""
        event = self._event()
        self.assertIsNotNone(event.pricing_snapshot)
        self.assertEqual(event.pricing_snapshot['totals']['total'], str(event.total))

        res = self.client.patch(
            f'/api/events/{event.id}/', {'guest_count': 150}, format='json')
        self.assertEqual(res.status_code, 200, res.data)

        event.refresh_from_db()
        self.assertEqual(event.pricing_snapshot['food']['menu_food'], '15000.00')
        self.assertEqual(event.pricing_snapshot['totals']['total'], str(event.total))

    def test_money_is_stored_as_text_not_floats(self):
        """JSON has one number type and it is binary floating point. Storing money
        as a float would reintroduce the drift the snapshot exists to prevent."""
        quote = self._quote()
        totals = quote.pricing_snapshot['totals']
        for key, value in totals.items():
            self.assertIsInstance(value, str, key)


class TotalInvariantTests(SnapshotBase):
    """AC4 — the database itself refuses a total that doesn't add up."""

    def test_the_database_rejects_a_quote_whose_total_is_a_lie(self):
        quote = self._quote()
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Quote.objects.filter(pk=quote.pk).update(total=quote.total + 1)

    def test_the_database_rejects_an_event_whose_total_is_a_lie(self):
        event = self._event()
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Event.objects.filter(pk=event.pk).update(total=event.total + 1)

    def test_a_correct_booking_is_accepted(self):
        """The invariant must not be so tight that honest rows fail it. This is the
        case that caught the real bug: SQLite adds DecimalFields as IEEE doubles, so
        14201.20 + 1171.60 evaluates to 15372.800000000001 and an exact-equality
        constraint rejected numbers that were right to the cent."""
        event = self._event(
            price_per_head=Decimal('137.77'), service_charge_pct=Decimal('0'),
            gratuity_pct=Decimal('0'), tax_rate=Decimal('0.0825'))
        BookingLineItem.objects.create(
            event=event, category=LineItemCategory.RENTAL, description='Linens',
            quantity=Decimal('10'), unit=LineItemUnit.EACH, unit_price=Decimal('42.42'))
        event.refresh_from_db()
        self.assertEqual(event.subtotal, Decimal('14201.20'))
        self.assertEqual(event.tax_amount, Decimal('1171.60'))
        self.assertEqual(event.total, Decimal('15372.80'))


class ReconciliationTests(SnapshotBase):
    """AC5, AC6, AC9."""

    def _run(self, *args):
        out = StringIO()
        try:
            call_command('reconcile_booking_totals', *args, stdout=out)
            return out.getvalue(), 0
        except SystemExit as exc:
            return out.getvalue(), exc.code

    def test_a_consistent_database_reconciles_clean(self):
        """AC6 — bookings written the normal way must never be reported."""
        self._quote()
        self._event()
        output, code = self._run()
        self.assertEqual(code, 0, output)
        self.assertIn('Every booking matches the engine', output)

    def test_drift_is_found_and_reported(self):
        """AC5. The drift is made by moving an INPUT behind the engine's back, which
        is what a raw UPDATE or a rogue code path really does — the stored columns
        stay self-consistent (the DB constraint still passes), they just no longer
        describe the booking."""
        quote = self._quote()
        Quote.objects.filter(pk=quote.pk).update(price_per_head=Decimal('250'))

        output, code = self._run()

        self.assertEqual(code, 1)
        self.assertIn(f'quote {quote.pk}', output)
        self.assertIn('subtotal', output)
        self.assertIn(str(quote.subtotal), output)

    def test_apply_refuses_a_booking_the_client_has_seen(self):
        """AC9. Re-pricing a sent quote in a sweep changes a number someone is
        holding on paper."""
        quote = self._quote(status='sent')
        Quote.objects.filter(pk=quote.pk).update(price_per_head=Decimal('250'))

        output, code = self._run('--apply')

        self.assertEqual(code, 1)
        self.assertIn('REFUSED', output)
        quote.refresh_from_db()
        self.assertEqual(quote.price_per_head, Decimal('250'))
        self.assertEqual(quote.subtotal, Decimal('10000.00'))  # unchanged

    def test_apply_repairs_a_draft_nobody_has_seen(self):
        quote = self._quote(status='draft')
        Quote.objects.filter(pk=quote.pk).update(price_per_head=Decimal('250'))

        output, code = self._run('--apply')

        self.assertEqual(code, 1)  # a diff was found, even though it was fixed
        self.assertIn('repriced', output)
        quote.refresh_from_db()
        self.assertEqual(quote.subtotal, Decimal('25000.00'))


class UnderCoveringReportTests(SnapshotBase):
    """AC7 — the REL-459 legacy data, reported and NOT touched."""

    def _legacy_booking(self):
        """A booking shaped the way the old write path allowed: 100 guests claimed,
        only 20 covered. The remainder rule prevents new ones, so this is built by
        deleting the derived row afterwards."""
        quote = self._quote(guest_count=100)
        BookingGuestCount.objects.create(quote=quote, segment=self.kids, count=20)
        quote.recalculate_totals()
        BookingGuestCount.objects.filter(quote=quote, segment=self.adults).delete()
        quote.refresh_from_db()
        return quote

    def test_it_lists_the_shortfall_and_changes_nothing(self):
        quote = self._legacy_booking()
        before_total = quote.total
        before_rows = list(
            quote.guest_counts.values_list('segment__name', 'count').order_by('id'))

        out = StringIO()
        call_command('report_under_covering_bookings', stdout=out)
        output = out.getvalue()

        self.assertIn(f'quote  {quote.pk:>5}'.strip().split()[1], output)
        self.assertIn('NOTHING HAS BEEN CHANGED', output)

        quote.refresh_from_db()
        self.assertEqual(quote.total, before_total)
        self.assertEqual(
            list(quote.guest_counts.values_list('segment__name', 'count').order_by('id')),
            before_rows,
        )

    def test_a_fully_covered_booking_is_not_listed(self):
        quote = self._quote(guest_count=100)
        out = StringIO()
        call_command('report_under_covering_bookings', stdout=out)
        self.assertIn('No under-covering bookings', out.getvalue())


class GuestInvariantAtTheAPITests(SnapshotBase):
    """AC8 — the REL-459 remainder rule, asserted through the real API for BOTH
    booking kinds. It is the contract the whole epic assumes."""

    def test_a_quote_patch_fills_the_remainder(self):
        quote = self._quote(guest_count=100)
        res = self.client.patch(
            f'/api/bookings/quotes/{quote.id}/',
            {'guest_counts': [{'segment': self.kids.name, 'count': 20}]}, format='json')
        self.assertEqual(res.status_code, 200, res.data)

        self.assertEqual(
            {r.segment.name: r.count for r in quote.guest_counts.all()},
            {self.adults.name: 80, self.kids.name: 20},
        )

    def test_an_event_patch_fills_the_remainder(self):
        event = self._event(guest_count=100)
        res = self.client.patch(
            f'/api/events/{event.id}/',
            {'guest_counts': [{'segment': self.kids.name, 'count': 20}]}, format='json')
        self.assertEqual(res.status_code, 200, res.data)

        self.assertEqual(
            {r.segment.name: r.count for r in event.guest_counts.all()},
            {self.adults.name: 80, self.kids.name: 20},
        )
