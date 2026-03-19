"""Data migration: seed default choice options using get_or_create.

Creates records only when (organisation, value) doesn't already exist,
so custom edits and additions on prod are preserved across deploys.
"""
from django.db import migrations


CHOICE_DATA = {
    'EventTypeOption': [
        ('wedding', 'Wedding', 0),
        ('corporate', 'Corporate Event', 1),
        ('birthday', 'Birthday Party', 2),
        ('funeral', 'Funeral / Wake', 3),
        ('religious', 'Religious Event', 4),
        ('social', 'Social Gathering', 5),
        ('other', 'Other', 6),
    ],
    'SourceOption': [
        ('website', 'Website', 0),
        ('referral', 'Referral', 1),
        ('phone', 'Phone', 2),
        ('email', 'Email', 3),
        ('social', 'Social Media', 4),
        ('walk_in', 'Walk-in', 5),
        ('repeat', 'Repeat Customer', 6),
        ('facebook', 'Facebook', 7),
        ('instagram', 'Instagram', 8),
    ],
    'ServiceStyleOption': [
        ('buffet', 'Buffet', 0),
        ('plated', 'Plated / Sit-down', 1),
        ('stations', 'Food Stations', 2),
        ('family_style', 'Family Style', 3),
        ('boxed', 'Boxed / Individual', 4),
        ('canapes', 'Canapés', 5),
        ('mixed', 'Mixed Service', 6),
    ],
    'LeadStatusOption': [
        ('new', 'New', 0),
        ('contacted', 'Contacted', 1),
        ('qualified', 'Qualified', 2),
        ('proposal_sent', 'Proposal Sent', 3),
        ('won', 'Won', 4),
        ('lost', 'Lost', 5),
    ],
    'LostReasonOption': [
        ('too_expensive', 'Too expensive', 0),
        ('competitor', 'Went with competitor', 1),
        ('date_unavailable', 'Date unavailable', 2),
        ('no_response', 'No response', 3),
        ('budget_cut', 'Budget cut', 4),
        ('changed_plans', 'Changed plans', 5),
        ('other', 'Other', 6),
    ],
    'MealTypeOption': [
        ('breakfast', 'Breakfast', 0),
        ('brunch', 'Brunch', 1),
        ('lunch', 'Lunch', 2),
        ('dinner', 'Dinner', 3),
        ('supper', 'Supper', 4),
        ('high_tea', 'High Tea', 5),
    ],
    'ArrangementTypeOption': [
        ('buffet_station', 'Buffet Station', 0),
        ('round_table_setting', 'Round Table Setting', 1),
        ('trestle_table_setting', 'Trestle Table Setting', 2),
        ('cocktail_table', 'Cocktail / Poseur Table', 3),
        ('live_cooking_station', 'Live Cooking Station', 4),
        ('drinks_station', 'Drinks Station', 5),
        ('dessert_display', 'Dessert Display', 6),
        ('hot_box', 'Hot Box / Transport', 7),
    ],
    'BeverageTypeOption': [
        ('water', 'Water', 0),
        ('soft_drinks', 'Soft Drinks', 1),
        ('juices', 'Juices', 2),
        ('tea_coffee', 'Tea & Coffee', 3),
        ('mocktails', 'Mocktails', 4),
        ('lassi', 'Lassi', 5),
        ('sherbet', 'Sherbet', 6),
        ('milkshake', 'Milkshake', 7),
    ],
}


def seed_choices(apps, schema_editor):
    Organisation = apps.get_model('users', 'Organisation')
    for org in Organisation.objects.all():
        for model_name, rows in CHOICE_DATA.items():
            Model = apps.get_model('bookings', model_name)
            for value, label, sort_order in rows:
                Model.objects.get_or_create(
                    organisation=org,
                    value=value,
                    defaults={'label': label, 'sort_order': sort_order},
                )


class Migration(migrations.Migration):
    dependencies = [
        ('bookings', '0026_extend_date_format_max_length'),
    ]

    operations = [
        migrations.RunPython(seed_choices, migrations.RunPython.noop),
    ]
