"""An event carries the engine's whole answer, and its total must add up (REL-464).

The exact mirror of `bookings/0079` — see that file for why the constraint aborts
with a listing instead of repairing the data it finds.
"""
from decimal import Decimal

from django.db import migrations, models


_PARTS = (
    models.F('subtotal') + models.F('service_charge')
    + models.F('tax_amount') + models.F('gratuity')
)
# Half-cent band — see the twin migration in bookings/0079 and Quote.Meta for why
# exact equality is not usable here (SQLite adds DecimalFields as floats).
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
        ('events', '0038_event_beo_revised_at_event_beo_revision'),
    ]

    operations = [
        migrations.AddField(
            model_name='event',
            name='pricing_snapshot',
            field=models.JSONField(blank=True, default=None, null=True),
        ),
        migrations.RunPython(refuse_to_apply_over_bad_rows, noop_reverse),
        migrations.AddConstraint(
            model_name='event',
            constraint=models.CheckConstraint(
                condition=TOTAL_INVARIANT, name='event_total_is_the_sum_of_its_parts',
            ),
        ),
    ]
