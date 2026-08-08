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

    def test_the_snapshot_records_the_real_tax_rate_not_a_rounded_one(self):
        """The rates block is NOT money and must not be quantized to cents.

        `to_dict` rounded every Decimal to 2 dp, so 8.75% was recorded as `0.09`
        beside a tax amount computed at 8.75% — and the rates exist precisely so a
        document can print the rate without reaching back to the booking. That
        document would have printed "9% tax — $875.00" on a $10,000 quote: two
        numbers on one customer-facing page that cannot both be true. Every US rate
        with 3-4 decimals (8.375%, 6.625%) hit it; the earlier tests all used 0.08,
        which round-trips by luck.
        """
        quote = self._quote(
            price_per_head=Decimal('100'), guest_count=100,
            tax_rate=Decimal('0.0875'), is_taxable=True,
            service_charge_pct=Decimal('0'), gratuity_pct=Decimal('0'),
        )
        BookingGuestCount.objects.create(quote=quote, segment=self.adults, count=100)
        quote.recalculate_totals()
        quote.refresh_from_db()

        self.assertEqual(quote.tax_amount, Decimal('875.00'))
        # Five decimals since REL-465 widened the column so NYC's 8.875% fits;
        # the point of the assertion is unchanged — the rate is NOT quantized to
        # cents the way money is.
        self.assertEqual(quote.pricing_snapshot['rates']['tax_rate'], '0.08750')
        # And the rate the snapshot records really does produce the amount beside it.
        self.assertEqual(
            round(Decimal(quote.pricing_snapshot['rates']['tax_rate'])
                  * Decimal(quote.pricing_snapshot['totals']['subtotal']), 2),
            quote.tax_amount,
        )

    def test_money_is_stored_as_text_not_floats(self):
        """JSON has one number type and it is binary floating point. Storing money
        as a float would reintroduce the drift the snapshot exists to prevent."""
        quote = self._quote()
        totals = quote.pricing_snapshot['totals']
        for key, value in totals.items():
            self.assertIsInstance(value, str, key)


class StoredLineTotalsMatchTheSubtotalTests(SnapshotBase):
    """The add-on lines a document PRINTS must add up to the subtotal beneath them.

    Since the engine computes the subtotal from each line's raw quantity x price
    rather than from the stored column, a stored `line_total` that the engine would
    not produce is a row printed at one number and summed at another. Only per-guest
    rows were being refreshed, so every other unit could drift for good.
    """

    def _stale_line(self, booking, **kwargs):
        fields = dict(
            category=LineItemCategory.RENTAL, description='Linens',
            quantity=Decimal('1.50'), unit=LineItemUnit.EACH,
            unit_price=Decimal('0.03'),
        )
        fields.update(kwargs)
        line = BookingLineItem.objects.create(quote=booking, **fields)
        # Write a value the engine would never produce — the shape left behind by
        # the old HALF_EVEN rounding, a data migration, or a raw queryset.update().
        BookingLineItem.objects.filter(pk=line.pk).update(line_total=Decimal('0.04'))
        return line

    def test_a_stale_each_line_is_healed_on_the_next_recompute(self):
        quote = self._quote(price_per_head=Decimal('0'), guest_count=0,
                            service_charge_pct=Decimal('0'), gratuity_pct=Decimal('0'),
                            is_taxable=False, tax_rate=Decimal('0'))
        line = self._stale_line(quote)
        self.assertEqual(
            BookingLineItem.objects.get(pk=line.pk).line_total, Decimal('0.04'))

        quote.recalculate_totals()

        line.refresh_from_db()
        quote.refresh_from_db()
        self.assertEqual(line.line_total, Decimal('0.05'))
        self.assertEqual(quote.subtotal, Decimal('0.05'))

    def test_the_printed_lines_sum_to_the_printed_subtotal(self):
        """The property that actually matters, asserted directly."""
        quote = self._quote(price_per_head=Decimal('0'), guest_count=0,
                            service_charge_pct=Decimal('0'), gratuity_pct=Decimal('0'),
                            is_taxable=False, tax_rate=Decimal('0'))
        self._stale_line(quote)
        self._stale_line(quote, description='Chairs', quantity=Decimal('10'),
                         unit_price=Decimal('5'))
        self._stale_line(quote, description='Goodwill', quantity=Decimal('1'),
                         unit=LineItemUnit.FLAT, unit_price=Decimal('20'),
                         category=LineItemCategory.DISCOUNT)

        quote.recalculate_totals()
        quote.refresh_from_db()

        printed = sum(li.line_total for li in quote.line_items.all())
        self.assertEqual(printed, quote.subtotal)
        # And the snapshot the documents render from agrees with both.
        self.assertEqual(
            quote.pricing_snapshot['lines']['add_ons_subtotal'], str(quote.subtotal))


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

    def test_apply_refuses_an_event_being_catered_today(self):
        """`in_progress` is the WORST row to re-price in a sweep and the one a
        morning cron hits: events auto-advance confirmed -> in_progress on their
        event date, so this is a signed, invoiced booking being served right now.
        It was missing from the refusal set."""
        event = self._event(status='in_progress')
        Event.objects.filter(pk=event.pk).update(price_per_head=Decimal('250'))

        output, code = self._run('--apply')

        self.assertEqual(code, 1)
        self.assertIn('REFUSED', output)
        event.refresh_from_db()
        self.assertEqual(event.subtotal, Decimal('10000.00'))  # untouched

    def test_the_shortfall_report_marks_an_event_day_booking_as_seen(self):
        """The two commands must agree on which bookings a client has seen. The
        report kept its own copy of the sets and omitted in_progress, printing '-'
        against an event being catered that day under a footer telling the reader
        that those are the safe ones to repair."""
        from bookings.management.commands.reconcile_booking_totals import (
            CLIENT_HAS_SEEN_IT,
        )
        from bookings.management.commands.report_under_covering_bookings import (
            Command as ReportCommand,
        )
        event = self._event(status='in_progress')
        self.assertIn('in_progress', CLIENT_HAS_SEEN_IT['event'])
        self.assertTrue(ReportCommand._client_has_seen_it('event', event))

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
        """A clean repair exits 0. The command is advertised as a gate for a
        scheduled job, and a run that fixed everything and refused nothing did
        exactly its job — failing it would page the owner for a success."""
        quote = self._quote(status='draft')
        Quote.objects.filter(pk=quote.pk).update(price_per_head=Decimal('250'))

        output, code = self._run('--apply')

        self.assertEqual(code, 0, output)
        self.assertIn('repriced', output)
        quote.refresh_from_db()
        self.assertEqual(quote.subtotal, Decimal('25000.00'))

    def test_apply_still_fails_when_something_was_refused(self):
        """A refusal IS unresolved — it needs a person — so the gate stays red."""
        seen = self._quote(status='sent')
        Quote.objects.filter(pk=seen.pk).update(price_per_head=Decimal('250'))

        output, code = self._run('--apply')

        self.assertEqual(code, 1)
        self.assertIn('REFUSED', output)


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


class SnapshotIsReadableTests(SnapshotBase):
    """REL-465: a read-only screen renders the saved breakdown, never a fresh one.

    Without the snapshot on the wire, a quote that is being *viewed* had only five
    flat columns to show, so the page recomputed the itemized food rows client-side
    — a second engine, producing rows that need not add up to the stored total
    beside them. The detail endpoint now hands over the answer the save produced.
    """

    def test_the_detail_endpoint_carries_the_snapshot(self):
        quote = self._quote()
        res = self.client.get(f'/api/bookings/quotes/{quote.id}/')
        self.assertEqual(res.status_code, 200)

        snap = res.data['pricing_snapshot']
        self.assertIsNotNone(snap)
        # The same shape the live preview returns, so one reader renders both.
        for section in ('food', 'lines', 'totals', 'rates'):
            self.assertIn(section, snap)
        # And it agrees with the columns alongside it, to the cent.
        self.assertEqual(snap['totals']['total'], str(quote.total))
        self.assertEqual(snap['totals']['subtotal'], res.data['subtotal'])

    def test_the_itemized_food_rows_survive_the_round_trip(self):
        """The rows the screen would otherwise have had to recompute."""
        quote = self._quote()
        # Through the API, because that is the path that derives the default
        # segment's remainder — the row the screen would otherwise work out itself.
        res = self.client.patch(
            f'/api/bookings/quotes/{quote.id}/',
            {'guest_count': 100, 'guest_counts': [{'segment': self.kids.name, 'count': 20}]},
            format='json')
        self.assertEqual(res.status_code, 200, res.data)

        res = self.client.get(f'/api/bookings/quotes/{quote.id}/')
        rows = res.data['pricing_snapshot']['food']['food_rows']
        self.assertIsNotNone(rows)
        by_name = {r['name']: r for r in rows}
        # Kids at half the per-head rate — priced by the engine, not the browser.
        self.assertEqual(by_name['Kids464']['count'], 20)
        self.assertEqual(by_name['Kids464']['rate'], '50.00')
        self.assertEqual(by_name['Adults464']['count'], 80)

    def test_the_list_endpoint_leaves_it_out(self):
        """A full breakdown per row, on a screen that shows one total per row."""
        self._quote()
        res = self.client.get('/api/bookings/quotes/')
        rows = res.data['results'] if isinstance(res.data, dict) else res.data
        self.assertTrue(rows)
        self.assertNotIn('pricing_snapshot', rows[0])
        # The total it actually shows is still there.
        self.assertIn('total', rows[0])

    def test_it_cannot_be_written_from_the_api(self):
        """It records what the save COMPUTED. A client-supplied one is a forgery."""
        quote = self._quote()
        real = quote.pricing_snapshot['totals']['total']

        res = self.client.patch(
            f'/api/bookings/quotes/{quote.id}/',
            {'pricing_snapshot': {'totals': {'total': '1.00'}}}, format='json')
        self.assertEqual(res.status_code, 200, res.data)

        quote.refresh_from_db()
        self.assertEqual(quote.pricing_snapshot['totals']['total'], real)

    def test_a_quote_saved_before_snapshots_reads_back_as_null(self):
        """The legacy row the frontend falls back to the flat columns for."""
        quote = self._quote()
        Quote.objects.filter(pk=quote.pk).update(pricing_snapshot=None)

        res = self.client.get(f'/api/bookings/quotes/{quote.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data['pricing_snapshot'])
        # Everything the fallback needs is still on the wire.
        for field in ('food_total', 'subtotal', 'service_charge', 'tax_amount', 'gratuity', 'total'):
            self.assertIn(field, res.data)


class FractionalTaxRateTests(SnapshotBase):
    """A tax rate with three decimals of percent — NYC charges 8.875%.

    `DecimalField(decimal_places=4)` on a FRACTION is only two decimals of percent,
    so 8.875% could not be stored at all: the API rejected it outright, and any
    client that rounded first stored 8.87% or 8.88% instead. On a $50,000 booking
    that is a $2.50 error, silently, in the largest market this product sells into.
    """

    def test_a_new_york_rate_is_accepted_and_stored_exactly(self):
        quote = self._quote(tax_rate=Decimal('0'))
        res = self.client.patch(
            f'/api/bookings/quotes/{quote.id}/', {'tax_rate': '0.08875'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)

        quote.refresh_from_db()
        self.assertEqual(quote.tax_rate, Decimal('0.08875'))

    def test_the_tax_it_charges_is_the_rate_it_stored(self):
        """The money, not just the column: 8.875% of the taxable base, to the cent."""
        quote = self._quote(
            guest_count=100, price_per_head=Decimal('500'), tax_rate=Decimal('0.08875'),
            service_charge_pct=Decimal('0'), gratuity_pct=Decimal('0'))
        quote.refresh_from_db()

        self.assertEqual(quote.subtotal, Decimal('50000.00'))
        # 50000 × 0.08875 = 4437.50 exactly — not 4435.00 (8.87%) or 4440.00 (8.88%).
        self.assertEqual(quote.tax_amount, Decimal('4437.50'))
        self.assertEqual(quote.total, Decimal('54437.50'))

    def test_the_snapshot_and_the_preview_agree_on_the_odd_rate(self):
        quote = self._quote(
            guest_count=100, price_per_head=Decimal('500'), tax_rate=Decimal('0.08875'),
            service_charge_pct=Decimal('0'), gratuity_pct=Decimal('0'))
        quote.refresh_from_db()

        res = self.client.post('/api/pricing/preview/', {
            'price_per_head': '500', 'guest_count': 100,
            'tax_rate': '0.08875', 'service_charge_pct': '0', 'gratuity_pct': '0',
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)

        # What the card would show while typing == what the save stored.
        self.assertEqual(res.data['totals']['total'], str(quote.total))
        self.assertEqual(res.data['totals']['tax_amount'], str(quote.tax_amount))
        self.assertEqual(res.data['rates']['tax_rate'], '0.08875')

    def test_an_existing_row_is_unchanged_by_the_widening(self):
        """The migration widens; it must not restate what anyone already agreed to."""
        quote = self._quote(tax_rate=Decimal('0.0850'))
        quote.refresh_from_db()

        self.assertEqual(quote.tax_rate, Decimal('0.0850'))
        # Same number, now with the extra place — and the money it produced is the
        # money it still produces.
        self.assertEqual(quote.tax_rate, Decimal('0.08500'))
        before = quote.total
        quote.recalculate_totals()
        quote.refresh_from_db()
        self.assertEqual(quote.total, before)

    def test_the_pdf_prints_the_rate_it_charged(self):
        """Two numbers on one customer-facing page that must both be true."""
        from bookings.pdf import _pct
        self.assertEqual(_pct(Decimal('8.875')), '8.875')
        self.assertEqual(_pct(Decimal('8.5')), '8.5')
        self.assertEqual(_pct(Decimal('20')), '20')
