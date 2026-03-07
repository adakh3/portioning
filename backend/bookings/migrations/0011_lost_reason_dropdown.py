import django.db.models.deletion
from django.db import migrations, models


def seed_lost_reasons(apps, schema_editor):
    LostReasonOption = apps.get_model('bookings', 'LostReasonOption')
    defaults = [
        ('too_expensive', 'Too expensive', 0),
        ('competitor', 'Went with competitor', 1),
        ('date_unavailable', 'Date unavailable', 2),
        ('no_response', 'No response', 3),
        ('budget_cut', 'Budget cut', 4),
        ('changed_plans', 'Changed plans', 5),
        ('other', 'Other', 6),
    ]
    for value, label, sort_order in defaults:
        LostReasonOption.objects.get_or_create(
            value=value,
            defaults={'label': label, 'sort_order': sort_order},
        )


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0010_update_quotelineitem_fks'),
    ]

    operations = [
        # 1. Create LostReasonOption model
        migrations.CreateModel(
            name='LostReasonOption',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('value', models.CharField(max_length=50, unique=True)),
                ('label', models.CharField(max_length=100)),
                ('sort_order', models.IntegerField(default=0)),
                ('is_active', models.BooleanField(default=True)),
            ],
            options={
                'ordering': ['sort_order', 'pk'],
            },
        ),
        # 2. Rename lost_reason -> lost_notes
        migrations.RenameField(
            model_name='lead',
            old_name='lost_reason',
            new_name='lost_notes',
        ),
        # 3. Add lost_reason_option FK
        migrations.AddField(
            model_name='lead',
            name='lost_reason_option',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='leads',
                to='bookings.lostreasonoption',
            ),
        ),
        # 4. Seed default options
        migrations.RunPython(seed_lost_reasons, migrations.RunPython.noop),
    ]
