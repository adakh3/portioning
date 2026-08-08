"""Connect / disconnect the caterer's own mailbox (REL-460).

The OAuth dance is backend-driven: the browser asks us for a consent URL, goes
to the provider, and the provider redirects back to our callback. No frontend
SDK, and the tokens never touch the browser.
"""

import hashlib
import logging
import secrets
from urllib.parse import urlencode

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.shortcuts import redirect
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import ConnectedMailbox
from bookings.permissions import IsAdminOrOwner
from bookings.serializers.mailbox import ConnectedMailboxSerializer
from bookings.services import mailbox_oauth
from bookings.services.email import get_mailbox, store_tokens
from users.mixins import get_request_org

logger = logging.getLogger(__name__)

STATE_SALT = 'bookings.mailbox-oauth-state'
# The consent screen is a human filling in a form — long enough to be realistic,
# short enough that a leaked state is worthless by the time it's found.
STATE_MAX_AGE = 15 * 60
NONCE_COOKIE = 'mailbox_oauth_nonce'
COOKIE_PATH = '/api/integrations/email/'


def _hash_nonce(nonce):
    return hashlib.sha256(nonce.encode()).hexdigest()


# EmailField's column width. Anything longer is not an address we could send
# from, and on Postgres it would raise DataError mid-callback.
MAX_ADDRESS_LENGTH = 254


def _is_storable_address(address):
    if not address or len(address) > MAX_ADDRESS_LENGTH:
        return False
    try:
        validate_email(address)
    except ValidationError:
        return False
    return True


def _settings_redirect(**params):
    """Back to the Settings integrations tab, with a result to show."""
    query = urlencode({'tab': 'integrations', **params})
    return redirect(f'{settings.FRONTEND_BASE_URL.rstrip("/")}/settings?{query}')


class MailboxStatusView(APIView):
    """GET /api/integrations/email/ — is a mailbox connected, and which one?

    Readable by any authenticated user: whether the email channel is available
    is not an admin secret, and REL-445 needs it wherever a send is offered.
    Only connecting and disconnecting are admin/owner.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        mailbox = get_mailbox(get_request_org(request))
        return Response({
            'connected': mailbox is not None,
            'mailbox': ConnectedMailboxSerializer(mailbox).data if mailbox else None,
            # Which buttons to offer. In local dev neither is configured and the
            # fake transport stands in, so offer both rather than a dead card.
            'providers_available': _providers_available(),
        })


def _providers_available():
    """The providers this deployment can actually complete a connection with."""
    return [p for p in mailbox_oauth.PROVIDERS if mailbox_oauth.provider_available(p)]


class MailboxConnectView(APIView):
    """GET /api/integrations/email/connect/?provider=google|microsoft

    Returns the provider consent URL for the browser to navigate to.
    """

    permission_classes = [IsAdminOrOwner]

    def get(self, request):
        provider = request.query_params.get('provider', '')
        if provider not in mailbox_oauth.PROVIDERS:
            return Response(
                {'detail': 'Choose either Google or Microsoft.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not mailbox_oauth.provider_available(provider):
            return Response(
                {'detail': f'{provider.title()} email is not available on this deployment.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        org = get_request_org(request)
        if org is None:
            return Response(
                {'detail': 'Select an organisation before connecting a mailbox.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        nonce = secrets.token_urlsafe(32)
        state = signing.dumps(
            {
                'org': org.pk,
                'user': request.user.pk,
                'provider': provider,
                # Only the *hash* travels in the state. `signing.dumps` signs but
                # does not encrypt, so a state carrying the raw nonce would
                # publish the very secret the cookie is supposed to prove.
                'nonce_hash': _hash_nonce(nonce),
                # Only consulted in fake mode, so local dev connects as a
                # believable address instead of a placeholder.
                'dev_email': request.user.email or 'dev@example.test',
            },
            salt=STATE_SALT,
        )

        if mailbox_oauth.provider_configured(provider):
            auth_url = mailbox_oauth.build_auth_url(provider, state)
        else:
            # No OAuth app on this deployment — short-circuit straight to our
            # own callback so the whole flow is exercisable offline (AC9).
            auth_url = (
                f'{settings.OAUTH_REDIRECT_BASE.rstrip("/")}{mailbox_oauth.CALLBACK_PATH}'
                f'?{urlencode({"code": "fake-code", "state": state})}'
            )

        response = Response({'auth_url': auth_url})
        # The nonce is what ties the callback to *this* browser. Without it, an
        # admin of another org could hand a victim a link whose state names the
        # attacker's org and capture the victim's mailbox on it.
        response.set_cookie(
            NONCE_COOKIE, nonce,
            max_age=STATE_MAX_AGE, httponly=True, samesite='Lax',
            # Secure on any HTTPS connection, and unconditionally outside
            # DEBUG. `is_secure()` alone would be the tidier rule, but it reads
            # X-Forwarded-Proto exclusively once SECURE_PROXY_SSL_HEADER is set
            # — so it only stays true in production because SECURE_SSL_REDIRECT
            # turns plain HTTP away first. Someone exempting a path from that
            # redirect shouldn't be able to quietly drop Secure from a
            # credential-bearing cookie, hence the second clause.
            secure=request.is_secure() or not settings.DEBUG, path=COOKIE_PATH,
        )
        return response


class MailboxCallbackView(APIView):
    """GET /api/integrations/email/callback/ — the provider sends the browser here.

    Unauthenticated by design: identity comes from the signed `state`, which we
    minted, plus the nonce cookie proving it's the same browser that started.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        error = request.query_params.get('error')
        if error:
            # The caterer pressed Cancel, or the provider refused.
            return _settings_redirect(email_error=error)

        code = request.query_params.get('code', '')
        raw_state = request.query_params.get('state', '')
        if not code or not raw_state:
            return _settings_redirect(email_error='invalid_request')

        try:
            state = signing.loads(raw_state, salt=STATE_SALT, max_age=STATE_MAX_AGE)
        except signing.SignatureExpired:
            return _settings_redirect(email_error='expired')
        except signing.BadSignature:
            logger.warning('Mailbox OAuth callback with a bad state signature')
            return _settings_redirect(email_error='invalid_state')

        # Fail closed: a state with no hash must never satisfy this.
        expected = state.get('nonce_hash') or ''
        presented = _hash_nonce(request.COOKIES.get(NONCE_COOKIE) or '')
        if not expected or not secrets.compare_digest(presented, expected):
            logger.warning('Mailbox OAuth callback nonce mismatch — refusing')
            return _settings_redirect(email_error='invalid_state')

        provider = state.get('provider')
        if provider not in mailbox_oauth.PROVIDERS:
            return _settings_redirect(email_error='invalid_state')

        from users.models import Organisation, User
        org = Organisation.objects.filter(pk=state.get('org'), is_active=True).first()
        user = User.objects.filter(pk=state.get('user')).first()
        if org is None:
            return _settings_redirect(email_error='invalid_state')

        try:
            tokens = self._get_tokens(provider, code, state)
        except mailbox_oauth.OAuthExchangeError as exc:
            logger.warning('Mailbox OAuth exchange failed for org %s: %s', org.pk, exc)
            return _settings_redirect(email_error='exchange_failed')
        except Exception:
            logger.exception('Mailbox OAuth exchange blew up for org %s', org.pk)
            return _settings_redirect(email_error='exchange_failed')

        if not _is_storable_address(tokens.get('email')):
            # Better to refuse than to store something we'd fail to send from —
            # an over-long value would also blow up the INSERT on Postgres.
            return _settings_redirect(email_error='no_address')

        try:
            response = self._store(org, user, provider, tokens)
        except IntegrityError:
            # Two tabs finishing the dance at once; the other one won.
            logger.warning('Concurrent mailbox connect for org %s', org.pk)
            return _settings_redirect(email_error='exchange_failed')
        response.delete_cookie(NONCE_COOKIE, path=COOKIE_PATH)
        return response

    def _get_tokens(self, provider, code, state):
        if mailbox_oauth.provider_configured(provider):
            return mailbox_oauth.exchange_code(provider, code)
        return {
            'refresh_token': 'fake-refresh-token',
            'access_token': 'fake-access-token',
            'expires_in': 3600,
            'email': state.get('dev_email') or 'dev@example.test',
        }

    def _store(self, org, user, provider, tokens):
        # A superuser connecting while switched into another org would otherwise
        # trip the cross-org FK guard on connected_by; the mailbox is the org's
        # either way, so just don't attribute it.
        if user is not None and user.organisation_id != org.pk:
            user = None

        # One transaction: the row and its tokens land together or not at all.
        # Split across two commits, a failure between them leaves a mailbox
        # showing "Connected" with no credentials behind it.
        with transaction.atomic():
            # Reconnecting replaces whatever was there — including switching to
            # the other provider or to a different address.
            mailbox, _ = ConnectedMailbox.objects.update_or_create(
                organisation=org,
                defaults={
                    'provider': provider,
                    'email_address': tokens['email'],
                    'connected_by': user,
                    'status': ConnectedMailbox.CONNECTED,
                    'last_error': '',
                },
            )
            store_tokens(
                mailbox,
                access_token=tokens.get('access_token', ''),
                expires_in=tokens.get('expires_in', 3600),
                refresh_token=tokens['refresh_token'],
            )
        return _settings_redirect(email='connected')


class MailboxDisconnectView(APIView):
    """POST /api/integrations/email/disconnect/ — forget the mailbox entirely."""

    permission_classes = [IsAdminOrOwner]

    def post(self, request):
        mailbox = get_mailbox(get_request_org(request))
        if mailbox is None:
            return Response(
                {'detail': 'No mailbox is connected.'}, status=status.HTTP_404_NOT_FOUND,
            )

        _best_effort_revoke(mailbox)
        # Delete the row outright: no lingering refresh token anywhere.
        mailbox.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _best_effort_revoke(mailbox):
    """Ask the provider to drop the grant too, so it also disappears from the
    caterer's account security page. Never blocks the disconnect."""
    if mailbox.provider != mailbox_oauth.GOOGLE:
        return
    if not (mailbox_oauth.provider_configured(mailbox.provider) and mailbox.refresh_token_encrypted):
        return
    try:
        import requests
        requests.post(
            'https://oauth2.googleapis.com/revoke',
            data={'token': mailbox.refresh_token},
            timeout=mailbox_oauth.HTTP_TIMEOUT,
        )
    except Exception:
        logger.info('Could not revoke the Google grant on disconnect; deleting locally anyway')
