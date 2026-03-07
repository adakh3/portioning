import django.core.validators
import django.db.models.deletion
from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('events', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='EquipmentItem',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('name', models.CharField(max_length=200)),
                        ('category', models.CharField(choices=[('chafer', 'Chafer / Warmer'), ('table', 'Table'), ('linen', 'Linen'), ('glassware', 'Glassware'), ('cooking', 'Cooking Equipment'), ('serving', 'Serving Equipment'), ('decor', 'Decor'), ('transport', 'Transport'), ('other', 'Other')], default='other', max_length=20)),
                        ('description', models.TextField(blank=True)),
                        ('stock_quantity', models.IntegerField(default=0, validators=[django.core.validators.MinValueValidator(0)])),
                        ('rental_price', models.DecimalField(decimal_places=2, default=Decimal('0.00'), help_text='Per unit per event', max_digits=10, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                        ('replacement_cost', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                        ('notes', models.TextField(blank=True)),
                        ('is_active', models.BooleanField(default=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        'db_table': 'bookings_equipmentitem',
                        'ordering': ['category', 'name'],
                    },
                ),
                migrations.CreateModel(
                    name='EquipmentReservation',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('quantity_out', models.IntegerField(validators=[django.core.validators.MinValueValidator(1)])),
                        ('quantity_returned', models.IntegerField(blank=True, null=True, validators=[django.core.validators.MinValueValidator(0)])),
                        ('return_condition', models.CharField(choices=[('pending', 'Pending'), ('good', 'Good'), ('damaged', 'Damaged'), ('lost', 'Lost')], default='pending', max_length=20)),
                        ('notes', models.TextField(blank=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('equipment', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='reservations', to='equipment.equipmentitem')),
                        ('event', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='equipment_reservations', to='events.event')),
                    ],
                    options={
                        'db_table': 'bookings_equipmentreservation',
                        'ordering': ['equipment__name'],
                        'unique_together': {('event', 'equipment')},
                    },
                ),
            ],
            database_operations=[],
        ),
    ]
