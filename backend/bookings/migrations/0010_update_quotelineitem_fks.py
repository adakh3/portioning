import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0009_remove_staffing_equipment_models'),
        ('staff', '0001_initial'),
        ('equipment', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterField(
                    model_name='quotelineitem',
                    name='equipment_item',
                    field=models.ForeignKey(
                        blank=True, null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='quote_line_items',
                        to='equipment.equipmentitem',
                    ),
                ),
                migrations.AlterField(
                    model_name='quotelineitem',
                    name='labor_role',
                    field=models.ForeignKey(
                        blank=True, null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='quote_line_items',
                        to='staff.laborrole',
                    ),
                ),
            ],
            database_operations=[],
        ),
    ]
