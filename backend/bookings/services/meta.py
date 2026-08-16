"""Meta Graph API plumbing for the connected-Pages integration (REL-506).

Everything that knows a Facebook URL or the OAuth mechanics lives here; the view
layer (`bookings/views/meta.py`) drives the flow and the models hold the tokens.
Thin and requests-based like `mailbox_oauth` and the Twilio client, so tests
patch it at the `requests` boundary and never hit Meta.

The flow, once per org:

    code  ──exchange_code──▶  short-lived user token
          ──get_long_lived_token──▶  long-lived user token (~60 days)
          ──list_pages──▶  the Pages the user admins, each with its own
                           (long-lived) Page access token + linked IG account
    then subscribe_page() subscribes our app to each connected Page's webhooks.
"""

import logging
from urllib.parse import urlencode

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# Pin the Graph version so a Meta-side default bump can't silently change
# behaviour; bump deliberately when we retest against a newer one.
GRAPH_VERSION = 'v21.0'
GRAPH = f'https://graph.facebook.com/{GRAPH_VERSION}'
DIALOG = f'https://www.facebook.com/{GRAPH_VERSION}/dialog/oauth'

# Where Meta sends the browser back to. Must match the redirect URI registered
# on the Meta app byte for byte, and reuses the same public origin as the
# mailbox OAuth (settings.OAUTH_REDIRECT_BASE).
CALLBACK_PATH = '/api/integrations/meta/callback/'

# Interactive OAuth plus a couple of Graph reads — a human is watching a redirect
# complete, so this stays generous, matching the mailbox flow.
HTTP_TIMEOUT = 20

# The permissions the connect flow asks for. The five that gate lead + DM
# capture (REL-505 submits these for App Review) plus pages_show_list, which is
# what lets us enumerate the user's Pages in the picker at all.
SCOPES = [
    'pages_show_list',
    'pages_manage_metadata',   # required to subscribe the app to a Page's webhooks
    'pages_manage_ads',
    'leads_retrieval',
    'pages_messaging',
    'instagram_manage_messages',
]

# Which webhook fields we subscribe each connected Page to. leadgen powers
# REL-507 (lead ads), messages powers REL-508 (DMs).
SUBSCRIBED_FIELDS = 'leadgen,messages'


class MetaConfigError(Exception):
    """The platform's Meta app isn't configured on this deployment."""


class MetaExchangeError(Exception):
    """Meta refused an OAuth code or token exchange."""


class MetaApiError(Exception):
    """A Graph API call (list pages / subscribe / unsubscribe) failed."""


# ── Configuration ──

def app_configured() -> bool:
    """True when this deployment has a real Meta app (id + secret)."""
    return bool(settings.META_APP_ID and settings.META_APP_SECRET)


def redirect_uri() -> str:
    return settings.OAUTH_REDIRECT_BASE.rstrip('/') + CALLBACK_PATH


# ── Authorisation ──

def build_auth_url(state: str) -> str:
    """The Meta consent-screen URL to send the admin to."""
    if not settings.META_APP_ID:
        raise MetaConfigError('No Meta app configured on this deployment.')
    params = {
        'client_id': settings.META_APP_ID,
        'redirect_uri': redirect_uri(),
        'response_type': 'code',
        'scope': ','.join(SCOPES),
        'state': state,
    }
    return f'{DIALOG}?{urlencode(params)}'


def exchange_code(code: str) -> dict:
    """Trade an authorisation code for a short-lived user access token.

    Returns {'access_token', 'expires_in'}.
    """
    # POST (secret in the body), never GET: a GET would put META_APP_SECRET in
    # the URL, where a network-error traceback or a proxy access log could
    # capture it. Mirrors mailbox_oauth._post_token.
    data = _post(f'{GRAPH}/oauth/access_token', {
        'client_id': settings.META_APP_ID,
        'client_secret': settings.META_APP_SECRET,
        'redirect_uri': redirect_uri(),
        'code': code,
    })
    token = data.get('access_token', '')
    if not token:
        raise MetaExchangeError('Meta returned no access token for the code.')
    return {'access_token': token, 'expires_in': int(data.get('expires_in') or 3600)}


def get_long_lived_token(short_lived_token: str) -> dict:
    """Exchange a short-lived user token for a long-lived one (~60 days).

    Returns {'access_token', 'expires_in'}.
    """
    data = _post(f'{GRAPH}/oauth/access_token', {
        'grant_type': 'fb_exchange_token',
        'client_id': settings.META_APP_ID,
        'client_secret': settings.META_APP_SECRET,
        'fb_exchange_token': short_lived_token,
    })
    token = data.get('access_token', '')
    if not token:
        raise MetaExchangeError('Meta returned no long-lived token.')
    # Long-lived user tokens last ~60 days; default defensively if absent.
    return {'access_token': token, 'expires_in': int(data.get('expires_in') or 60 * 24 * 3600)}


# ── Graph reads/writes ──

def list_pages(user_access_token: str) -> list:
    """The Pages this user administers, each with its own Page access token.

    Returns a list of dicts:
        {'page_id', 'page_name', 'page_access_token',
         'instagram_account_id', 'instagram_username'}
    Follows paging so an admin with many Pages sees them all.
    """
    pages = []
    url = f'{GRAPH}/me/accounts'
    params = {
        'fields': 'id,name,access_token,instagram_business_account{id,username}',
        'access_token': user_access_token,
        'limit': 100,
    }
    # Bound the paging so a pathological response can never loop forever.
    for _ in range(20):
        data = _get_json(url, params)
        for page in data.get('data', []):
            ig = page.get('instagram_business_account') or {}
            pages.append({
                'page_id': page.get('id', ''),
                'page_name': page.get('name', ''),
                'page_access_token': page.get('access_token', ''),
                'instagram_account_id': ig.get('id', '') or '',
                'instagram_username': ig.get('username', '') or '',
            })
        next_url = (data.get('paging') or {}).get('next')
        if not next_url:
            break
        # The `next` cursor is a fully-formed URL with its own querystring.
        url, params = next_url, None
    return pages


def subscribe_page(page_id: str, page_access_token: str) -> None:
    """Subscribe our app to this Page's leadgen + messages webhooks."""
    _post(f'{GRAPH}/{page_id}/subscribed_apps', {
        'subscribed_fields': SUBSCRIBED_FIELDS,
        'access_token': page_access_token,
    })


def unsubscribe_page(page_id: str, page_access_token: str) -> None:
    """Remove our app's webhook subscription from this Page."""
    _delete(f'{GRAPH}/{page_id}/subscribed_apps', {'access_token': page_access_token})


# ── HTTP helpers ──

def _get_json(url: str, params) -> dict:
    return _read(_request(requests.get, url, params=params))


def _post(url: str, data) -> dict:
    return _read(_request(requests.post, url, data=data))


def _delete(url: str, params) -> dict:
    return _read(_request(requests.delete, url, params=params))


def _request(method, url: str, **kwargs):
    """Make the HTTP call, collapsing a transport error into a MetaApiError.

    A raw requests/urllib3 error stringifies with the full failing URL, which
    for some Graph calls carries an access token in the query. Callers only ever
    log a MetaApiError via ``%s`` (its message), never a traceback, so keeping
    the URL out of the exception here keeps tokens out of the logs.
    """
    try:
        return method(url, timeout=HTTP_TIMEOUT, **kwargs)
    except requests.RequestException as exc:
        raise MetaApiError('Could not reach Meta.') from exc


def _read(response) -> dict:
    if response.status_code >= 400:
        # Never echo the params — they carry the app secret and access tokens.
        raise MetaApiError(_error_detail(response))
    try:
        return response.json()
    except ValueError:
        raise MetaApiError('Meta returned an unreadable response.')


def _error_detail(response) -> str:
    """A short, safe description of a Graph failure — never the request."""
    try:
        data = response.json()
    except ValueError:
        return f'HTTP {response.status_code}'
    error = data.get('error') if isinstance(data, dict) else None
    if isinstance(error, dict):
        message = error.get('message') or error.get('type') or ''
    else:
        message = error or ''
    return f'HTTP {response.status_code}' + (f' — {message}' if message else '')
