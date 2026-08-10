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

A few ``/api/`` endpoints are reached by the *browser itself* rather than by
fetch — an OAuth provider redirecting the user back, for instance. A JSON body
is the right answer for an XHR and a dead end for a navigation, so the block
response is content-negotiated: navigations get sent to the billing page, which
is where the frontend routes a 402 anyway.
"""
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import redirect
from django.utils.cache import patch_vary_headers
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

from .access import org_has_access

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

    def _is_navigation(self, request):
        """True when the browser is loading this URL as a page, not fetching it.

        `Sec-Fetch-Dest` is the authoritative answer and cannot be forged: it's
        a forbidden header name, so script can't set it, and browsers send it on
        every top-level navigation — including the OAuth bounce-back this exists
        for. Where it's absent (an older browser, curl, a server-side client) we
        fall back to Accept *starting* with text/html, which is what a real
        navigation sends. A mere substring test would be wrong: a client asking
        for `application/json, text/html;q=0.1` prefers JSON and would be
        redirected into a cross-origin page it can't read.
        """
        if request.method != 'GET':
            return False
        dest = request.headers.get('Sec-Fetch-Dest')
        if dest:
            return dest == 'document'
        return request.headers.get('Accept', '').strip().startswith('text/html')

    def _blocked(self, request):
        if self._is_navigation(request):
            # A JSON body rendered as a page is a dead end. Send them where the
            # frontend sends every other 402.
            response = redirect(
                f'{settings.FRONTEND_BASE_URL.rstrip("/")}/billing?reason=subscription_required'
            )
        else:
            response = JsonResponse(
                {
                    'detail': 'subscription_required',
                    'message': 'Your subscription is inactive. '
                               'Please subscribe to continue.',
                },
                status=402,
            )
        # One URL, two bodies, chosen by these headers — say so, or an
        # intermediary could hand a cached redirect to an XHR.
        patch_vary_headers(response, ('Accept', 'Sec-Fetch-Dest'))
        return response

    def __call__(self, request):
        if self._is_gated(request):
            user = _resolve_user(request)
            # Only gate authenticated, non-superuser users with an org. Anonymous
            # requests fall through to the view, which returns the proper 401.
            if user and user.is_authenticated and not user.is_superuser:
                org = getattr(user, 'organisation', None)
                if org is not None and not org_has_access(org):
                    return self._blocked(request)
        return self.get_response(request)
