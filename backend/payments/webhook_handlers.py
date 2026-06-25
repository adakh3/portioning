"""Apply Stripe webhook events to the local ``Subscription`` mirror.

Stripe is the source of truth for billing; these handlers keep our local row in
sync so the app can gate access without calling Stripe on every request. Handlers
are deliberately idempotent — Stripe retries deliveries, and may deliver out of
order, so each one resolves the row by Stripe id and overwrites from the event.
"""
import logging
from datetime import datetime, timezone as dt_timezone

from payments.models import Subscription, SubscriptionStatus

logger = logging.getLogger('payments')


def _ts_to_dt(ts):
    """Stripe sends period boundaries as Unix timestamps (or None)."""
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=dt_timezone.utc)


def _find_subscription(*, customer_id=None, subscription_id=None):
    """Resolve our local row from Stripe ids. Returns None if we don't know it
    (e.g. a customer created out-of-band) — caller logs and ignores."""
    qs = Subscription.objects.all()
    if subscription_id:
        sub = qs.filter(stripe_subscription_id=subscription_id).first()
        if sub:
            return sub
    if customer_id:
        return qs.filter(stripe_customer_id=customer_id).first()
    return None


def _sync_from_stripe_subscription(stripe_sub):
    """Overwrite the local row from a Stripe Subscription object."""
    sub = _find_subscription(
        customer_id=stripe_sub.get('customer'),
        subscription_id=stripe_sub.get('id'),
    )
    if sub is None:
        logger.warning("Stripe subscription %s has no local mirror; ignoring",
                       stripe_sub.get('id'))
        return

    sub.stripe_subscription_id = stripe_sub.get('id', '')
    sub.status = stripe_sub.get('status', SubscriptionStatus.NONE)
    sub.cancel_at_period_end = bool(stripe_sub.get('cancel_at_period_end'))
    sub.current_period_end = _ts_to_dt(stripe_sub.get('current_period_end'))

    items = (stripe_sub.get('items') or {}).get('data') or []
    if items:
        price = items[0].get('price') or {}
        sub.stripe_price_id = price.get('id', '') or sub.stripe_price_id
        sub.plan_name = price.get('nickname') or sub.plan_name

    sub.save()
    logger.info("Synced subscription for org=%s -> %s",
                sub.organisation_id, sub.status)


def _handle_subscription_deleted(stripe_sub):
    sub = _find_subscription(
        customer_id=stripe_sub.get('customer'),
        subscription_id=stripe_sub.get('id'),
    )
    if sub is None:
        return
    sub.status = SubscriptionStatus.CANCELED
    sub.cancel_at_period_end = False
    sub.save(update_fields=['status', 'cancel_at_period_end', 'updated_at'])
    logger.info("Subscription canceled for org=%s", sub.organisation_id)


# event type -> handler taking the event's data object
_HANDLERS = {
    'customer.subscription.created': _sync_from_stripe_subscription,
    'customer.subscription.updated': _sync_from_stripe_subscription,
    'customer.subscription.deleted': _handle_subscription_deleted,
}


def handle_event(event):
    """Dispatch a verified Stripe event. Unknown event types are ignored (we
    subscribe to more than we act on so new ones don't 500)."""
    handler = _HANDLERS.get(event['type'])
    if handler is None:
        logger.debug("Ignoring unhandled Stripe event type: %s", event['type'])
        return
    handler(event['data']['object'])
