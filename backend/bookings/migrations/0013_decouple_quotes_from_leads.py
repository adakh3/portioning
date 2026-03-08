"""
Decouple quotes from leads: rename converted→won, add proposal_sent status.

Schema changes:
- Rename converted_to_quote → won_quote
- Rename converted_at → won_at
- Add won_event FK to events.Event
- Add proposal_sent_at DateTimeField

Data changes:
- Lead records: status='converted' → status='won'
- ActivityLog records: action='converted' → action='won',
  new_value='converted' → new_value='won'
- LeadStatusOption: value='converted' → value='won', label='Won'
- Add LeadStatusOption: value='proposal_sent', label='Proposal Sent'
"""

from django.db import migrations, models
import django.db.models.deletion


def migrate_data_forward(apps, schema_editor):
    Lead = apps.get_model('bookings', 'Lead')
    ActivityLog = apps.get_model('bookings', 'ActivityLog')
    LeadStatusOption = apps.get_model('bookings', 'LeadStatusOption')

    # Update leads with status='converted' → 'won'
    Lead.objects.filter(status='converted').update(status='won')

    # Update activity logs
    ActivityLog.objects.filter(action='converted').update(action='won')
    ActivityLog.objects.filter(new_value='converted').update(new_value='won')
    ActivityLog.objects.filter(old_value='converted').update(old_value='won')

    # Update LeadStatusOption: converted → won
    LeadStatusOption.objects.filter(value='converted').update(value='won', label='Won')

    # Add proposal_sent status option (sort_order between qualified=2 and won=3)
    # First bump won and lost sort_orders up
    LeadStatusOption.objects.filter(value='won').update(sort_order=4)
    LeadStatusOption.objects.filter(value='lost').update(sort_order=5)

    LeadStatusOption.objects.get_or_create(
        value='proposal_sent',
        defaults={'label': 'Proposal Sent', 'sort_order': 3, 'is_active': True},
    )


def migrate_data_backward(apps, schema_editor):
    Lead = apps.get_model('bookings', 'Lead')
    ActivityLog = apps.get_model('bookings', 'ActivityLog')
    LeadStatusOption = apps.get_model('bookings', 'LeadStatusOption')

    Lead.objects.filter(status='won').update(status='converted')
    ActivityLog.objects.filter(action='won').update(action='converted')
    ActivityLog.objects.filter(new_value='won').update(new_value='converted')
    ActivityLog.objects.filter(old_value='won').update(old_value='converted')
    LeadStatusOption.objects.filter(value='won').update(value='converted', label='Converted', sort_order=3)
    LeadStatusOption.objects.filter(value='proposal_sent').delete()
    LeadStatusOption.objects.filter(value='lost').update(sort_order=4)


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0012_reminder'),
        ('events', '0002_alter_event_event_type_alter_event_service_style'),
    ]

    operations = [
        # Rename fields
        migrations.RenameField(
            model_name='lead',
            old_name='converted_to_quote',
            new_name='won_quote',
        ),
        migrations.RenameField(
            model_name='lead',
            old_name='converted_at',
            new_name='won_at',
        ),
        # Add new fields
        migrations.AddField(
            model_name='lead',
            name='won_event',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='source_lead',
                to='events.event',
            ),
        ),
        migrations.AddField(
            model_name='lead',
            name='proposal_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        # Data migration
        migrations.RunPython(migrate_data_forward, migrate_data_backward),
    ]
