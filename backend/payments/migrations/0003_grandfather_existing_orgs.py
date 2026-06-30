"""Grandfather every org that exists at billing launch into complimentary
(comp) access, so deploying the subscription gate doesn't lock out existing
beta / friendly users.

Every current org gets a Subscription row with ``comped=True`` (full access, no
card). Orgs created *after* this migration are not affected — they go through the
normal card-required trial. Reverting clears the comp flag.
"""
from django.db import migrations


def grandfather_existing_orgs(apps, schema_editor):
    Organisation = apps.get_model('users', 'Organisation')
    Subscription = apps.get_model('payments', 'Subscription')
    for org in Organisation.objects.all():
        sub, _ = Subscription.objects.get_or_create(organisation=org)
        if not sub.comped:
            sub.comped = True
            sub.save(update_fields=['comped'])


def ungrandfather(apps, schema_editor):
    Subscription = apps.get_model('payments', 'Subscription')
    Subscription.objects.filter(comped=True).update(comped=False)


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0002_subscription_comped'),
        ('users', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(grandfather_existing_orgs, ungrandfather),
    ]
