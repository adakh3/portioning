"""Billing endpoints: read subscription state, start checkout, open the billing
portal, and receive Stripe webhooks.

Access model: reading status is allowed for any authenticated org member (the
app gates features on it); starting/managing billing is owner-only (the owner
pays). The webhook is unauthenticated — Stripe calls it — and is secured by
signature verification instead.
"""
import logging

import stripe
from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status as http_status
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.permissions import IsOwner
from users.mixins import get_request_org

from .models import Subscription, Plan, PricingRegion
from .serializers import SubscriptionSerializer, PlanSerializer
from .services import stripe_gateway
from . import webhook_handlers

logger = logging.getLogger('payments')


class IsSuperUser(BasePermission):
    """Platform staff only — for cross-org billing operations like extending a
    customer's free trial."""

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and user.is_superuser)


def _get_or_create_subscription(org):
    """Every org has exactly one Subscription row; create the local mirror lazily
    the first time we need it (status defaults to NONE)."""
    sub, _ = Subscription.objects.get_or_create(organisation=org)
    return sub


class SubscriptionStatusView(APIView):
    """GET the current org's billing state. Any authenticated member."""

    def get(self, request):
        org = get_request_org(request)
        if org is None:
            return Response({'detail': 'No organisation in context.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        sub = _get_or_create_subscription(org)
        return Response(SubscriptionSerializer(sub).data)


class PlansView(APIView):
    """GET the active subscription tiers, priced for the caller's org region.

    Any authenticated member (gate-exempt so a locked-out org can still see plans
    to subscribe). Returns ``[]`` when no plans are configured — the frontend then
    falls back to the single default-price Subscribe button.
    """

    def get(self, request):
        org = get_request_org(request)
        region = PricingRegion.for_country(org.country) if org else None
        plans = Plan.objects.filter(is_active=True)
        data = PlanSerializer(
            plans, many=True, context={'request': request, 'region': region},
        ).data
        # Only surface tiers that actually have a price in this region.
        return Response([p for p in data if p.get('display_amount') is not None])


def _resolve_checkout_price(org, plan_code):
    """Pick the Stripe price id for this checkout, server-side (never trust a
    client-supplied price id). Returns ``(price_id, error_detail)``.

    - A ``plan_code`` → the tier's price for the org's region (via org.country).
    - No plan → the legacy single default price (``STRIPE_PRICE_ID``); this is the
      fallback when tiered pricing isn't configured.
    """
    if plan_code:
        plan = Plan.objects.filter(code=plan_code, is_active=True).first()
        if plan is None:
            return None, 'Unknown plan.'
        region = PricingRegion.for_country(org.country)
        price = plan.price_for_region(region)
        if price is None:
            return None, 'This plan is not available in your region.'
        return price.stripe_price_id, None
    # Legacy / unconfigured path — single default price.
    price_id = settings.STRIPE_PRICE_ID
    if not price_id:
        return None, 'No plan price configured.'
    return price_id, None


class CheckoutSessionView(APIView):
    """POST to start a Stripe Checkout session. Owner-only.

    Body: ``{"plan": "<code>"}`` for a tier (price resolved by the org's region),
    or empty to use the single default price. Returns ``{"url": ...}``; the
    frontend redirects the browser there.
    """
    permission_classes = [IsOwner]

    def post(self, request):
        org = get_request_org(request)
        if org is None:
            return Response({'detail': 'No organisation in context.'},
                            status=http_status.HTTP_400_BAD_REQUEST)

        price_id, error = _resolve_checkout_price(org, request.data.get('plan'))
        if error:
            return Response({'detail': error}, status=http_status.HTTP_400_BAD_REQUEST)

        sub = _get_or_create_subscription(org)
        # First-ever subscription gets the card-required free trial; a returning
        # org (e.g. resubscribing after cancel) does not get a second trial.
        trial_days = settings.DEFAULT_TRIAL_DAYS if not sub.stripe_subscription_id else None
        try:
            session = stripe_gateway.create_checkout_session(
                sub,
                price_id=price_id,
                success_url=f'{settings.FRONTEND_BASE_URL}/billing?status=success',
                cancel_url=f'{settings.FRONTEND_BASE_URL}/billing?status=cancelled',
                trial_period_days=trial_days,
            )
        except stripe.error.StripeError:
            logger.exception("Stripe checkout session failed for org=%s", org.id)
            return Response({'detail': 'Could not start checkout.'},
                            status=http_status.HTTP_502_BAD_GATEWAY)
        return Response({'url': session['url']})


class BillingPortalView(APIView):
    """POST to open the Stripe Billing Portal (manage/cancel plan). Owner-only."""
    permission_classes = [IsOwner]

    def post(self, request):
        org = get_request_org(request)
        if org is None:
            return Response({'detail': 'No organisation in context.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        sub = _get_or_create_subscription(org)
        if not sub.stripe_customer_id:
            return Response({'detail': 'No billing account yet — start a plan first.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        try:
            session = stripe_gateway.create_billing_portal_session(
                sub, return_url=f'{settings.FRONTEND_BASE_URL}/billing',
            )
        except stripe.error.StripeError:
            logger.exception("Stripe portal session failed for org=%s", org.id)
            return Response({'detail': 'Could not open billing portal.'},
                            status=http_status.HTTP_502_BAD_GATEWAY)
        return Response({'url': session['url']})


class ExtendTrialView(APIView):
    """POST to extend an org's free trial. Superuser-only (platform staff).

    Body: ``{"days": <int>}`` (defaults to the configured trial length). Works on
    any org by id, including one whose trial has already expired.
    """
    permission_classes = [IsSuperUser]

    def post(self, request, org_id):
        from users.models import Organisation
        from django.shortcuts import get_object_or_404

        org = get_object_or_404(Organisation, pk=org_id)
        try:
            days = int(request.data.get('days', settings.DEFAULT_TRIAL_DAYS))
        except (TypeError, ValueError):
            return Response({'detail': 'days must be an integer.'},
                            status=http_status.HTTP_400_BAD_REQUEST)
        if days <= 0:
            return Response({'detail': 'days must be positive.'},
                            status=http_status.HTTP_400_BAD_REQUEST)

        sub = _get_or_create_subscription(org)
        sub.extend_trial(days)
        sub.save()
        logger.info("Trial for org=%s extended by %s days (now ends %s)",
                    org.id, days, sub.trial_ends_at)
        return Response(SubscriptionSerializer(sub).data)


@method_decorator(csrf_exempt, name='dispatch')
class StripeWebhookView(APIView):
    """Receive Stripe webhook events. Unauthenticated — secured by signature.

    Returns 200 on success (so Stripe stops retrying) and 400 on a bad/forged
    signature. Handler errors are logged but still 200'd to avoid infinite
    retries on a poison event; investigate via logs.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE', '')
        try:
            event = stripe_gateway.verify_webhook_event(request.body, sig_header)
        except (ValueError, stripe.error.SignatureVerificationError):
            logger.warning("Rejected Stripe webhook with bad signature")
            return Response(status=http_status.HTTP_400_BAD_REQUEST)

        try:
            webhook_handlers.handle_event(event)
        except Exception:  # noqa: BLE001 — never 500 back to Stripe
            try:
                event_id = event['id']
            except Exception:  # noqa: BLE001 — event may be a StripeObject/dict
                event_id = None
            logger.exception("Error handling Stripe event %s", event_id)
        return Response(status=http_status.HTTP_200_OK)
