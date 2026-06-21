"""Unify line items: rename QuoteLineItem -> BookingLineItem and let it attach to
an event too. Copy existing event arrangements/beverages into it. (The old event
models are dropped in events/0018.)

DDL (rename/add/alter/constraint) runs before the data copy, so the ALTERs never
sit in a transaction with pending data changes (the 0035 Postgres lesson).
"""
from decimal import Decimal

from django.db import migrations, models
import django.db.models.deletion


def copy_event_addons(apps, schema_editor):
    EventArrangement = apps.get_model('events', 'EventArrangement')
    EventBeverage = apps.get_model('events', 'EventBeverage')
    ArrangementTypeOption = apps.get_model('bookings', 'ArrangementTypeOption')
    BeverageTypeOption = apps.get_model('bookings', 'BeverageTypeOption')
    AddOnVariant = apps.get_model('bookings', 'AddOnVariant')
    BookingLineItem = apps.get_model('bookings', 'BookingLineItem')
    db = schema_editor.connection.alias

    def label_for(OptionModel, org_id, value):
        opt = OptionModel.objects.using(db).filter(organisation_id=org_id, value=value).first()
        return opt.label if opt else value

    def variant_for(org_id, product_name):
        return (AddOnVariant.objects.using(db)
                .filter(organisation_id=org_id, product__name=product_name).first())

    def copy(rows, type_attr, OptionModel, category):
        for row in rows:
            org_id = row.event.organisation_id
            label = label_for(OptionModel, org_id, getattr(row, type_attr))
            qty = Decimal(row.quantity)
            BookingLineItem.objects.using(db).create(
                event=row.event, variant=variant_for(org_id, label),
                category=category, description=label,
                quantity=qty, unit='each', unit_price=row.unit_price,
                is_taxable=True, line_total=(qty * row.unit_price), sort_order=0,
            )

    copy(EventArrangement.objects.using(db).select_related('event').all(),
         'arrangement_type', ArrangementTypeOption, 'rental')
    copy(EventBeverage.objects.using(db).select_related('event').all(),
         'beverage_type', BeverageTypeOption, 'beverage')


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0038_seed_addon_catalog_from_options'),
        ('events', '0017_event_is_b2b_person_first'),
    ]

    operations = [
        migrations.RenameModel(old_name='QuoteLineItem', new_name='BookingLineItem'),
        migrations.AddField(
            model_name='bookinglineitem',
            name='event',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name='line_items', to='events.event',
            ),
        ),
        migrations.AddField(
            model_name='bookinglineitem',
            name='variant',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='line_items', to='bookings.addonvariant',
            ),
        ),
        migrations.AlterField(
            model_name='bookinglineitem',
            name='quote',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name='line_items', to='bookings.quote',
            ),
        ),
        migrations.AddConstraint(
            model_name='bookinglineitem',
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(('event__isnull', True), ('quote__isnull', False)),
                    models.Q(('event__isnull', False), ('quote__isnull', True)),
                    _connector='OR',
                ),
                name='bookinglineitem_exactly_one_parent',
            ),
        ),
        migrations.RunPython(copy_event_addons, noop),
    ]
