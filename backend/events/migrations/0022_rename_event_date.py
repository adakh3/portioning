from django.db import migrations


class Migration(migrations.Migration):
    """Rename Event.date -> Event.event_date (the shared booking field name).
    RenameField is an in-place column rename: no data is moved."""

    dependencies = [
        ('events', '0021_generalize_eventmeal_to_bookingmeal'),
    ]

    operations = [
        migrations.RenameField(model_name='event', old_name='date', new_name='event_date'),
        migrations.AlterModelOptions(name='event', options={'ordering': ['-event_date']}),
    ]
