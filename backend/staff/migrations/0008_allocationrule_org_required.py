"""Make AllocationRule.organisation non-null now that 0007 has backfilled every
row from its role's organisation."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('staff', '0007_backfill_allocationrule_org'),
        ('users', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='allocationrule',
            name='organisation',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='allocation_rules',
                to='users.organisation',
            ),
        ),
    ]
