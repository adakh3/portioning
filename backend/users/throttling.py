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
from rest_framework.throttling import ScopedRateThrottle


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


class LoginRateThrottle(TrustedIdentThrottle):
    """Bound how fast one address can attempt logins, whatever email it tries.

    Complements the per-account lockout rather than duplicating it: the lockout
    stops one account being ground down from anywhere, this stops one host
    working through many accounts. Keyed on address alone — deliberately not
    address+email, which an attacker resets for free by changing the email.
    """

    scope = 'login'


class TokenRefreshRateThrottle(TrustedIdentThrottle):
    """Same treatment for the refresh endpoint.

    It is unauthenticated and mints access tokens, so it is worth the same
    ceiling; a real browser refreshes at most twice an hour.
    """

    scope = 'token_refresh'
