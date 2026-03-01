"""Make Event.account required (non-nullable, PROTECT)."""

import django.db.models.deletion
from django.db import migrations, models


def backfill_account(apps, schema_editor):
    """Assign the first Account to any events missing one."""
    Event = apps.get_model('events', 'Event')
    Account = apps.get_model('bookings', 'Account')
    orphans = Event.objects.filter(account__isnull=True)
    if not orphans.exists():
        return
    default_account = Account.objects.first()
    if default_account is None:
        raise RuntimeError(
            'Cannot migrate: there are events without an account '
            'but no accounts exist to assign them to.'
        )
    orphans.update(account=default_account)


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0006_price_per_head'),
        ('bookings', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(backfill_account, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='event',
            name='account',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='events',
                to='bookings.account',
            ),
        ),
    ]
