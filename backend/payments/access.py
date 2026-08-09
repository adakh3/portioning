"""One answer to "may this organisation use the product?".

`SubscriptionGateMiddleware` asks it for every API request. A view asks it
directly when the middleware structurally cannot: the OAuth callback is
unauthenticated by design, so the gate — which resolves the user from the
access-token cookie — skips it whenever that token is missing or expired. The
callback knows its organisation from a signed state instead, which is
independent of any token, so it can ask here.

Keeping both callers on this function is what stops the paywall meaning two
subtly different things in two places.
"""

from .models import Subscription


def org_has_access(org):
    """True when `org` may use the product.

    An org with no Subscription row at all has no access — billing is
    card-required, and a missing row is not a reason to let someone in.
    """
    if org is None:
        return False
    subscription = Subscription.objects.filter(organisation=org).first()
    return bool(subscription and subscription.has_access)
