"""No-op migration (placeholder to keep migration graph intact).

Workflow options (LeadStatusOption, LostReasonOption) are seeded only
when a new Organisation is created, via the post_save signal in
users/signals.py.  No bulk backfill on existing orgs.
"""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('bookings', '0027_seed_choice_options'),
    ]

    operations = []
