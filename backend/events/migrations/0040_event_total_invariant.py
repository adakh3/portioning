"""An event's total must be the sum of its parts (REL-464).

The exact mirror of `bookings/0080` — see that file for why the check aborts with a
listing instead of repairing the data it finds, and why the snapshot column is added
by a separate earlier migration.
"""
from decimal import Decimal

from django.db import migrations, models


_PARTS = (
    models.F('subtotal') + models.F('service_charge')
    + models.F('tax_amount') + models.F('gratuity')
)
# Half-cent band — SQLite adds DecimalFields as floats, so exact equality rejects
# numbers that are correct to the cent. See Quote.Meta.
TOTAL_INVARIANT = (
    models.Q(total__gte=_PARTS - Decimal('0.005'))
    & models.Q(total__lte=_PARTS + Decimal('0.005'))
)


def refuse_to_apply_over_bad_rows(apps, schema_editor):
    Event = apps.get_model('events', 'Event')
    bad = list(
        Event.objects.exclude(TOTAL_INVARIANT)
        .values('id', 'status', 'subtotal', 'service_charge', 'tax_amount',
                'gratuity', 'total')[:50]
    )
    if not bad:
        return
    lines = [
        f"  event {r['id']} ({r['status']}): stored total {r['total']} but "
        f"{r['subtotal']} + {r['service_charge']} + {r['tax_amount']} + "
        f"{r['gratuity']} = "
        f"{r['subtotal'] + r['service_charge'] + r['tax_amount'] + r['gratuity']}"
        for r in bad
    ]
    raise RuntimeError(
        'Cannot add the event total invariant: these rows do not add up.\n'
        + '\n'.join(lines)
        + '\n\nNothing has been changed. Run `python manage.py reconcile_booking_totals`'
          ' to see the full list with what the engine would compute, and decide per'
          ' booking — a confirmed or signed event must not be silently re-priced.'
    )


def noop_reverse(apps, schema_editor):
    """Nothing to undo — the check above only ever reads."""


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0039_event_pricing_snapshot'),
    ]

    operations = [
        migrations.RunPython(refuse_to_apply_over_bad_rows, noop_reverse),
        migrations.AddConstraint(
            model_name='event',
            constraint=models.CheckConstraint(
                condition=TOTAL_INVARIANT, name='event_total_is_the_sum_of_its_parts',
            ),
        ),
    ]
