"""A quote carries the engine's whole answer (REL-464).

`pricing_snapshot` holds the complete `PricingResult`. NULL for existing rows and
filled on the next recompute — nothing is backfilled, because a snapshot must
record what a booking IS, not what it should be, or it stops being evidence.

Deliberately SEPARATE from the invariant migration that follows it. That one aborts
when it finds rows whose totals don't add up, and Django rolls a failed migration
back atomically — so with both operations in one file, the abort took this column
with it and `reconcile_booking_totals`, the very command the error message tells
the operator to run, died on `column ... does not exist`. Split, the column
survives the abort and the diagnostic works.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0078_servicestyle_guests_choose_backfill'),
    ]

    operations = [
        migrations.AddField(
            model_name='quote',
            name='pricing_snapshot',
            field=models.JSONField(blank=True, default=None, null=True),
        ),
    ]
