"""A quote's total must be the sum of its parts (REL-464).

Adding a constraint to a table with violating rows fails at the database with an
opaque error naming only the constraint, so this checks first and **aborts with the
offending rows listed**. It never edits data to make itself applicable — a booking
whose stored total is a lie is a thing the owner needs to see, not something a
migration quietly rewrites.

The snapshot column is added by `0079`, which is a separate migration on purpose:
this one can abort, and a failed migration is rolled back atomically. Together they
took the column down with them, which broke `reconcile_booking_totals` — the exact
command the error below tells the operator to run.
"""
from decimal import Decimal

from django.db import migrations, models


_PARTS = (
    models.F('subtotal') + models.F('service_charge')
    + models.F('tax_amount') + models.F('gratuity')
)
# A half-cent band, not exact equality: SQLite gives DecimalField NUMERIC affinity
# and adds these as IEEE doubles, so 14201.20 + 1171.60 evaluates to
# 15372.800000000001 and an exact check rejects numbers that are right to the cent.
# See Quote.Meta for the full reasoning. Any drift worth catching is >= 1 cent.
TOTAL_INVARIANT = (
    models.Q(total__gte=_PARTS - Decimal('0.005'))
    & models.Q(total__lte=_PARTS + Decimal('0.005'))
)


def refuse_to_apply_over_bad_rows(apps, schema_editor):
    Quote = apps.get_model('bookings', 'Quote')
    bad = list(
        Quote.objects.exclude(TOTAL_INVARIANT)
        .values('id', 'status', 'subtotal', 'service_charge', 'tax_amount',
                'gratuity', 'total')[:50]
    )
    if not bad:
        return
    lines = [
        f"  quote {r['id']} ({r['status']}): stored total {r['total']} but "
        f"{r['subtotal']} + {r['service_charge']} + {r['tax_amount']} + "
        f"{r['gratuity']} = "
        f"{r['subtotal'] + r['service_charge'] + r['tax_amount'] + r['gratuity']}"
        for r in bad
    ]
    raise RuntimeError(
        'Cannot add the quote total invariant: these rows do not add up.\n'
        + '\n'.join(lines)
        + '\n\nNothing has been changed. Run `python manage.py reconcile_booking_totals`'
          ' to see the full list with what the engine would compute, and decide per'
          ' booking — a sent or accepted quote must not be silently re-priced.'
    )


def noop_reverse(apps, schema_editor):
    """Nothing to undo — the check above only ever reads."""


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0079_quote_pricing_snapshot'),
    ]

    operations = [
        migrations.RunPython(refuse_to_apply_over_bad_rows, noop_reverse),
        migrations.AddConstraint(
            model_name='quote',
            constraint=models.CheckConstraint(
                condition=TOTAL_INVARIANT, name='quote_total_is_the_sum_of_its_parts',
            ),
        ),
    ]
