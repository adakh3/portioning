"""Thin wrapper around the Stripe SDK — the ONLY module that imports ``stripe``.

Views and webhook handlers call these functions so the rest of the app never
touches the SDK directly. That keeps Stripe calls in one place (single source of
truth) and makes everything else trivially testable by mocking this module.

All functions read credentials from ``settings`` at call time (not import time)
so tests can run without real keys.
"""
import stripe
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from payments.models import Subscription


def _require_setting(name: str) -> str:
    """Return a Stripe credential, refusing to run on an empty one (REL-484).

    An unset credential must stop the call, never soften it. That matters most
    for the webhook secret: ``stripe.Webhook.construct_event`` does not reject
    an empty key, it just HMACs with one — and an empty key is a key the caller
    knows, so anyone can sign an event we would then trust. Since the webhook is
    the only thing that flips a Subscription to active/trialing, a missing
    secret is the difference between "billing is broken" and "billing is free
    for whoever asks". The former is loud and recoverable.
    """
    value = (getattr(settings, name, '') or '').strip()
    if not value:
        raise ImproperlyConfigured(f"{name} is not configured.")
    return value


def _client():
    """Return the configured ``stripe`` module."""
    stripe.api_key = _require_setting('STRIPE_SECRET_KEY')
    return stripe


def get_or_create_customer(subscription: Subscription) -> str:
    """Ensure the org has a Stripe Customer; return its id.

    Stores the new id on the ``Subscription`` row so we only create one customer
    per org, ever.
    """
    if subscription.stripe_customer_id:
        return subscription.stripe_customer_id

    org = subscription.organisation
    customer = _client().Customer.create(
        name=org.name,
        metadata={'organisation_id': org.id, 'slug': org.slug},
    )
    subscription.stripe_customer_id = customer['id']
    subscription.save(update_fields=['stripe_customer_id', 'updated_at'])
    return customer['id']


def create_checkout_session(subscription: Subscription, *, price_id: str,
                            success_url: str, cancel_url: str,
                            trial_period_days: int = None):
    """Create a Stripe Checkout Session for a subscription purchase.

    When ``trial_period_days`` is set, Stripe starts the subscription in a
    ``trialing`` state (card collected up front, no immediate charge) that
    auto-converts to ``active`` when the trial ends. Returns the Session object;
    the caller hands ``session.url`` to the browser.
    """
    customer_id = get_or_create_customer(subscription)
    params = dict(
        mode='subscription',
        customer=customer_id,
        line_items=[{'price': price_id, 'quantity': 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={'organisation_id': subscription.organisation_id},
    )
    if trial_period_days:
        params['subscription_data'] = {'trial_period_days': trial_period_days}
    return _client().checkout.Session.create(**params)


def create_billing_portal_session(subscription: Subscription, *, return_url: str):
    """Create a Stripe Billing Portal session so the org can manage/cancel its
    plan and update card details. Returns the Session object."""
    return _client().billing_portal.Session.create(
        customer=subscription.stripe_customer_id,
        return_url=return_url,
    )


def verify_webhook_event(payload: bytes, sig_header: str):
    """Verify a webhook payload's signature and return the parsed Event.

    Raises ``stripe.error.SignatureVerificationError`` (or ``ValueError`` for a
    malformed payload) if verification fails — the view turns that into a 400 —
    or ``ImproperlyConfigured`` if the secret is unset, which the view turns
    into a 500 without ever reaching ``construct_event``.
    """
    secret = _require_setting('STRIPE_WEBHOOK_SECRET')
    return stripe.Webhook.construct_event(payload, sig_header, secret)
