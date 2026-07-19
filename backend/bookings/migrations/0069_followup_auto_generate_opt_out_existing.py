# 0067 added followup_auto_generate while its default was still True, so every
# org that existed at that moment was silently opted IN to scheduled generation.
# The launch decision is opt-in (default False, 0068) — reset existing rows so
# nobody auto-runs without having chosen to.
from django.db import migrations


def opt_out(apps, schema_editor):
    OrgSettings = apps.get_model('bookings', 'OrgSettings')
    OrgSettings.objects.update(followup_auto_generate=False)


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0068_alter_orgsettings_followup_auto_generate'),
    ]

    operations = [
        migrations.RunPython(opt_out, migrations.RunPython.noop),
    ]
