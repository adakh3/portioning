"""SaaS subscription billing for the app itself.

This app is about *the organisation paying us to use the product* — NOT about a
catering business invoicing its own event clients (that lives in
``bookings.finance`` as ``Invoice`` / ``Payment``). Keep the two separate: this
domain is Org ↔ Stripe Customer ↔ Stripe Subscription.

One ``Subscription`` row per ``Organisation`` (the tenant). Stripe is the source
of truth for billing state; this row is a local mirror kept in sync by the
webhook handlers so the app can gate access without a round-trip to Stripe.
"""
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


class SubscriptionStatus(models.TextChoices):
    """Mirrors Stripe's subscription ``status`` values, plus a local ``NONE``
    for orgs that have never started checkout."""
    NONE = 'none', 'No Subscription'
    INCOMPLETE = 'incomplete', 'Incomplete'
    INCOMPLETE_EXPIRED = 'incomplete_expired', 'Incomplete Expired'
    TRIALING = 'trialing', 'Trialing'
    ACTIVE = 'active', 'Active'
    PAST_DUE = 'past_due', 'Past Due'
    CANCELED = 'canceled', 'Canceled'
    UNPAID = 'unpaid', 'Unpaid'


# Paid statuses that grant access outright. ``past_due`` keeps access during
# Stripe's dunning/retry window; access is only cut once Stripe gives up
# (``unpaid``/``canceled``). ``trialing`` is handled separately because its
# access is time-boxed by ``trial_ends_at`` (a no-card local trial).
PAID_ACCESS_STATUSES = frozenset({
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.PAST_DUE,
})


class Subscription(models.Model):
    organisation = models.OneToOneField(
        'users.Organisation',
        on_delete=models.CASCADE,
        related_name='subscription',
    )
    # Stripe identifiers. Blank until the org starts checkout.
    stripe_customer_id = models.CharField(max_length=255, blank=True, db_index=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True, db_index=True)
    stripe_price_id = models.CharField(max_length=255, blank=True)
    plan_name = models.CharField(max_length=100, blank=True)

    status = models.CharField(
        max_length=30,
        choices=SubscriptionStatus.choices,
        default=SubscriptionStatus.NONE,
    )
    # End of the current paid period (also when a cancelled sub stops working).
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)

    # No-card free trial. Set on org sign-up; a superuser can extend it. Only
    # meaningful while ``status == TRIALING``.
    trial_ends_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.organisation.name} — {self.get_status_display()}"

    @property
    def is_trialing(self):
        """On an active (non-expired) free trial."""
        return (
            self.status == SubscriptionStatus.TRIALING
            and self.trial_ends_at is not None
            and self.trial_ends_at > timezone.now()
        )

    @property
    def trial_days_remaining(self):
        """Whole days left on the trial (0 if not trialing / expired)."""
        if not self.is_trialing:
            return 0
        return (self.trial_ends_at - timezone.now()).days

    @property
    def has_access(self):
        """True when the org may use the product: paying, in dunning, or on a
        live free trial. An expired trial (status still ``TRIALING`` but past
        ``trial_ends_at``) returns False until they subscribe."""
        return self.status in PAID_ACCESS_STATUSES or self.is_trialing

    @property
    def has_billing_account(self):
        """True once a Stripe customer exists for this org (i.e. they've been
        through Checkout). Gates the Billing Portal — there's nothing to manage
        on a pure free trial that never subscribed."""
        return bool(self.stripe_customer_id)

    def start_trial(self, days=None):
        """Begin a fresh no-card trial. Default length from settings."""
        if days is None:
            days = settings.DEFAULT_TRIAL_DAYS
        self.status = SubscriptionStatus.TRIALING
        self.trial_ends_at = timezone.now() + timedelta(days=days)

    def extend_trial(self, days):
        """Push the trial end out by ``days``, measured from the later of now or
        the current end (so extending an expired trial gives a full window).
        Re-marks the row as trialing."""
        base = max(self.trial_ends_at or timezone.now(), timezone.now())
        self.status = SubscriptionStatus.TRIALING
        self.trial_ends_at = base + timedelta(days=days)
