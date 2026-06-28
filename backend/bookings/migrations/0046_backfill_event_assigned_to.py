from django.db import migrations


def backfill_event_assigned_to(apps, schema_editor):
    """Set Event.assigned_to for existing events: the source lead's owner
    (Lead.assigned_to via won_event), else the event's creator."""
    Event = apps.get_model('events', 'Event')
    Lead = apps.get_model('bookings', 'Lead')

    lead_assignee = dict(
        Lead.objects
        .filter(won_event__isnull=False, assigned_to__isnull=False)
        .values_list('won_event_id', 'assigned_to_id')
    )

    for event in Event.objects.filter(assigned_to__isnull=True).iterator():
        assignee_id = lead_assignee.get(event.id) or event.created_by_id
        if assignee_id:
            Event.objects.filter(pk=event.pk).update(assigned_to_id=assignee_id)


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0045_orgsettings_commission_basis'),
        ('events', '0020_event_assigned_to'),
    ]

    operations = [
        migrations.RunPython(backfill_event_assigned_to, migrations.RunPython.noop),
    ]
