"""Revoking a user's outstanding JWTs (REL-486).

The access token carries only `user_id` — no password version, no session id —
so nothing in a token reflects a later change to the account behind it. Until
the refresh token is blacklisted, "reset this employee's password" or "de-
activate this account" does not end their session: the refresh chain keeps
rotating into fresh tokens for the full REFRESH_TOKEN_LIFETIME (7 days).

`token_blacklist` already records every refresh token this app issues, so
revocation is a matter of blacklisting the rows we already have.
"""
from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken, OutstandingToken,
)


def revoke_user_tokens(user) -> int:
    """Blacklist every outstanding refresh token for ``user``.

    Returns how many were newly blacklisted. Idempotent — already-blacklisted
    tokens are left alone — so it is safe to call on every credential change.

    Note the residual window: an *access* token already in the wild stays valid
    until it expires (ACCESS_TOKEN_LIFETIME, 30 minutes), because it is verified
    by signature alone and never looked up here. This closes the 7-day hole, not
    the 30-minute one; shutting that would need a password-derived claim checked
    on every authenticated request.
    """
    newly_blacklisted = 0
    for token in OutstandingToken.objects.filter(user=user):
        _, created = BlacklistedToken.objects.get_or_create(token=token)
        newly_blacklisted += int(created)
    return newly_blacklisted
