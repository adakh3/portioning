"""Provider plumbing for the caterer's connected mailbox (REL-460).

Everything that knows a Google or Microsoft URL lives here; `services/email.py`
holds the transport contract the rest of the app calls. Scopes are deliberately
send-only — the platform must never be able to read a caterer's inbox.
"""

import base64
import binascii
import json
import logging
from email.message import EmailMessage
from urllib.parse import urlencode

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

GOOGLE = 'google'
MICROSOFT = 'microsoft'
PROVIDERS = (GOOGLE, MICROSOFT)

# Where the provider sends the browser back to. Must match the redirect URI
# registered with Google/Microsoft byte for byte.
CALLBACK_PATH = '/api/integrations/email/callback/'

HTTP_TIMEOUT = 20

_CONFIG = {
    GOOGLE: {
        'auth_url': 'https://accounts.google.com/o/oauth2/v2/auth',
        'token_url': 'https://oauth2.googleapis.com/token',
        # gmail.send is the narrowest send scope there is — it grants no read
        # access at all. openid/email are only so we learn which address the
        # caterer just connected.
        'scopes': 'openid email https://www.googleapis.com/auth/gmail.send',
        'send_url': 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        'userinfo_url': 'https://openidconnect.googleapis.com/v1/userinfo',
    },
    MICROSOFT: {
        'auth_url': 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        'token_url': 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        # offline_access is what makes Microsoft hand back a refresh token at
        # all; User.Read is read-of-profile, not read-of-mail.
        'scopes': 'offline_access openid email User.Read Mail.Send',
        'send_url': 'https://graph.microsoft.com/v1.0/me/sendMail',
        'userinfo_url': 'https://graph.microsoft.com/v1.0/me',
    },
}


class OAuthConfigError(Exception):
    """The platform's OAuth app for this provider isn't configured."""


class OAuthExchangeError(Exception):
    """The provider refused a code exchange or a refresh."""


class ProviderSendError(Exception):
    """The provider refused the send.

    `auth_failed` distinguishes a revoked/expired grant (the caterer must
    reconnect) from a transient or content problem.
    """

    def __init__(self, message, auth_failed=False):
        super().__init__(message)
        self.auth_failed = auth_failed


# ── Configuration ──

def client_credentials(provider):
    if provider == GOOGLE:
        return settings.GOOGLE_OAUTH_CLIENT_ID, settings.GOOGLE_OAUTH_CLIENT_SECRET
    if provider == MICROSOFT:
        return settings.MS_OAUTH_CLIENT_ID, settings.MS_OAUTH_CLIENT_SECRET
    raise OAuthConfigError(f'Unknown provider: {provider}')


def provider_configured(provider):
    """True when this deployment has a real OAuth app for the provider.

    False is the normal state in local dev and in CI, and is what switches the
    whole feature onto the fake transport (AC9) — no Google/Microsoft app
    needed to develop or test against.
    """
    if provider not in PROVIDERS:
        return False
    client_id, client_secret = client_credentials(provider)
    return bool(client_id and client_secret)


def redirect_uri():
    return settings.OAUTH_REDIRECT_BASE.rstrip('/') + CALLBACK_PATH


# ── Authorisation ──

def build_auth_url(provider, state):
    """The provider consent-screen URL to send the caterer to."""
    client_id, _ = client_credentials(provider)
    if not client_id:
        raise OAuthConfigError(f'No OAuth app configured for {provider}')

    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri(),
        'response_type': 'code',
        'scope': _CONFIG[provider]['scopes'],
        'state': state,
    }
    if provider == GOOGLE:
        # Without both of these Google only returns a refresh token on the very
        # first consent ever given — reconnecting after a revoke would silently
        # yield an access token we can never renew.
        params['access_type'] = 'offline'
        params['prompt'] = 'consent'
    return f"{_CONFIG[provider]['auth_url']}?{urlencode(params)}"


def exchange_code(provider, code):
    """Trade an authorisation code for tokens plus the connected address.

    Returns {'refresh_token', 'access_token', 'expires_in', 'email'}.
    """
    client_id, client_secret = client_credentials(provider)
    payload = {
        'client_id': client_id,
        'client_secret': client_secret,
        'code': code,
        'grant_type': 'authorization_code',
        'redirect_uri': redirect_uri(),
    }
    data = _post_token(provider, payload)

    refresh_token = data.get('refresh_token', '')
    if not refresh_token:
        # Without one we could send today and never again — better to fail the
        # connection now than to leave a mailbox that dies in an hour.
        raise OAuthExchangeError(
            'The provider did not return a refresh token. Remove the app from your '
            'account security settings and connect again.'
        )

    access_token = data.get('access_token', '')
    return {
        'refresh_token': refresh_token,
        'access_token': access_token,
        'expires_in': int(data.get('expires_in') or 3600),
        'email': _resolve_email(provider, data, access_token),
    }


def refresh_access_token(provider, refresh_token):
    """Renew an access token. Returns {'access_token', 'expires_in', 'refresh_token'}.

    `refresh_token` in the result is the one to store going forward — Microsoft
    rotates it on every refresh, Google usually re-sends the same one.
    """
    client_id, client_secret = client_credentials(provider)
    payload = {
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token,
        'grant_type': 'refresh_token',
    }
    if provider == MICROSOFT:
        payload['scope'] = _CONFIG[MICROSOFT]['scopes']
    data = _post_token(provider, payload)

    access_token = data.get('access_token', '')
    if not access_token:
        raise OAuthExchangeError('The provider returned no access token.')
    return {
        'access_token': access_token,
        'expires_in': int(data.get('expires_in') or 3600),
        'refresh_token': data.get('refresh_token') or refresh_token,
    }


def _post_token(provider, payload):
    response = requests.post(
        _CONFIG[provider]['token_url'], data=payload, timeout=HTTP_TIMEOUT,
    )
    if response.status_code >= 400:
        # Never log `payload` — it carries the client secret and the refresh token.
        raise OAuthExchangeError(_error_detail(response))
    try:
        return response.json()
    except ValueError:
        raise OAuthExchangeError('The provider returned an unreadable token response.')


def _resolve_email(provider, token_data, access_token):
    """Which address did the caterer just connect?"""
    email = _email_from_id_token(token_data.get('id_token', ''))
    if email:
        return email
    try:
        response = requests.get(
            _CONFIG[provider]['userinfo_url'],
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=HTTP_TIMEOUT,
        )
        if response.status_code < 400:
            data = response.json()
            return data.get('email') or data.get('mail') or data.get('userPrincipalName') or ''
    except (requests.RequestException, ValueError):
        logger.warning('Could not read the connected address from %s', provider)
    return ''


def _email_from_id_token(id_token):
    """Read the `email` claim out of an OIDC id_token.

    The signature is not checked, and doesn't need to be: this token came back
    on our own TLS connection straight from the provider's token endpoint, not
    via the browser, so there is no untrusted hop to guard against.
    """
    if not id_token or id_token.count('.') != 2:
        return ''
    payload = id_token.split('.')[1]
    payload += '=' * (-len(payload) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload)).get('email', '')
    except (ValueError, binascii.Error):
        return ''


# ── Sending ──

def send_message(provider, access_token, *, from_address, to, subject, body, attachments=None):
    """Send one message through the provider API. Returns a message id."""
    if provider == GOOGLE:
        return _send_google(access_token, from_address, to, subject, body, attachments)
    if provider == MICROSOFT:
        return _send_microsoft(access_token, to, subject, body, attachments)
    raise ProviderSendError(f'Unknown provider: {provider}')


def build_mime(*, from_address, to, subject, body, attachments=None):
    """The RFC-5322 message Gmail wants, attachments and all."""
    message = EmailMessage()
    message['From'] = from_address
    message['To'] = ', '.join(to)
    message['Subject'] = subject
    message.set_content(body)
    for filename, content, mimetype in attachments or []:
        maintype, _, subtype = mimetype.partition('/')
        message.add_attachment(
            content, maintype=maintype, subtype=subtype or 'octet-stream', filename=filename,
        )
    return message


def _send_google(access_token, from_address, to, subject, body, attachments):
    message = build_mime(
        from_address=from_address, to=to, subject=subject, body=body, attachments=attachments,
    )
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    response = requests.post(
        _CONFIG[GOOGLE]['send_url'],
        headers={'Authorization': f'Bearer {access_token}'},
        json={'raw': raw},
        timeout=HTTP_TIMEOUT,
    )
    _raise_for_send(response)
    try:
        return response.json().get('id', '')
    except ValueError:
        return ''


def _send_microsoft(access_token, to, subject, body, attachments):
    message = {
        'subject': subject,
        'body': {'contentType': 'Text', 'content': body},
        'toRecipients': [{'emailAddress': {'address': address}} for address in to],
    }
    if attachments:
        message['attachments'] = [
            {
                '@odata.type': '#microsoft.graph.fileAttachment',
                'name': filename,
                'contentType': mimetype,
                'contentBytes': base64.b64encode(content).decode(),
            }
            for filename, content, mimetype in attachments
        ]

    response = requests.post(
        _CONFIG[MICROSOFT]['send_url'],
        headers={'Authorization': f'Bearer {access_token}'},
        json={'message': message, 'saveToSentItems': True},
        timeout=HTTP_TIMEOUT,
    )
    _raise_for_send(response)
    # Graph's sendMail answers 202 with an empty body. The only way to get a
    # real provider id is to create a draft first, which needs Mail.ReadWrite —
    # i.e. read access to the caterer's whole mailbox. Not worth an id, so the
    # id Graph sends is the request id it echoes back, else empty.
    return response.headers.get('request-id', '')


def _raise_for_send(response):
    if response.status_code < 400:
        return
    # 401 is a dead grant. 403 from Gmail is usually a missing/withdrawn scope —
    # also only fixable by reconnecting.
    raise ProviderSendError(
        _error_detail(response), auth_failed=response.status_code in (401, 403),
    )


def _error_detail(response):
    """A short, safe description of a provider failure."""
    try:
        data = response.json()
    except ValueError:
        return f'HTTP {response.status_code}'
    error = data.get('error')
    if isinstance(error, dict):
        detail = error.get('message') or error.get('code') or ''
    else:
        detail = error or ''
    description = data.get('error_description') or ''
    text = ': '.join(part for part in (str(detail), str(description)) if part)
    return f'HTTP {response.status_code}' + (f' — {text}' if text else '')


def is_invalid_grant(exc):
    """True when a refresh failed because the caterer revoked access."""
    return 'invalid_grant' in str(exc).lower()
