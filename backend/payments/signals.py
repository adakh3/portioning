"""Start a free trial for every new organisation.

Kept in the ``payments`` app (not ``users.signals``) so billing stays
self-contained. Runs alongside the OrgSettings/lead-status seeding that
``users.signals`` does on org creation.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from users.models import Organisation

from .models import Subscription


@receiver(post_save, sender=Organisation)
def start_trial_for_new_org(sender, instance, created, **kwargs):
    """Give each new org a no-card free trial (idempotent via get_or_create)."""
    if not created:
        return
    sub, was_created = Subscription.objects.get_or_create(organisation=instance)
    if was_created:
        sub.start_trial()
        sub.save()
