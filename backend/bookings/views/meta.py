"""Connect / disconnect the org's Meta (Facebook/Instagram) Pages (REL-506).

The OAuth dance mirrors the connected mailbox (`views/mailbox.py`): the browser
asks us for a consent URL, goes to Meta, and Meta redirects back to our
callback. Tokens never touch the browser. The one shape difference is the
picker: an org may admin several Pages, so the callback only stores the org's
long-lived *user* token, then the frontend lists Pages (`GET pages/`) and posts
back the ones to connect (`POST pages/`), each of which gets its own Page token
and a webhook subscription.

The whole surface is gated by settings.META_LEADS_ENABLED — off by default, so
until launch every endpoint here 404s and nothing is user-visible.
"""

import hashlib
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.core import signing
from django.db import IntegrityError, transaction
from django.http import Http404
from django.shortcuts import redirect
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import ConnectedMetaPage, MetaAccountConnection
from bookings.permissions import IsAdminOrOwner
from bookings.serializers.meta import ConnectedMetaPageSerializer
from bookings.services import meta
from payments.access import org_has_access
from users.mixins import get_request_org

logger = logging.getLogger(__name__)

STATE_SALT = 'bookings.meta-oauth-state'
# A human filling in a consent screen — long enough to be realistic, short
# enough that a leaked state is worthless by the time it's found.
STATE_MAX_AGE = 15 * 60
NONCE_COOKIE = 'meta_oauth_nonce'
COOKIE_PATH = '/api/integrations/meta/'


def _hash_nonce(nonce):
    return hashlib.sha256(nonce.encode()).hexdigest()


def _settings_redirect(**params):
    """Back to the Settings integrations tab, with a result to show."""
    query = urlencode({'tab': 'integrations', **params})
    return redirect(f'{settings.FRONTEND_BASE_URL.rstrip("/")}/settings?{query}')


def _billing_redirect():
    """Where a blocked org goes — the same place the subscription gate sends
    every other browser navigation it turns away."""
    return redirect(
        f'{settings.FRONTEND_BASE_URL.rstrip("/")}/billing?reason=subscription_required'
    )


def _fake_pages():
    """The Pages offered when no Meta app is configured — local dev and CI.

    Mirrors the mailbox fake transport: the whole connect → pick → subscribe
    flow stays walkable on a laptop with no Meta app, and tests that don't set
    META_APP_ID exercise it without a network call.
    """
    return [
        {
            'page_id': 'fake-page-1', 'page_name': 'Demo Catering (Test Page)',
            'page_access_token': 'fake-page-token-1',
            'instagram_account_id': 'fake-ig-1', 'instagram_username': 'demo_catering',
        },
        {
            'page_id': 'fake-page-2', 'page_name': 'Demo Events (Test Page)',
            'page_access_token': 'fake-page-token-2',
            'instagram_account_id': '', 'instagram_username': '',
        },
    ]


class MetaFeatureView(APIView):
    """Base view that 404s the whole feature when the launch flag is off.

    The check runs *before* auth/permissions, so a flag-off deployment hides
    these endpoints entirely (AC1) whether or not the caller is signed in — an
    anonymous hit gets the same 404 as an admin.
    """

    def initial(self, request, *args, **kwargs):
        if not getattr(settings, 'META_LEADS_ENABLED', False):
            raise Http404()
        super().initial(request, *args, **kwargs)


class MetaStatusView(MetaFeatureView):
    """GET /api/integrations/meta/ — is Meta connected, and which Pages?"""

    permission_classes = [IsAdminOrOwner]

    def get(self, request):
        org = get_request_org(request)
        connection = MetaAccountConnection.objects.for_org(org).first() if org else None
        pages = (
            ConnectedMetaPage.objects.for_org(org).order_by('page_name')
            if org else ConnectedMetaPage.objects.none()
        )
        return Response({
            'app_configured': meta.app_configured(),
            'authorized': connection is not None,
            'pages': ConnectedMetaPageSerializer(pages, many=True).data,
        })


class MetaConnectView(MetaFeatureView):
    """GET /api/integrations/meta/connect/ — the Meta consent URL to navigate to."""

    permission_classes = [IsAdminOrOwner]

    def get(self, request):
        org = get_request_org(request)
        if org is None:
            return Response(
                {'detail': 'Select an organisation before connecting Meta.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        nonce = secrets.token_urlsafe(32)
        state = signing.dumps(
            {
                'org': org.pk,
                'user': request.user.pk,
                # Only the hash travels in the state — `signing.dumps` signs but
                # does not encrypt, so the raw nonce would publish the secret the
                # cookie is meant to prove.
                'nonce_hash': _hash_nonce(nonce),
            },
            salt=STATE_SALT,
        )

        if meta.app_configured():
            auth_url = meta.build_auth_url(state)
        else:
            # No Meta app on this deployment — short-circuit straight to our own
            # callback so the whole flow is exercisable offline.
            auth_url = (
                f'{settings.OAUTH_REDIRECT_BASE.rstrip("/")}{meta.CALLBACK_PATH}'
                f'?{urlencode({"code": "fake-code", "state": state})}'
            )

        response = Response({'auth_url': auth_url})
        # The nonce ties the callback to *this* browser; without it an admin of
        # another org could hand a victim a link whose state names the attacker's
        # org and capture the victim's connection onto it.
        response.set_cookie(
            NONCE_COOKIE, nonce,
            max_age=STATE_MAX_AGE, httponly=True, samesite='Lax',
            secure=request.is_secure() or not settings.DEBUG, path=COOKIE_PATH,
        )
        return response


class MetaCallbackView(MetaFeatureView):
    """GET /api/integrations/meta/callback/ — Meta sends the browser here.

    Unauthenticated by design: identity comes from the signed `state` we minted,
    plus the nonce cookie proving it's the same browser that started. Stores only
    the org's long-lived user token; the Page picker comes next via `pages/`.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        error = request.query_params.get('error')
        if error:
            return _settings_redirect(meta_error=error)

        code = request.query_params.get('code', '')
        raw_state = request.query_params.get('state', '')
        if not code or not raw_state:
            return _settings_redirect(meta_error='invalid_request')

        try:
            state = signing.loads(raw_state, salt=STATE_SALT, max_age=STATE_MAX_AGE)
        except signing.SignatureExpired:
            return _settings_redirect(meta_error='expired')
        except signing.BadSignature:
            logger.warning('Meta OAuth callback with a bad state signature')
            return _settings_redirect(meta_error='invalid_state')

        # Fail closed: a state with no hash must never satisfy this.
        expected = state.get('nonce_hash') or ''
        presented = _hash_nonce(request.COOKIES.get(NONCE_COOKIE) or '')
        if not expected or not secrets.compare_digest(presented, expected):
            logger.warning('Meta OAuth callback nonce mismatch — refusing')
            return _settings_redirect(meta_error='invalid_state')

        from users.models import Organisation, User
        org = Organisation.objects.filter(pk=state.get('org'), is_active=True).first()
        user = User.objects.filter(pk=state.get('user')).first()
        if org is None:
            return _settings_redirect(meta_error='invalid_state')

        # The subscription gate can't cover this unauthenticated view; the signed
        # state names the org, so ask the same question here (mirrors mailbox).
        if not org_has_access(org):
            return _billing_redirect()

        try:
            token = self._get_user_token(code)
        except (meta.MetaConfigError, meta.MetaExchangeError, meta.MetaApiError) as exc:
            logger.warning('Meta OAuth exchange failed for org %s: %s', org.pk, exc)
            return _settings_redirect(meta_error='exchange_failed')
        except Exception:
            logger.exception('Meta OAuth exchange blew up for org %s', org.pk)
            return _settings_redirect(meta_error='exchange_failed')

        try:
            self._store_connection(org, user, token)
        except IntegrityError:
            # Two tabs finishing the dance at once; the other one won.
            logger.warning('Concurrent Meta connect for org %s', org.pk)
            return _settings_redirect(meta_error='exchange_failed')
        response = _settings_redirect(meta='connected')
        response.delete_cookie(NONCE_COOKIE, path=COOKIE_PATH)
        return response

    def _get_user_token(self, code):
        if meta.app_configured():
            short = meta.exchange_code(code)
            return meta.get_long_lived_token(short['access_token'])
        # No Meta app: a believable stand-in so dev/CI walk the whole flow.
        return {'access_token': 'fake-user-token', 'expires_in': 60 * 24 * 3600}

    def _store_connection(self, org, user, token):
        # A superuser connecting while switched into another org would trip the
        # cross-org FK guard on connected_by; the connection is the org's either
        # way, so just don't attribute it (mirrors mailbox).
        if user is not None and user.organisation_id != org.pk:
            user = None

        with transaction.atomic():
            connection, _ = MetaAccountConnection.objects.update_or_create(
                organisation=org,
                defaults={
                    'connected_by': user,
                    'token_expires_at': timezone.now() + timedelta(
                        seconds=token.get('expires_in') or 60 * 24 * 3600,
                    ),
                },
            )
            connection.user_access_token = token['access_token']
            connection.save(update_fields=['user_access_token_encrypted', 'updated_at'])


class MetaPagesView(MetaFeatureView):
    """GET lists the org's available Pages; POST connects the chosen ones."""

    permission_classes = [IsAdminOrOwner]

    def get(self, request):
        org = get_request_org(request)
        connection = self._connection_or_none(org)
        if connection is None:
            return Response(
                {'detail': 'Connect Meta before listing Pages.'},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            available = self._available_pages(connection)
        except meta.MetaApiError as exc:
            logger.warning('Listing Meta Pages failed for org %s: %s', org.pk, exc)
            return Response(
                {'detail': 'Could not reach Meta. The connection may need renewing.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        connected = set(
            ConnectedMetaPage.objects.for_org(org).values_list('page_id', flat=True)
        )
        # Never return the Page access tokens to the browser.
        return Response([
            {
                'page_id': p['page_id'], 'page_name': p['page_name'],
                'instagram_account_id': p['instagram_account_id'],
                'instagram_username': p['instagram_username'],
                'connected': p['page_id'] in connected,
            }
            for p in available
        ])

    def post(self, request):
        org = get_request_org(request)
        connection = self._connection_or_none(org)
        if connection is None:
            return Response(
                {'detail': 'Connect Meta before connecting Pages.'},
                status=status.HTTP_409_CONFLICT,
            )

        requested = request.data.get('page_ids') or []
        if not isinstance(requested, list) or not requested:
            return Response(
                {'detail': 'Choose at least one Page to connect.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            available = {p['page_id']: p for p in self._available_pages(connection)}
        except meta.MetaApiError as exc:
            logger.warning('Listing Meta Pages failed for org %s: %s', org.pk, exc)
            return Response(
                {'detail': 'Could not reach Meta. The connection may need renewing.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        user = request.user if request.user.organisation_id == org.pk else None
        errors = []
        for page_id in requested:
            page = available.get(page_id)
            if page is None:
                errors.append({'page_id': page_id, 'detail': 'Not an available Page.'})
                continue
            try:
                self._connect_page(org, connection, user, page)
            except meta.MetaApiError as exc:
                # Subscription failed — don't leave a "connected" row with no live
                # webhook behind it. Report it and move on to the next Page.
                logger.warning('Subscribing Meta Page %s failed: %s', page_id, exc)
                errors.append({'page_id': page_id, 'detail': 'Could not subscribe this Page.'})

        pages = ConnectedMetaPage.objects.for_org(org).order_by('page_name')
        return Response(
            {'pages': ConnectedMetaPageSerializer(pages, many=True).data, 'errors': errors},
            status=status.HTTP_200_OK,
        )

    def _connect_page(self, org, connection, user, page):
        """Subscribe the Page's webhooks, then store its row — in that order, so
        a row only ever exists for a Page whose subscription actually took."""
        if meta.app_configured():
            meta.subscribe_page(page['page_id'], page['page_access_token'])
        with transaction.atomic():
            row, _ = ConnectedMetaPage.objects.update_or_create(
                organisation=org, page_id=page['page_id'],
                defaults={
                    'connection': connection,
                    'page_name': page['page_name'],
                    'instagram_account_id': page['instagram_account_id'],
                    'instagram_username': page['instagram_username'],
                    'connected_by': user,
                },
            )
            row.page_access_token = page['page_access_token']
            row.save(update_fields=['page_access_token_encrypted', 'updated_at'])

    @staticmethod
    def _connection_or_none(org):
        if org is None:
            return None
        return MetaAccountConnection.objects.for_org(org).first()

    @staticmethod
    def _available_pages(connection):
        if meta.app_configured():
            return meta.list_pages(connection.user_access_token)
        return _fake_pages()


class MetaDisconnectView(MetaFeatureView):
    """POST /api/integrations/meta/disconnect/ — forget one connected Page."""

    permission_classes = [IsAdminOrOwner]

    def post(self, request):
        org = get_request_org(request)
        page_id = request.data.get('page_id') or ''
        page = (
            ConnectedMetaPage.objects.for_org(org).filter(page_id=page_id).first()
            if org else None
        )
        if page is None:
            return Response(
                {'detail': 'No such connected Page.'}, status=status.HTTP_404_NOT_FOUND,
            )

        self._best_effort_unsubscribe(page)
        # Delete the row outright: no lingering Page token anywhere.
        page.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @staticmethod
    def _best_effort_unsubscribe(page):
        """Ask Meta to drop the webhook subscription too. Never blocks the
        disconnect — a dead token still means we should forget the Page."""
        if not (meta.app_configured() and page.page_access_token_encrypted):
            return
        try:
            meta.unsubscribe_page(page.page_id, page.page_access_token)
        except Exception:
            logger.info('Could not unsubscribe Meta Page %s on disconnect; deleting locally anyway', page.page_id)
