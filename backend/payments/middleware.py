"""Enforce an active subscription / live trial on the API.

`has_access` is computed on the Subscription, but something has to *enforce* it.
A DRF default permission won't do: many views set their own ``permission_classes``,
which replaces the defaults. This middleware runs for every request regardless,
so the paywall can't be bypassed by a view that forgot to add a permission.

Auth is cookie-JWT (no Django session), so ``request.user`` is anonymous at
middleware time — we resolve the user from the access token ourselves. Requests
we can't authenticate are left alone; the view's own auth returns the 401.

Exempt paths: auth (so you can log in), billing (so a locked-out org can still
reach checkout/portal/status and the Stripe webhook), and Django admin.
Superusers (platform staff) are never gated.
"""
from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

from .models import Subscription

_jwt = JWTAuthentication()


def _resolve_user(request):
    """Best-effort: authenticate from the access-token cookie or Authorization
    header. Returns None if there's no valid token (no CSRF check — read only)."""
    raw = request.COOKIES.get('access_token')
    if not raw:
        header = _jwt.get_header(request)
        raw = _jwt.get_raw_token(header) if header is not None else None
    if not raw:
        return None
    try:
        return _jwt.get_user(_jwt.get_validated_token(raw))
    except (InvalidToken, TokenError):
        return None


class SubscriptionGateMiddleware:
    EXEMPT_PREFIXES = ('/api/auth/', '/api/billing/', '/api/admin/')

    def __init__(self, get_response):
        self.get_response = get_response

    def _is_gated(self, request):
        path = request.path
        if not path.startswith('/api/'):
            return False
        if path.startswith(self.EXEMPT_PREFIXES):
            return False
        # Let CORS preflight through untouched.
        if request.method == 'OPTIONS':
            return False
        return True

    def __call__(self, request):
        if self._is_gated(request):
            user = _resolve_user(request)
            # Only gate authenticated, non-superuser users with an org. Anonymous
            # requests fall through to the view, which returns the proper 401.
            if user and user.is_authenticated and not user.is_superuser:
                org = getattr(user, 'organisation', None)
                if org is not None:
                    sub = Subscription.objects.filter(organisation=org).first()
                    if sub is None or not sub.has_access:
                        return JsonResponse(
                            {
                                'detail': 'subscription_required',
                                'message': 'Your subscription is inactive. '
                                           'Please subscribe to continue.',
                            },
                            status=402,
                        )
        return self.get_response(request)
