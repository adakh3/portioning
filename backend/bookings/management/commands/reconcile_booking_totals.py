"""Recompute every booking through the engine and report anything that disagrees.

The stored money is supposed to be the engine's answer. This proves it, or names
the rows where it isn't — a booking whose stored total drifted should be found by a
scheduled command, not by a customer reading their invoice.

Read-only by default, and exits 1 on any diff so CI or a post-deploy job can gate
on it. `--apply` exists but refuses to touch anything a client has already seen.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from bookings.models import Quote
from bookings.services.booking_pricing import pricing_input_for
from bookings.services.totals import price_booking
from events.models import Event

# Fields compared against the engine. `pricing_snapshot` is checked separately —
# it is a whole document, not a number.
MONEY_FIELDS = ('subtotal', 'service_charge', 'tax_amount', 'gratuity', 'total')

# A booking in one of these states has been shown to, or agreed with, a client.
# Re-pricing it silently would change a number someone is holding on paper, so
# `--apply` refuses and leaves the decision to a person.
CLIENT_HAS_SEEN_IT = {
    'quote': {'sent', 'accepted', 'declined', 'expired'},
    'event': {'confirmed', 'completed'},
}


class Command(BaseCommand):
    help = 'Recompute every booking through the pricing engine and report drift.'

    def add_arguments(self, parser):
        parser.add_argument('--org', type=int, help='Limit to one organisation id.')
        parser.add_argument(
            '--apply', action='store_true',
            help='Rewrite drifting rows that no client has seen. Refuses the rest.',
        )

    def handle(self, *args, **options):
        drifted = []
        for kind, queryset in (('quote', Quote.objects.all()), ('event', Event.objects.all())):
            if options.get('org'):
                queryset = queryset.filter(organisation_id=options['org'])
            for booking in queryset.select_related('organisation').iterator():
                diffs = self._diff(booking)
                if diffs:
                    drifted.append((kind, booking, diffs))

        if not drifted:
            self.stdout.write(self.style.SUCCESS(
                'Every booking matches the engine. Nothing to report.'))
            return

        self.stdout.write(self.style.WARNING(
            f'{len(drifted)} booking(s) disagree with the engine:\n'))
        repaired = refused = 0
        for kind, booking, diffs in drifted:
            status = getattr(booking, 'status', '?')
            self.stdout.write(f'{kind} {booking.pk} ({status}) — org {booking.organisation_id}')
            for field, stored, computed in diffs:
                self.stdout.write(f'    {field}: stored {stored}  engine {computed}')
            if not options.get('apply'):
                continue
            if status in CLIENT_HAS_SEEN_IT[kind]:
                refused += 1
                self.stdout.write(self.style.WARNING(
                    f'    REFUSED — this {kind} is "{status}"; a client has already been'
                    f' shown these numbers. Re-price it deliberately, not in a sweep.'))
                continue
            with transaction.atomic():
                booking.recalculate_totals()
            repaired += 1
            self.stdout.write(self.style.SUCCESS('    repriced'))

        if options.get('apply'):
            self.stdout.write(f'\nRepriced {repaired}, refused {refused}.')
        # Non-zero either way: a refusal is still an unresolved disagreement.
        raise SystemExit(1)

    def _diff(self, booking):
        """``[(field, stored, computed)]`` — empty when the booking is consistent."""
        result = price_booking(pricing_input_for(booking))
        diffs = [
            (field, getattr(booking, field), result.totals[field])
            for field in MONEY_FIELDS
            if getattr(booking, field) != result.totals[field]
        ]
        # A snapshot that disagrees with its own columns is drift too — it is what
        # the documents render, so a stale one prints yesterday's price.
        snapshot = booking.pricing_snapshot
        if snapshot and snapshot.get('totals', {}).get('total') != str(booking.total):
            diffs.append(
                ('pricing_snapshot.totals.total',
                 snapshot.get('totals', {}).get('total'), str(booking.total)))
        return diffs
