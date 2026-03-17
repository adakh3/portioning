"""Data migration: ensure universal workflow options exist for every org.

Only seeds LeadStatusOption and LostReasonOption — these are pipeline
workflow states that every org needs.  Other choice option types
(event types, service styles, meal types, etc.) are org-specific and
configured via admin UI.

Uses get_or_create keyed on (organisation, value) so existing data is
preserved.
"""
from django.db import migrations


WORKFLOW_DATA = {
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
}


def seed_workflow_options(apps, schema_editor):
    Organisation = apps.get_model('users', 'Organisation')
    for org in Organisation.objects.all():
        for model_name, rows in WORKFLOW_DATA.items():
            Model = apps.get_model('bookings', model_name)
            for value, label, sort_order in rows:
                Model.objects.get_or_create(
                    organisation=org,
                    value=value,
                    defaults={'label': label, 'sort_order': sort_order},
                )


class Migration(migrations.Migration):
    dependencies = [
        ('bookings', '0027_seed_choice_options'),
    ]

    operations = [
        migrations.RunPython(seed_workflow_options, migrations.RunPython.noop),
    ]
