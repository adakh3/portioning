"""Create the billing row for every new organisation.

Kept in the ``payments`` app (not ``users.signals``) so billing stays
self-contained. Runs alongside the OrgSettings/lead-status seeding that
``users.signals`` does on org creation.

The free trial is **card-required**: a new org starts with no access
(``status = NONE``) and the gate sends it to /billing, where the owner starts
a Stripe-managed 7-day trial (card on file, auto-converts). So this signal only
ensures the row exists — it does not grant a trial.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from users.models import Organisation

from .models import Subscription


@receiver(post_save, sender=Organisation)
def create_subscription_for_new_org(sender, instance, created, **kwargs):
    """Ensure each new org has a Subscription row (status NONE, no access).
    Idempotent via get_or_create."""
    if not created:
        return
    Subscription.objects.get_or_create(organisation=instance)
