from django.db import migrations


def populate_default_org(apps, schema_editor):
    Organisation = apps.get_model('users', 'Organisation')
    org = Organisation.objects.first()
    if not org:
        return

    for model_name in ('GlobalConfig', 'GlobalConstraint', 'BudgetProfile', 'GuestProfile', 'CombinationRule'):
        Model = apps.get_model('rules', model_name)
        Model.objects.filter(organisation__isnull=True).update(organisation=org)


class Migration(migrations.Migration):

    dependencies = [
        ('rules', '0002_org_multitenancy'),
    ]

    operations = [
        migrations.RunPython(populate_default_org, migrations.RunPython.noop),
    ]
