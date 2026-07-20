from django.db import migrations


def split_two_word_names(apps, schema_editor):
    """Backfill first/last parts from existing single names.

    Same rule as bookings.names: the last word is the surname, everything
    before it the first name; a single word is a first name with no surname.
    The display name keeps working either way.
    """
    def split(full):
        parts = (full or '').strip().split()
        if not parts:
            return '', ''
        if len(parts) == 1:
            return parts[0], ''
        return ' '.join(parts[:-1]), parts[-1]

    Lead = apps.get_model('bookings', 'Lead')
    Contact = apps.get_model('bookings', 'Contact')
    for Model, name_field, first_field, last_field in [
        (Lead, 'contact_name', 'contact_first_name', 'contact_last_name'),
        (Contact, 'name', 'first_name', 'last_name'),
    ]:
        to_update = []
        for obj in Model.objects.all().iterator():
            if getattr(obj, first_field) or getattr(obj, last_field):
                continue
            first, last = split(getattr(obj, name_field))
            if first:
                setattr(obj, first_field, first)
                setattr(obj, last_field, last)
                to_update.append(obj)
        Model.objects.bulk_update(to_update, [first_field, last_field], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0061_contact_first_name_contact_last_name_and_more'),
    ]

    operations = [
        migrations.RunPython(split_two_word_names, migrations.RunPython.noop),
    ]
