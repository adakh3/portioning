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
                    name='LaborRole',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('name', models.CharField(max_length=100, unique=True)),
                        ('default_hourly_rate', models.DecimalField(decimal_places=2, max_digits=8)),
                        ('description', models.TextField(blank=True)),
                        ('is_active', models.BooleanField(default=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                    ],
                    options={
                        'db_table': 'bookings_laborrole',
                        'ordering': ['name'],
                    },
                ),
                migrations.CreateModel(
                    name='StaffMember',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('name', models.CharField(max_length=200)),
                        ('email', models.EmailField(blank=True, max_length=254)),
                        ('phone', models.CharField(blank=True, max_length=50)),
                        ('hourly_rate', models.DecimalField(blank=True, decimal_places=2, help_text='Override default role rate', max_digits=8, null=True)),
                        ('certifications', models.TextField(blank=True)),
                        ('emergency_contact', models.CharField(blank=True, max_length=200)),
                        ('emergency_phone', models.CharField(blank=True, max_length=50)),
                        ('is_active', models.BooleanField(default=True)),
                        ('notes', models.TextField(blank=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                        ('roles', models.ManyToManyField(blank=True, related_name='staff_members', to='staff.laborrole')),
                    ],
                    options={
                        'db_table': 'bookings_staffmember',
                        'ordering': ['name'],
                    },
                ),
                migrations.CreateModel(
                    name='Shift',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('start_time', models.DateTimeField()),
                        ('end_time', models.DateTimeField()),
                        ('break_minutes', models.IntegerField(default=0, validators=[django.core.validators.MinValueValidator(0)])),
                        ('hourly_rate', models.DecimalField(decimal_places=2, max_digits=8)),
                        ('status', models.CharField(choices=[('scheduled', 'Scheduled'), ('confirmed', 'Confirmed'), ('completed', 'Completed'), ('no_show', 'No Show'), ('cancelled', 'Cancelled')], default='scheduled', max_length=20)),
                        ('notes', models.TextField(blank=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('event', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shifts', to='events.event')),
                        ('role', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='shifts', to='staff.laborrole')),
                        ('staff_member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='shifts', to='staff.staffmember')),
                    ],
                    options={
                        'db_table': 'bookings_shift',
                        'ordering': ['start_time'],
                    },
                ),
            ],
            database_operations=[],
        ),
    ]
