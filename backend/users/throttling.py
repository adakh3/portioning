"""Rate-limit identity for the unauthenticated endpoints (REL-485).

Every throttle is only as good as the key it counts against. DRF's default
`get_ident` returns the *whole* `X-Forwarded-For` chain when `NUM_PROXIES` is
unset, and that header is client-supplied: an attacker who varies it by one byte
per request gets a brand-new bucket every time, so the limit may as well not
exist. The only part of the chain nobody downstream can forge is the hop our own
proxy appended — the last entry — because it is written by the proxy itself from
the socket it accepted.

`NUM_PROXIES = 1` now makes DRF do exactly that globally. These classes keep
their own `get_ident` anyway: the endpoints here are the ones worth protecting
even if that setting is ever changed or mis-set for an environment with a
different proxy depth, and being wrong here is a login page anyone can hammer.
"""
from rest_framework.exceptions import Throttled
from rest_framework.permissions import SAFE_METHODS
from rest_framework.throttling import ScopedRateThrottle


class SignInThrottled(Throttled):
    """DRF's 429 wording, rewritten for someone signing in.

    The default is developer-facing — "Request was throttled. Expected available
    in 11 seconds." — and it lands on the sign-in page, where the reader is a
    caterer who mistyped their password, not someone debugging an API. Overriding
    the `extra_detail_*` templates rather than passing a finished string keeps
    `wait` populated, and `wait` is what DRF turns into the Retry-After header.
    """

    default_detail = 'Too many sign-in attempts from this device.'
    extra_detail_singular = 'Try again in {wait} second.'
    extra_detail_plural = 'Try again in {wait} seconds.'


def raise_sign_in_throttled(wait):
    """For an APIView's `throttled()` hook — see LoginView."""
    raise SignInThrottled(wait=wait)


def client_ip(request) -> str:
    """The caller's address, ignoring any hop the client could have written."""
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[-1].strip()
    return request.META.get('REMOTE_ADDR', '')


def axes_username(request, credentials: dict = None) -> str:
    """The identity django-axes counts failures against.

    Axes reads the username from `request.POST` by default, which is always
    empty for a DRF JSON body — every attempt would look like the same blank
    username and share one lockout bucket, so a handful of failures against any
    account would lock out all of them. The email is in the credentials dict
    that `authenticate()` was called with, and falls back to the parsed body for
    paths that don't pass credentials (the Django admin's form login).
    """
    if credentials:
        username = credentials.get('email') or credentials.get('username')
        if username:
            return str(username).strip().lower()
    data = getattr(request, 'data', None) or getattr(request, 'POST', None) or {}
    try:
        username = data.get('email') or data.get('username') or ''
    except (AttributeError, TypeError):
        return ''
    return str(username).strip().lower()


class TrustedIdentThrottle(ScopedRateThrottle):
    """A scoped throttle keyed on the caller's real address."""

    def get_ident(self, request):
        return client_ip(request)

    @classmethod
    def refund(cls, request, view):
        """Give back the allowance this request just consumed.

        DRF charges the bucket before the view runs, so it cannot tell a brute-
        force sweep from a busy morning. Refunding on success makes the limit
        mean "N *failed* attempts per minute", which is the thing worth
        bounding: the address is shared by everyone behind one NAT, so counting
        successes means a dozen colleagues signing in at 9am lock out the
        office — and it is why the e2e suite, which signs in once per spec,
        started failing halfway through its run.

        Silent no-op if the scope has no rate configured.
        """
        throttle = cls()
        throttle.scope = getattr(view, throttle.scope_attr, None) or cls.scope
        rate = throttle.get_rate()
        if not rate:
            return
        throttle.num_requests, throttle.duration = throttle.parse_rate(rate)
        key = throttle.get_cache_key(request, view)
        if key is None:
            return
        history = throttle.cache.get(key, [])
        if history:
            # allow_request inserts the newest timestamp at position 0.
            history.pop(0)
            throttle.cache.set(key, history, throttle.duration)


class LoginRateThrottle(TrustedIdentThrottle):
    """Bound how fast one address can FAIL logins, whatever email it tries.

    Complements the per-account lockout rather than duplicating it: the lockout
    stops one account being ground down from anywhere, this stops one host
    working through many accounts. Keyed on address alone — deliberately not
    address+email, which an attacker resets for free by changing the email.

    A successful sign-in is refunded by the view, so the budget is spent only on
    failures. See `refund`.
    """

    scope = 'login'

    def allow_request(self, request, view):
        # GET /api/auth/login/ only hands back a CSRF cookie — it verifies no
        # credentials and reveals nothing, so it is not an attempt and must not
        # spend the budget. Every visit to the sign-in page makes one, so
        # counting them locked people out of the page *before* they could type
        # anything, and each redirect to /login burned another.
        if request.method in SAFE_METHODS:
            return True
        return super().allow_request(request, view)


class TokenRefreshRateThrottle(TrustedIdentThrottle):
    """Same treatment for the refresh endpoint.

    It is unauthenticated and mints access tokens, so it is worth the same
    ceiling; a real browser refreshes at most twice an hour.
    """

    scope = 'token_refresh'
