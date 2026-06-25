"""Thin wrapper around the Stripe SDK — the ONLY module that imports ``stripe``.

Views and webhook handlers call these functions so the rest of the app never
touches the SDK directly. That keeps Stripe calls in one place (single source of
truth) and makes everything else trivially testable by mocking this module.

All functions read credentials from ``settings`` at call time (not import time)
so tests can run without real keys.
"""
import stripe
from django.conf import settings

from payments.models import Subscription


def _client():
    """Return the configured ``stripe`` module."""
    stripe.api_key = settings.STRIPE_SECRET_KEY
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
                            success_url: str, cancel_url: str):
    """Create a Stripe Checkout Session for a subscription purchase.

    Returns the Session object; the caller hands ``session.url`` to the browser.
    """
    customer_id = get_or_create_customer(subscription)
    return _client().checkout.Session.create(
        mode='subscription',
        customer=customer_id,
        line_items=[{'price': price_id, 'quantity': 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={'organisation_id': subscription.organisation_id},
    )


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
    malformed payload) if verification fails — the view turns that into a 400.
    """
    return stripe.Webhook.construct_event(
        payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
    )
