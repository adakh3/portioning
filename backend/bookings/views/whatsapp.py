import logging
import re

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import WhatsAppMessage, OrgSettings, Lead
from bookings.serializers.whatsapp import WhatsAppMessageSerializer, WhatsAppSendSerializer
from bookings.services.whatsapp import WhatsAppService
from bookings.services.whatsapp_templates import render_template
from users.mixins import apply_org_filter, get_org_object_or_404, get_request_org

logger = logging.getLogger(__name__)


def _normalize_phone(phone):
    """Strip to digits only for comparison."""
    return re.sub(r'\D', '', phone or '')


class WhatsAppMessageListView(APIView):
    """GET /api/bookings/leads/<lead_pk>/whatsapp/ — list messages for a lead."""
    permission_classes = [IsAuthenticated]

    def get(self, request, lead_pk):
        lead = get_org_object_or_404(Lead, request, pk=lead_pk)
        qs = apply_org_filter(
            WhatsAppMessage.objects.filter(lead=lead), request
        )
        serializer = WhatsAppMessageSerializer(qs, many=True)
        return Response(serializer.data)


class WhatsAppSendView(APIView):
    """POST /api/bookings/leads/<lead_pk>/whatsapp/send/ — send a message."""
    permission_classes = [IsAuthenticated]

    def post(self, request, lead_pk):
        lead = get_org_object_or_404(Lead, request, pk=lead_pk)

        serializer = WhatsAppSendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        body = serializer.validated_data.get('body', '')
        template = serializer.validated_data.get('template')
        if template and not body:
            ctx = serializer.validated_data.get('template_context', {})
            ctx.setdefault('contact_name', lead.contact_name or '')
            ctx.setdefault('event_type', lead.event_type or '')
            ctx.setdefault('event_date', str(lead.event_date or ''))
            body = render_template(template, ctx)

        org = get_request_org(request)
        service = WhatsAppService(org)
        try:
            msg = service.send_message(lead, body, sent_by=request.user)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(WhatsAppMessageSerializer(msg).data, status=status.HTTP_201_CREATED)


class WhatsAppMarkReadView(APIView):
    """POST /api/bookings/leads/<lead_pk>/whatsapp/mark-read/ — mark inbound messages as read."""
    permission_classes = [IsAuthenticated]

    def post(self, request, lead_pk):
        lead = get_org_object_or_404(Lead, request, pk=lead_pk)
        updated = WhatsAppMessage.objects.filter(
            lead=lead,
            direction='inbound',
            read_at__isnull=True,
        ).update(read_at=timezone.now())
        return Response({'marked_read': updated})


class TwilioWebhookView(APIView):
    """POST /api/bookings/whatsapp/webhook/ — Twilio status callbacks + inbound messages."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        message_sid = request.data.get('MessageSid', '')
        message_status = request.data.get('MessageStatus', '')

        if not message_sid:
            return Response(status=status.HTTP_400_BAD_REQUEST)

        # Inbound message: has Body + From but no MessageStatus
        body = request.data.get('Body', '')
        from_number = request.data.get('From', '')
        to_number = request.data.get('To', '')

        if body and from_number and not message_status:
            return self._handle_inbound(request, message_sid, body, from_number, to_number)

        # Status callback for an outbound message
        return self._handle_status_callback(request, message_sid, message_status)

    def _find_org_settings_for_number(self, to_number):
        """Find the OrgSettings whose twilio_whatsapp_number matches the To number."""
        # Strip 'whatsapp:' prefix if present
        raw = to_number.replace('whatsapp:', '')
        normalized = _normalize_phone(raw)
        for org_settings in OrgSettings.objects.filter(whatsapp_enabled=True).exclude(twilio_whatsapp_number=''):
            if _normalize_phone(org_settings.twilio_whatsapp_number) == normalized:
                return org_settings
        return None

    def _validate_signature(self, request, auth_token):
        """Validate Twilio request signature. Returns True if valid or no token."""
        if not auth_token:
            return True
        try:
            from twilio.request_validator import RequestValidator
            validator = RequestValidator(auth_token)
            url = request.build_absolute_uri()
            signature = request.META.get('HTTP_X_TWILIO_SIGNATURE', '')
            return validator.validate(url, request.data, signature)
        except Exception:
            logger.exception('Error validating Twilio signature')
            return False

    def _handle_inbound(self, request, message_sid, body, from_number, to_number):
        """Handle an inbound WhatsApp message from a customer."""
        org_settings = self._find_org_settings_for_number(to_number)
        if not org_settings:
            logger.warning('Inbound WhatsApp to unknown number: %s', to_number)
            return Response(status=status.HTTP_404_NOT_FOUND)

        if not self._validate_signature(request, org_settings.twilio_auth_token_encrypted):
            logger.warning('Invalid Twilio webhook signature for inbound message')
            return Response(status=status.HTTP_403_FORBIDDEN)

        org = org_settings.organisation
        from_normalized = _normalize_phone(from_number)

        # Find the lead by matching contact_phone
        lead = None
        for candidate in Lead.objects.filter(organisation=org).exclude(contact_phone=''):
            if _normalize_phone(candidate.contact_phone) == from_normalized:
                lead = candidate
                break

        if not lead:
            logger.info('Inbound WhatsApp from %s — no matching lead in org %s', from_number, org.pk)
            return Response(status=status.HTTP_200_OK)

        WhatsAppMessage.objects.create(
            organisation=org,
            lead=lead,
            to_phone=to_number,
            from_phone=from_number,
            body=body,
            direction='inbound',
            status='received',
            twilio_sid=message_sid,
        )

        return Response(status=status.HTTP_200_OK)

    def _handle_status_callback(self, request, message_sid, message_status):
        """Handle a status callback for an outbound message."""
        try:
            msg = WhatsAppMessage.objects.get(twilio_sid=message_sid)
        except WhatsAppMessage.DoesNotExist:
            logger.info('Webhook for unknown message SID: %s', message_sid)
            return Response(status=status.HTTP_404_NOT_FOUND)

        # Validate signature using the org's auth token
        org_settings = OrgSettings.for_org(msg.organisation)
        if not self._validate_signature(request, org_settings.twilio_auth_token_encrypted):
            logger.warning('Invalid Twilio webhook signature')
            return Response(status=status.HTTP_403_FORBIDDEN)

        error_code = request.data.get('ErrorCode', '')
        error_message = request.data.get('ErrorMessage', '')

        if message_status:
            msg.status = message_status
        if error_code:
            msg.error_code = error_code
        if error_message:
            msg.error_message = error_message
        msg.save(update_fields=['status', 'error_code', 'error_message', 'updated_at'])

        return Response(status=status.HTTP_200_OK)
