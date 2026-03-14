"""Add nullable customer FK to Event."""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0006_merge_20260312_2210'),
        ('bookings', '0022_create_customer'),
    ]

    operations = [
        migrations.AddField(
            model_name='event',
            name='customer',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='events', to='bookings.customer'),
        ),
    ]
