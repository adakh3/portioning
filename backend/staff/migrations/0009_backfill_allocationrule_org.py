"""Backfill AllocationRule.organisation from its LaborRole's organisation, so the
new FK can become non-null (each rule belongs to its role's org)."""
from django.db import migrations


def backfill(apps, schema_editor):
    AllocationRule = apps.get_model('staff', 'AllocationRule')
    for rule in AllocationRule.objects.select_related('role'):
        if rule.organisation_id is None and rule.role_id is not None:
            rule.organisation_id = rule.role.organisation_id
            rule.save(update_fields=['organisation'])


class Migration(migrations.Migration):

    dependencies = [
        ('staff', '0008_allocationrule_organisation_alter_laborrole_name_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
