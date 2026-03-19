import logging

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import WhatsAppMessage
from bookings.serializers.whatsapp import WhatsAppMessageSerializer, WhatsAppSendSerializer
from bookings.services.whatsapp import WhatsAppService
from bookings.services.whatsapp_templates import render_template
from users.mixins import apply_org_filter, get_org_object_or_404, get_request_org

logger = logging.getLogger(__name__)


class WhatsAppMessageListView(APIView):
    """GET /api/bookings/leads/<lead_pk>/whatsapp/ — list messages for a lead."""
    permission_classes = [IsAuthenticated]

    def get(self, request, lead_pk):
        from bookings.models import Lead
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
        from bookings.models import Lead
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


class TwilioWebhookView(APIView):
    """POST /api/bookings/whatsapp/webhook/ — Twilio status callback."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        message_sid = request.data.get('MessageSid', '')
        message_status = request.data.get('MessageStatus', '')
        error_code = request.data.get('ErrorCode', '')
        error_message = request.data.get('ErrorMessage', '')

        if not message_sid:
            return Response(status=status.HTTP_400_BAD_REQUEST)

        # Validate Twilio signature using platform-level credentials
        auth_token = getattr(settings, 'TWILIO_AUTH_TOKEN', '') or None
        if auth_token:
            from twilio.request_validator import RequestValidator
            validator = RequestValidator(auth_token)
            url = request.build_absolute_uri()
            signature = request.META.get('HTTP_X_TWILIO_SIGNATURE', '')
            if not validator.validate(url, request.data, signature):
                logger.warning('Invalid Twilio webhook signature')
                return Response(status=status.HTTP_403_FORBIDDEN)

        try:
            msg = WhatsAppMessage.objects.get(twilio_sid=message_sid)
        except WhatsAppMessage.DoesNotExist:
            logger.info('Webhook for unknown message SID: %s', message_sid)
            return Response(status=status.HTTP_404_NOT_FOUND)

        if message_status:
            msg.status = message_status
        if error_code:
            msg.error_code = error_code
        if error_message:
            msg.error_message = error_message
        msg.save(update_fields=['status', 'error_code', 'error_message', 'updated_at'])

        return Response(status=status.HTTP_200_OK)
