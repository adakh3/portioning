"""Staff endpoints for messaging a client: draft it, send it, read the history.

Three parents share these views — a quote, an event or a lead — because "message
this client" is the same operation whichever record the rep happens to be
looking at. The parent is resolved per route; everything after that is identical.
"""
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import Lead, Quote, WhatsAppMessage
from bookings.serializers.whatsapp import WhatsAppMessageSerializer
from bookings.services import messaging
from bookings.services.message_drafter import draft_client_message, is_available
from bookings.services.messaging_kinds import ALL_KINDS, KIND_COMPOSE, KIND_SIGNED_COPY
from users.mixins import apply_org_filter, get_org_object_or_404


def _resolve(request, parent_type, pk):
    """The quote/event/lead this request is about — org-scoped, 404 otherwise."""
    if parent_type == 'quote':
        return get_org_object_or_404(Quote, request, pk=pk)
    if parent_type == 'lead':
        return get_org_object_or_404(Lead, request, pk=pk)
    from events.models import Event
    return get_org_object_or_404(Event, request, pk=pk)


def _validated_kind(request, parent, *, sending=False):
    """The requested kind, refusing the ones this parent can't have.

    A lead has no booking to sign, so only compose applies — asking for a sign
    link on one is a bug in the caller, not something to paper over.
    """
    kind = request.data.get('kind') or KIND_COMPOSE
    if kind not in ALL_KINDS:
        raise ValueError(f'Unknown message kind {kind!r}.')
    if isinstance(parent, Lead) and kind != KIND_COMPOSE:
        raise ValueError('A lead can only be sent a composed message.')
    if (sending and kind == KIND_SIGNED_COPY
            and messaging.effective_signature(parent) is None):
        # There is no signed copy to send. Sending anyway would mail the client
        # a live-rendered document under a "your signed confirmation" subject.
        raise ValueError('This booking has not been signed yet.')
    return kind


def _validated_channel(request, parent):
    """The requested channel, or the resolved default. Never a guess.

    Anything unrecognised is refused rather than falling through to WhatsApp —
    a typo ('Email') or a channel we haven't built yet must not silently send
    the client's proposal somewhere else.
    """
    channel = request.data.get('channel')
    if not channel:
        return messaging.resolve_channel(parent.organisation, parent)
    if channel not in (messaging.CHANNEL_EMAIL, messaging.CHANNEL_WHATSAPP):
        raise ValueError(f'Unknown channel {channel!r}.')
    return channel


class ClientMessageDraftView(APIView):
    """POST …/draft-message/ — a draft for the rep to edit. Never sends."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk, parent_type='quote'):
        parent = _resolve(request, parent_type, pk)
        try:
            kind = _validated_kind(request, parent)
            channel = _validated_channel(request, parent)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        org = parent.organisation
        url = '' if isinstance(parent, Lead) else messaging.booking_public_url(parent)
        attachment_name = ''
        if (channel == messaging.CHANNEL_EMAIL and kind != KIND_COMPOSE
                and not isinstance(parent, Lead)):
            attachment_name = messaging.attachment_filename(parent, kind)

        draft = draft_client_message(
            parent, kind, channel, url=url, attachment_name=attachment_name,
        )
        return Response({
            **draft,
            'kind': kind,
            'channel': channel,
            'link': url,
            'attachment_filename': attachment_name,
            # Lets the UI decide whether to show the AI marker at all, without
            # inferring it from used_fallback (which is also true on an error).
            'llm_available': is_available(),
            'availability': messaging.channel_availability(org, parent),
        })


class ClientMessageSendView(APIView):
    """POST …/send-message/ — send what the rep approved, and ledger it."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk, parent_type='quote'):
        parent = _resolve(request, parent_type, pk)
        try:
            kind = _validated_kind(request, parent, sending=True)
            channel = _validated_channel(request, parent)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        body = (request.data.get('body') or '').strip()
        subject = (request.data.get('subject') or '').strip()
        if not body:
            return Response({'body': 'A message body is required.'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            msg = self._send(parent, kind, channel, subject, body, request.user)
        except messaging.ChannelUnavailable as exc:
            return Response({'detail': str(exc), 'reason': exc.reason},
                            status=status.HTTP_400_BAD_REQUEST)
        except messaging.MessagingError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            # The transport failed after the ledger row was written; the row
            # already says `failed`, so report it rather than 500ing.
            return Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(WhatsAppMessageSerializer(msg).data,
                        status=status.HTTP_201_CREATED)

    def _send(self, parent, kind, channel, subject, body, user):
        if kind == KIND_COMPOSE or isinstance(parent, Lead):
            if channel == messaging.CHANNEL_EMAIL:
                return messaging.send_client_email(
                    parent, subject=subject, body=body, sent_by=user,
                )
            return self._send_whatsapp(parent, body, user)
        return messaging.send_booking_link(
            parent, kind, channel=channel, sent_by=user, subject=subject, body=body,
        )

    def _send_whatsapp(self, parent, body, user):
        """Platform-send when we can; otherwise record the caterer's own send."""
        from bookings.models import OrgSettings
        from bookings.services import whatsapp as whatsapp_service

        who = messaging.recipient_for(parent)
        if not who['phone']:
            raise messaging.ChannelUnavailable(
                'This contact has no phone number on file.',
                reason=messaging.NO_PHONE,
            )
        if whatsapp_service.platform_sending_available(
                OrgSettings.for_org(parent.organisation)):
            return whatsapp_service.send_via_twilio(
                parent.organisation,
                to_phone=who['phone'],
                body=body,
                parent=messaging.parent_kwargs(parent),
                sent_by=user,
            )
        return messaging.record_whatsapp_handoff(parent, body=body, sent_by=user)


class ClientMessageListView(APIView):
    """GET …/messages/ — this booking's message history (AC8)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk, parent_type='quote'):
        parent = _resolve(request, parent_type, pk)
        lookup = {'quote': parent} if isinstance(parent, Quote) else (
            {'lead': parent} if isinstance(parent, Lead) else {'event': parent}
        )
        qs = apply_org_filter(
            WhatsAppMessage.objects.filter(**lookup).select_related('sent_by'), request,
        )
        return Response(WhatsAppMessageSerializer(qs, many=True).data)


class ClientMessagingStatusView(APIView):
    """GET …/messaging-status/ — what this client can be reached on, and why not."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk, parent_type='quote'):
        parent = _resolve(request, parent_type, pk)
        return Response(messaging.channel_availability(parent.organisation, parent))
