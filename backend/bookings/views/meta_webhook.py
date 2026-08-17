"""Meta webhook receiver + lead-backfill cron (REL-507).

The webhook is public and unauthenticated by design — Meta calls it — so the
POST is authenticated by its `X-Hub-Signature-256` HMAC instead. It always
answers 200 quickly for accepted events (even when downstream processing fails):
the raw event is persisted first, and the hourly backfill recovers anything that
errored, so we never make Meta retry-then-disable the subscription over a
transient failure. The endpoint is shared with REL-508 (DM `messages` routing).
"""

import hashlib
import hmac
import json
import logging

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import ConnectedMetaPage, MetaWebhookEvent
from bookings.models.meta_webhook import LEADGEN
from bookings.services import meta_leads

logger = logging.getLogger(__name__)


class MetaWebhookView(APIView):
    """GET verification handshake + POST event receiver."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        """Meta's one-time subscription handshake: echo hub.challenge when the
        verify token matches ours."""
        mode = request.query_params.get('hub.mode')
        token = request.query_params.get('hub.verify_token') or ''
        challenge = request.query_params.get('hub.challenge', '')
        verify = settings.META_WEBHOOK_VERIFY_TOKEN
        if mode == 'subscribe' and verify and hmac.compare_digest(token, verify):
            return HttpResponse(challenge, content_type='text/plain')
        return HttpResponse('Verification failed', status=status.HTTP_403_FORBIDDEN)

    def post(self, request):
        if not self._valid_signature(request):
            logger.warning('Meta webhook POST with a bad X-Hub-Signature-256 — rejecting')
            return Response(status=status.HTTP_403_FORBIDDEN)

        try:
            payload = json.loads(request.body.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            # Nothing to act on; 200 so Meta doesn't retry an unparseable body.
            return Response(status=status.HTTP_200_OK)

        for entry in payload.get('entry', []):
            page_id = str(entry.get('id') or '')
            for change in entry.get('changes', []):
                self._handle_change(page_id, change)
        return Response(status=status.HTTP_200_OK)

    def _valid_signature(self, request):
        """HMAC-SHA256 of the raw body with the app secret, constant-time compared."""
        secret = settings.META_APP_SECRET
        header = request.headers.get('X-Hub-Signature-256', '')
        if not (secret and header.startswith('sha256=')):
            return False
        expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(header[len('sha256='):], expected)

    def _handle_change(self, page_id, change):
        field = change.get('field', '')
        value = change.get('value') or {}
        # Resolve the org by page_id (a Page belongs to whichever org connected
        # it). Unknown page ⇒ record + ignore, never an error (AC6).
        # Deterministic if the same Page were ever connected by two orgs (the
        # unique constraint is per-(org, page_id)): oldest connection wins.
        page = (
            ConnectedMetaPage.objects.unscoped()
            .filter(page_id=page_id).select_related('organisation')
            .order_by('id').first()
        )
        org = page.organisation if page else None

        event = MetaWebhookEvent.objects.create(
            organisation=org, page_id=page_id, field=field, payload=change,
        )
        if page is None:
            logger.info('Meta webhook for unconnected page %s — recorded, ignoring', page_id)
            return
        if field != LEADGEN:
            # `messages` routing arrives with REL-508; the raw event is stored.
            return
        try:
            meta_leads.ingest_from_webhook(page, value)
        except Exception as exc:
            # Persist the failure and move on — the backfill will recover it.
            logger.warning('Meta leadgen processing failed for page %s: %s', page_id, exc)
            event.error = str(exc)[:1000]
            event.save(update_fields=['error'])
            return
        event.processed_at = timezone.now()
        event.save(update_fields=['processed_at'])


class MetaLeadsCronView(APIView):
    """POST /api/bookings/cron/sync-meta-leads/ — hourly backfill sweep.

    Secret-gated (no user auth), mirroring CronRunFollowupsView: the 90-day
    retention window means the webhook alone can lose a lead to any downtime, so
    an idempotent sweep backstops it.
    """

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        secret = settings.CRON_SECRET
        if not secret:
            return Response({'detail': 'Cron endpoint not configured.'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if request.headers.get('X-Cron-Secret') != secret:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        created = meta_leads.backfill_all()
        return Response({'created': created})
