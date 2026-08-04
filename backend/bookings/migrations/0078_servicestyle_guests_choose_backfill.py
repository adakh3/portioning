from django.db import migrations


def set_plated_offers_choices(apps, schema_editor):
    """Reproduce today's behaviour exactly, once, for every existing org (REL-452).

    Until now the rule was a hardcoded `service_style == 'plated'`, so the honest
    migration of it is: the row whose value is literally `plated` gets the flag, and
    nothing else does. The column default already leaves every other row False, so
    this is the whole backfill — no org's bookings change on deploy.

    Deliberately keyed on `value`, not the label: `value` is what bookings store and
    what the old check compared. An org that renamed its plated row to "Plated /
    Sit-down" kept the slug, so it keeps the behaviour; an org that added its own
    "Plated (duet)" never had the behaviour, so it doesn't gain it here. Whether they
    *want* it is now a question they can answer in Settings, which is the point.
    """
    ServiceStyleOption = apps.get_model('bookings', 'ServiceStyleOption')
    ServiceStyleOption.objects.filter(value='plated').update(guests_choose=True)


def unset(apps, schema_editor):
    ServiceStyleOption = apps.get_model('bookings', 'ServiceStyleOption')
    ServiceStyleOption.objects.update(guests_choose=False)


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0077_servicestyleoption_guests_choose'),
    ]

    operations = [
        migrations.RunPython(set_plated_offers_choices, unset),
    ]
