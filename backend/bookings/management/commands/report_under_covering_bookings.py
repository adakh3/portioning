"""List bookings whose guest breakdown covers fewer guests than they claim (REL-459).

Before the remainder rule, a booking of 100 guests carrying only "Kids: 20" priced,
portioned and printed as TWENTY covers while the signed function sheet still said
100 — a £1,000 invoice for a £10,000 event. New writes are fixed. This finds the
rows already stored that way.

**It changes nothing.** Owner decision (2026-08-06): report first, then decide. Some
of these bookings have been sent, signed or invoiced, and silently re-pricing a
signed contract is a worse failure than the one being fixed. The report gives the
current total and what the total would become, per booking, so the call can be made
per booking.
"""
from django.core.management.base import BaseCommand

from bookings.management.commands.reconcile_booking_totals import (
    PRICING_CHUNK, PRICING_PREFETCH,
)
from bookings.models import Quote
from bookings.services.booking_pricing import pricing_input_for
from bookings.services.totals import PricingInput, price_booking
from events.models import Event, resolve_booking_segments


class Command(BaseCommand):
    help = 'List bookings whose in-count segments sum to less than guest_count. Read-only.'

    def add_arguments(self, parser):
        parser.add_argument('--org', type=int, help='Limit to one organisation id.')

    def handle(self, *args, **options):
        rows = []
        for kind, queryset in (('quote', Quote.objects.all()), ('event', Event.objects.all())):
            if options.get('org'):
                queryset = queryset.filter(organisation_id=options['org'])
            for booking in queryset.prefetch_related(*PRICING_PREFETCH).iterator(
                    chunk_size=PRICING_CHUNK):
                shortfall = self._shortfall(booking)
                if shortfall:
                    rows.append((kind, booking) + shortfall)

        if not rows:
            self.stdout.write(self.style.SUCCESS(
                'No under-covering bookings. Every breakdown accounts for its guests.'))
            return

        self.stdout.write(self.style.WARNING(
            f'{len(rows)} booking(s) are priced for fewer guests than they claim.\n'
            'NOTHING HAS BEEN CHANGED — this is a report.\n'))
        self.stdout.write(
            f'{"kind":6} {"id":>5} {"status":12} {"seen":5} '
            f'{"guests":>7} {"covered":>8} {"total now":>12} {"total if fixed":>15}')
        for kind, booking, covered, current, repaired in rows:
            seen = 'YES' if self._client_has_seen_it(kind, booking) else '-'
            self.stdout.write(
                f'{kind:6} {booking.pk:>5} {getattr(booking, "status", "?"):12} {seen:5} '
                f'{booking.guest_count or 0:>7} {covered:>8} {current:>12} {repaired:>15}')

        self.stdout.write(
            '\n"seen" means the client has been shown these numbers (a sent/accepted'
            '\nquote, or a confirmed/completed event). Those are the ones where the'
            '\nrepaired total is a CONVERSATION, not a fix.')

    def _shortfall(self, booking):
        """``(covered, current_total, repaired_total)`` or None when it adds up."""
        guest_count = booking.guest_count or 0
        if guest_count <= 0:
            return None
        segments = resolve_booking_segments(booking)
        covered = sum(
            int(s.get('count') or 0) for s in segments if s.get('counts_toward_total', True))
        if covered >= guest_count:
            return None

        # What it would be worth with the missing covers priced at the default rate —
        # the same remainder the write path now derives.
        data = pricing_input_for(booking)
        patched = PricingInput(
            price_per_head=data.price_per_head, guest_count=data.guest_count,
            segments=tuple(segments) + (
                {'name': '(missing covers)', 'count': guest_count - covered,
                 'price_multiplier': 1, 'counts_toward_total': True},),
            meals=data.meals, line_items=data.line_items, tax_rate=data.tax_rate,
            service_charge_pct=data.service_charge_pct,
            service_charge_taxable=data.service_charge_taxable,
            gratuity_pct=data.gratuity_pct,
        )
        return covered, booking.total, price_booking(patched).totals['total']

    @staticmethod
    def _client_has_seen_it(kind, booking):
        # IMPORTED, not re-declared. This was a verbatim copy of the same two sets,
        # so the two commands could disagree about which bookings are safe to touch —
        # and they did: this copy omitted `in_progress`, printing "-" (nobody has
        # seen it) against an event being catered that day, under a footer telling
        # the reader that those rows are the safe ones to repair.
        from bookings.management.commands.reconcile_booking_totals import CLIENT_HAS_SEEN_IT
        return getattr(booking, 'status', None) in CLIENT_HAS_SEEN_IT[kind]
