from django.db import migrations


def reassign_to_lead_owner(apps, schema_editor):
    """Historically a follow-up was assigned to whoever *created* it, so reminders
    an admin/manager scheduled on a rep's lead sat in the wrong person's list.
    Going forward they're assigned to the lead's owner; realign the outstanding
    (pending/snoozed) ones so nobody's follow-ups silently disappear or double up.
    Done/dismissed reminders are historical and left untouched.
    """
    Reminder = apps.get_model('bookings', 'Reminder')
    outstanding = Reminder.objects.filter(
        status__in=('pending', 'snoozed'),
    ).select_related('lead')
    for reminder in outstanding.iterator():
        lead = reminder.lead
        owner_id = lead.assigned_to_id or lead.created_by_id
        if owner_id and owner_id != reminder.user_id:
            reminder.user_id = owner_id
            reminder.save(update_fields=['user'])


def noop_reverse(apps, schema_editor):
    # Not reversible — the pre-migration assignee (the creator) isn't recoverable
    # from the data alone. created_by is preserved, so no information is lost.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0057_merge_20260710_1313'),
    ]

    operations = [
        migrations.RunPython(reassign_to_lead_owner, noop_reverse),
    ]
