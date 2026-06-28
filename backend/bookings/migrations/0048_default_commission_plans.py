from decimal import Decimal

from django.db import migrations


def create_default_plans(apps, schema_editor):
    """Each org's existing commission config becomes its 'Default' plan, and any
    existing bands move under it — so nothing changes behaviourally."""
    Organisation = apps.get_model('users', 'Organisation')
    OrgSettings = apps.get_model('bookings', 'OrgSettings')
    CommissionPlan = apps.get_model('bookings', 'CommissionPlan')
    CommissionBand = apps.get_model('bookings', 'CommissionBand')

    for org in Organisation.objects.all():
        settings = OrgSettings.objects.filter(organisation=org).first()
        model = settings.commission_model if settings else 'flat'
        rate = settings.commission_flat_rate if settings else Decimal('0.00')

        plan, _ = CommissionPlan.objects.get_or_create(
            organisation=org, is_default=True,
            defaults={'name': 'Default', 'commission_model': model, 'commission_flat_rate': rate},
        )
        CommissionBand.objects.filter(organisation=org, plan__isnull=True).update(plan=plan)


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0047_commissionplan_and_more'),
    ]

    operations = [
        migrations.RunPython(create_default_plans, migrations.RunPython.noop),
    ]
