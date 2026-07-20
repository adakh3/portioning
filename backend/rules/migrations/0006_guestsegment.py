"""Generalize GuestProfile → GuestSegment: rename the model (preserving existing
gents/ladies rows) and add the price/ordering/flag fields. 'gents'/'ladies' become
ordinary segment names, not a built-in gender assumption."""
from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('rules', '0005_alter_budgetprofile_id_alter_categoryconstraint_id_and_more'),
        ('users', '0007_alter_organisation_country'),
    ]

    operations = [
        migrations.RenameModel(old_name='GuestProfile', new_name='GuestSegment'),
        migrations.AlterModelOptions(
            name='guestsegment',
            options={'ordering': ['sort_order', 'name']},
        ),
        migrations.AlterField(
            model_name='guestsegment',
            name='portion_multiplier',
            field=models.FloatField(default=1.0, help_text='Food scaling vs base (1.0 adult, 0.6 child).'),
        ),
        migrations.AlterField(
            model_name='guestsegment',
            name='organisation',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='guest_segments', to='users.organisation',
            ),
        ),
        migrations.AddField(
            model_name='guestsegment',
            name='price_multiplier',
            field=models.DecimalField(
                decimal_places=4, default=Decimal('1.0000'), max_digits=5,
                help_text='Charge vs base per-head price (1.0 full, 0.5 half).',
            ),
        ),
        migrations.AddField(
            model_name='guestsegment',
            name='sort_order',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='guestsegment',
            name='is_default',
            field=models.BooleanField(
                default=False,
                help_text='The base segment new bookings start with (e.g. Adults).',
            ),
        ),
        migrations.AddField(
            model_name='guestsegment',
            name='is_active',
            field=models.BooleanField(default=True),
        ),
    ]
