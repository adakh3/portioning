import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Generalize EventMeal -> BookingMeal so a meal can belong to a quote OR an
    event (exactly one), mirroring BookingLineItem. RenameModel preserves the
    table + M2M-through + all existing event meal rows (event FK unchanged); we
    just add the optional quote parent and the one-parent constraint."""

    dependencies = [
        ('events', '0020_event_assigned_to'),
        ('bookings', '0050_periodwise_sales_targets'),
    ]

    operations = [
        migrations.RenameModel(old_name='EventMeal', new_name='BookingMeal'),
        migrations.RenameModel(old_name='EventMealDishComment', new_name='BookingMealDishComment'),
        migrations.AlterField(
            model_name='bookingmeal',
            name='event',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name='additional_meals', to='events.event',
            ),
        ),
        migrations.AddField(
            model_name='bookingmeal',
            name='quote',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name='additional_meals', to='bookings.quote',
            ),
        ),
        migrations.AddConstraint(
            model_name='bookingmeal',
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(('event__isnull', True), ('quote__isnull', False)),
                    models.Q(('event__isnull', False), ('quote__isnull', True)),
                    _connector='OR',
                ),
                name='bookingmeal_exactly_one_parent',
            ),
        ),
    ]
