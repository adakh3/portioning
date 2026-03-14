"""Phase 2: Data migration + remove old fields from Django state.

Uses SeparateDatabaseAndState for removing FK fields that reference
models being deleted (Account/Contact), since Django's SQLite backend
cannot resolve deleted model classes during field removal.

The old Account/Contact tables and FK columns are left in the database
as harmless stubs — Django's ORM ignores them. Dropping the tables would
break SQLite FK constraints on orphaned columns in other tables.
"""

from django.db import migrations, models
import django.db.models.deletion


def migrate_data_forward(apps, schema_editor):
    """Convert Account+Contact → Customer and wire up FKs."""
    Account = apps.get_model('bookings', 'Account')
    Contact = apps.get_model('bookings', 'Contact')
    Customer = apps.get_model('bookings', 'Customer')
    Lead = apps.get_model('bookings', 'Lead')
    Quote = apps.get_model('bookings', 'Quote')
    Event = apps.get_model('events', 'Event')

    account_to_customer = {}

    for account in Account.objects.all():
        primary = Contact.objects.filter(account=account, is_primary=True).first()
        if not primary:
            primary = Contact.objects.filter(account=account).first()

        if account.account_type == 'individual':
            customer_type = 'consumer'
            name = primary.name if primary else account.name
            company_name = ''
        else:
            customer_type = 'business'
            company_name = account.name
            name = primary.name if primary else account.name

        customer = Customer.objects.create(
            organisation_id=account.organisation_id,
            customer_type=customer_type,
            name=name,
            company_name=company_name,
            email=primary.email if primary else '',
            phone=primary.phone if primary else '',
            billing_address_line1=account.billing_address_line1,
            billing_address_line2=account.billing_address_line2,
            billing_city=account.billing_city,
            billing_postcode=account.billing_postcode,
            billing_country=account.billing_country,
            vat_number=account.vat_number,
            payment_terms=account.payment_terms,
            notes=account.notes,
        )
        account_to_customer[account.id] = customer.id

    for lead in Lead.objects.all():
        if lead.account_id and lead.account_id in account_to_customer:
            lead.customer_id = account_to_customer[lead.account_id]
            lead.save(update_fields=['customer_id'])
        elif lead.contact_name:
            customer = Customer.objects.create(
                organisation_id=lead.organisation_id,
                customer_type='consumer',
                name=lead.contact_name,
                email=lead.contact_email or '',
                phone=lead.contact_phone or '',
            )
            lead.customer_id = customer.id
            lead.save(update_fields=['customer_id'])

    for quote in Quote.objects.all():
        if quote.account_id and quote.account_id in account_to_customer:
            quote.customer_id = account_to_customer[quote.account_id]
            quote.save(update_fields=['customer_id'])

    for event in Event.objects.all():
        if event.account_id and event.account_id in account_to_customer:
            event.customer_id = account_to_customer[event.account_id]
            event.save(update_fields=['customer_id'])


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0022_create_customer'),
        ('events', '0007_event_customer'),
    ]

    operations = [
        # Data migration
        migrations.RunPython(migrate_data_forward, migrations.RunPython.noop),

        # Use SeparateDatabaseAndState: update state to remove the fields
        # but use DeleteModel on DB side (which drops the tables and their
        # FK constraints automatically). For Lead/Quote field removals,
        # we only update state since the old columns become harmless once
        # the referenced tables are dropped.

        # First: drop Contact and Account tables (DB side).
        # This also drops any FK constraints pointing TO these tables.
        # State side: remove the FK fields from Lead/Quote first, then delete models.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name='lead', name='account'),
                migrations.RemoveField(model_name='lead', name='contact_name'),
                migrations.RemoveField(model_name='lead', name='contact_email'),
                migrations.RemoveField(model_name='lead', name='contact_phone'),
                migrations.RemoveField(model_name='quote', name='account'),
                migrations.RemoveField(model_name='quote', name='primary_contact'),
                migrations.DeleteModel(name='Contact'),
                migrations.DeleteModel(name='Account'),
            ],
            database_operations=[
                # Drop indexes before columns (SQLite requirement)
                migrations.RunSQL("DROP INDEX IF EXISTS bookings_lead_account_id_bd45d09a;"),
                migrations.RunSQL("ALTER TABLE bookings_lead DROP COLUMN account_id;"),
                migrations.RunSQL("ALTER TABLE bookings_lead DROP COLUMN contact_name;"),
                migrations.RunSQL("ALTER TABLE bookings_lead DROP COLUMN contact_email;"),
                migrations.RunSQL("ALTER TABLE bookings_lead DROP COLUMN contact_phone;"),
                migrations.RunSQL("DROP INDEX IF EXISTS bookings_quote_account_id_6fefeb99;"),
                migrations.RunSQL("DROP INDEX IF EXISTS bookings_quote_primary_contact_id_f503ff0e;"),
                migrations.RunSQL("ALTER TABLE bookings_quote DROP COLUMN account_id;"),
                migrations.RunSQL("ALTER TABLE bookings_quote DROP COLUMN primary_contact_id;"),
            ],
        ),
    ]
