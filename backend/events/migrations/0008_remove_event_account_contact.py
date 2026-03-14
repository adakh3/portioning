"""Remove old account and primary_contact FKs from Event.

Uses SeparateDatabaseAndState since the referenced models (Account, Contact)
have been deleted and Django's SQLite backend cannot resolve them.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0007_event_customer'),
        ('bookings', '0023_migrate_account_to_customer'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name='event', name='account'),
                migrations.RemoveField(model_name='event', name='primary_contact'),
            ],
            database_operations=[
                migrations.RunSQL("DROP INDEX IF EXISTS events_event_account_id_d2faae99;"),
                migrations.RunSQL("DROP INDEX IF EXISTS events_event_primary_contact_id_b16d2948;"),
                migrations.RunSQL("ALTER TABLE events_event DROP COLUMN account_id;"),
                migrations.RunSQL("ALTER TABLE events_event DROP COLUMN primary_contact_id;"),
            ],
        ),
    ]
