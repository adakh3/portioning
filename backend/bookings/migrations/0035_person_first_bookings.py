"""Person-first bookings (Stage 1).

Flip Account/Contact so the PERSON (Contact) is the primary customer:
- Contact gets a direct `organisation` FK and its `account` (company) becomes optional.
- Quote requires `primary_contact` (the customer); `account` (company) becomes optional and
  is gated by a new `is_b2b` flag.

Safe sequence: add nullable -> backfill live rows -> tighten. The old per-lead
`account_type='individual'` accounts (person-as-account) collapse to B2C: the account is
nulled and the Contact carries the identity.
"""
from django.db import migrations, models
import django.db.models.deletion


def backfill(apps, schema_editor):
    Contact = apps.get_model('bookings', 'Contact')
    Quote = apps.get_model('bookings', 'Quote')
    db = schema_editor.connection.alias

    # 1. Every Contact gets its org from its (formerly required) account.
    for c in Contact.objects.using(db).select_related('account').all():
        if c.organisation_id is None and c.account_id:
            c.organisation_id = c.account.organisation_id
            c.save(update_fields=['organisation'])

    # 2. Every Quote gets a customer; set is_b2b; collapse individual accounts to B2C.
    for q in Quote.objects.using(db).select_related('account').all():
        account = q.account
        if q.primary_contact_id is None and account is not None:
            contact = (Contact.objects.using(db)
                       .filter(account=account).order_by('-is_primary', 'id').first())
            if contact is None:
                contact = Contact.objects.using(db).create(
                    account=account,
                    organisation_id=account.organisation_id,
                    name=account.name,
                    is_primary=True,
                )
            q.primary_contact = contact
        q.is_b2b = bool(account) and account.account_type != 'individual'
        if account is not None and account.account_type == 'individual':
            q.account = None
        q.save(update_fields=['primary_contact', 'is_b2b', 'account'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    # Not atomic: the backfill modifies bookings_contact and we then ALTER that
    # same table (tighten organisation/primary_contact to NOT NULL). Postgres
    # refuses an ALTER while a transaction has pending trigger events from data
    # changes on the table, so the data step must commit before the DDL.
    atomic = False

    dependencies = [
        ('bookings', '0034_alter_lead_source'),
    ]

    operations = [
        # --- add nullable ---
        migrations.AddField(
            model_name='contact',
            name='organisation',
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name='contacts', to='users.organisation',
            ),
        ),
        migrations.AddField(
            model_name='quote',
            name='is_b2b',
            field=models.BooleanField(
                default=False,
                help_text='Business booking — an account (company) is required',
            ),
        ),
        migrations.AlterField(
            model_name='quote',
            name='account',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='quotes', to='bookings.account',
            ),
        ),
        # --- backfill live rows ---
        migrations.RunPython(backfill, noop),
        # --- tighten ---
        migrations.AlterField(
            model_name='contact',
            name='organisation',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='contacts', to='users.organisation',
            ),
        ),
        migrations.AlterField(
            model_name='contact',
            name='account',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='contacts', to='bookings.account',
            ),
        ),
        migrations.AlterField(
            model_name='quote',
            name='primary_contact',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='quotes', to='bookings.contact',
            ),
        ),
    ]
