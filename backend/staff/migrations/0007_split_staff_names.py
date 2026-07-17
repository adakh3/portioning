from django.db import migrations


def split_names(apps, schema_editor):
    """Backfill first/last from the single name — same rule as bookings.0062:
    last word is the surname, everything before it the first name."""
    def split(full):
        parts = (full or '').strip().split()
        if not parts:
            return '', ''
        if len(parts) == 1:
            return parts[0], ''
        return ' '.join(parts[:-1]), parts[-1]

    StaffMember = apps.get_model('staff', 'StaffMember')
    to_update = []
    for obj in StaffMember.objects.all().iterator():
        if obj.first_name or obj.last_name:
            continue
        first, last = split(obj.name)
        if first:
            obj.first_name, obj.last_name = first, last
            to_update.append(obj)
    StaffMember.objects.bulk_update(to_update, ['first_name', 'last_name'], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ('staff', '0006_staffmember_first_name_staffmember_last_name'),
    ]

    operations = [
        migrations.RunPython(split_names, migrations.RunPython.noop),
    ]
