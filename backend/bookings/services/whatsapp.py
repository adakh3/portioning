import logging

from django.contrib.contenttypes.models import ContentType

from bookings.models import OrgSettings, WhatsAppMessage, ActivityLog

logger = logging.getLogger(__name__)


class WhatsAppService:
    def __init__(self, org):
        self.org = org
        self.org_settings = OrgSettings.for_org(org)

    def send_message(self, lead, body, reminder=None, sent_by=None):
        """Send a WhatsApp message to the lead's contact_phone.

        Returns the WhatsAppMessage record.
        """
        s = self.org_settings
        if not s.twilio_configured or not s.whatsapp_enabled:
            raise ValueError('WhatsApp is not configured for this organisation.')

        if not lead.contact_phone:
            raise ValueError('Lead has no contact phone number.')

        from_phone = f'whatsapp:{s.twilio_whatsapp_number}'
        to_phone = lead.contact_phone
        if not to_phone.startswith('whatsapp:'):
            to_phone = f'whatsapp:{to_phone}'

        msg = WhatsAppMessage.objects.create(
            organisation=self.org,
            lead=lead,
            reminder=reminder,
            to_phone=to_phone,
            from_phone=from_phone,
            body=body,
            direction='outbound',
            status='queued',
            sent_by=sent_by,
        )

        try:
            from twilio.rest import Client
            client = Client(s.twilio_account_sid, s.twilio_auth_token_encrypted)
            twilio_msg = client.messages.create(
                body=body,
                from_=from_phone,
                to=to_phone,
            )
            msg.twilio_sid = twilio_msg.sid
            msg.status = 'sent'
            msg.save(update_fields=['twilio_sid', 'status', 'updated_at'])
        except Exception as exc:
            logger.exception('Failed to send WhatsApp message: %s', exc)
            msg.status = 'failed'
            msg.error_message = str(exc)[:500]
            msg.save(update_fields=['status', 'error_message', 'updated_at'])

        # Log activity on the lead
        ct = ContentType.objects.get_for_model(lead)
        ActivityLog.objects.create(
            content_type=ct,
            object_id=lead.pk,
            action='updated',
            field_name='whatsapp',
            new_value=f'Message {msg.status}',
            description=f'WhatsApp message {msg.status} to {msg.to_phone}',
            user=sent_by,
        )

        return msg
