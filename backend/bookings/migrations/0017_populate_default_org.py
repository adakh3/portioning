"""Data migration: create default org, assign all existing data, copy SiteSettings → OrgSettings."""
from django.db import migrations


def populate_default_org(apps, schema_editor):
    Organisation = apps.get_model('users', 'Organisation')
    User = apps.get_model('users', 'User')
    OrgSettings = apps.get_model('bookings', 'OrgSettings')
    SiteSettings = apps.get_model('bookings', 'SiteSettings')

    # 1. Get or create default org
    org, _ = Organisation.objects.get_or_create(
        slug='default',
        defaults={'name': 'Default Organisation', 'country': 'PK', 'is_active': True},
    )

    # 2. Assign all users to this org
    User.objects.filter(organisation__isnull=True).update(organisation=org)

    # 3. Assign all tenant-scoped models to this org
    model_refs = [
        ('bookings', 'Account'),
        ('bookings', 'Venue'),
        ('bookings', 'Lead'),
        ('bookings', 'Quote'),
        ('bookings', 'ProductLine'),
        ('bookings', 'EventTypeOption'),
        ('bookings', 'SourceOption'),
        ('bookings', 'ServiceStyleOption'),
        ('bookings', 'LeadStatusOption'),
        ('bookings', 'LostReasonOption'),
        ('events', 'Event'),
        ('dishes', 'Dish'),
        ('dishes', 'DishCategory'),
        ('menus', 'MenuTemplate'),
        ('staff', 'LaborRole'),
        ('staff', 'StaffMember'),
        ('equipment', 'EquipmentItem'),
    ]
    for app_label, model_name in model_refs:
        Model = apps.get_model(app_label, model_name)
        Model.objects.filter(organisation__isnull=True).update(organisation=org)

    # 4. Copy SiteSettings → OrgSettings
    try:
        site = SiteSettings.objects.get(pk=1)
        OrgSettings.objects.get_or_create(
            organisation=org,
            defaults={
                'currency_symbol': site.currency_symbol,
                'currency_code': site.currency_code,
                'date_format': site.date_format,
                'default_price_per_head': site.default_price_per_head,
                'target_food_cost_percentage': site.target_food_cost_percentage,
                'price_rounding_step': site.price_rounding_step,
            },
        )
    except SiteSettings.DoesNotExist:
        OrgSettings.objects.get_or_create(organisation=org)


def reverse_populate(apps, schema_editor):
    # No-op: don't remove data on reverse
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('bookings', '0016_org_multitenancy'),
        ('users', '0005_org_enrich'),
        ('events', '0004_org_multitenancy'),
        ('dishes', '0002_org_multitenancy'),
        ('menus', '0002_org_multitenancy'),
        ('staff', '0003_org_multitenancy'),
        ('equipment', '0002_org_multitenancy'),
    ]

    operations = [
        migrations.RunPython(populate_default_org, reverse_populate),
    ]
