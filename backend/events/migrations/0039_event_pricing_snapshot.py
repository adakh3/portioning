"""An event carries the engine's whole answer (REL-464).

The twin of `bookings/0079` — see that file for why the column is added in its own
migration, separate from the invariant that can abort.
"""
from django.db import migrations, models


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
    ]
