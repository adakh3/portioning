"""Person-first bookings (Stage 1) — Event side.

Add the `is_b2b` flag and backfill the customer/business split, mirroring the Quote backfill in
bookings.0035: derive `primary_contact` where missing (from the source quote, else the account's
primary contact), set `is_b2b`, and collapse old `individual` accounts to B2C.
"""
from django.db import migrations, models


def backfill(apps, schema_editor):
    Event = apps.get_model('events', 'Event')
    Contact = apps.get_model('bookings', 'Contact')
    db = schema_editor.connection.alias

    for e in Event.objects.using(db).select_related('account', 'source_quote').all():
        account = e.account
        if e.primary_contact_id is None:
            contact = None
            sq = getattr(e, 'source_quote', None)
            if sq is not None and sq.primary_contact_id:
                contact = sq.primary_contact
            elif account is not None:
                contact = (Contact.objects.using(db)
                           .filter(account=account).order_by('-is_primary', 'id').first())
                if contact is None:
                    contact = Contact.objects.using(db).create(
                        account=account,
                        organisation_id=account.organisation_id,
                        name=account.name,
                        is_primary=True,
                    )
            if contact is not None:
                e.primary_contact = contact
        e.is_b2b = bool(account) and account.account_type != 'individual'
        if account is not None and account.account_type == 'individual':
            e.account = None
        e.save(update_fields=['primary_contact', 'is_b2b', 'account'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0016_merge_0008_event_product_0015_perf_indexes'),
        ('bookings', '0035_person_first_bookings'),
    ]

    operations = [
        migrations.AddField(
            model_name='event',
            name='is_b2b',
            field=models.BooleanField(
                default=False,
                help_text='Business booking — an account (company) is required',
            ),
        ),
        migrations.RunPython(backfill, noop),
    ]
