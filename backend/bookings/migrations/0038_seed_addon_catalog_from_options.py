"""Seed the add-on catalog from the existing label-only type lists.

Each ArrangementTypeOption / BeverageTypeOption becomes a featured AddOnProduct
with a single (price 0) variant, preserving the org's checkbox options. The old
option rows are left in place for now (removed in a later stage).
"""
from django.db import migrations


def seed(apps, schema_editor):
    ArrangementTypeOption = apps.get_model('bookings', 'ArrangementTypeOption')
    BeverageTypeOption = apps.get_model('bookings', 'BeverageTypeOption')
    AddOnProduct = apps.get_model('bookings', 'AddOnProduct')
    AddOnVariant = apps.get_model('bookings', 'AddOnVariant')
    db = schema_editor.connection.alias

    def migrate(options_qs, category):
        for opt in options_qs:
            product, created = AddOnProduct.objects.using(db).get_or_create(
                organisation_id=opt.organisation_id,
                name=opt.label,
                category=category,
                defaults={
                    'is_featured': True,
                    'is_active': opt.is_active,
                    'sort_order': opt.sort_order,
                },
            )
            if created:
                AddOnVariant.objects.using(db).create(
                    organisation_id=opt.organisation_id,
                    product=product,
                    name='',
                    unit_price=0,
                    is_active=True,
                    sort_order=0,
                )

    migrate(ArrangementTypeOption.objects.using(db).all(), 'rental')
    migrate(BeverageTypeOption.objects.using(db).all(), 'beverage')


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0037_addonproduct_addonvariant'),
    ]

    operations = [
        migrations.RunPython(seed, noop),
    ]
