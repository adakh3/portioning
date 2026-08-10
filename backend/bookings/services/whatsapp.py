import logging

from django.conf import settings
from django.contrib.contenttypes.models import ContentType

from bookings.models import OrgSettings, WhatsAppMessage, ActivityLog

logger = logging.getLogger(__name__)


def platform_sending_available(org_settings):
    """True when this org can send WhatsApp through Twilio rather than a shortcut."""
    return bool(org_settings.twilio_configured and org_settings.whatsapp_enabled)


def normalize_whatsapp_address(phone):
    """Twilio addresses carry a `whatsapp:` prefix; plain numbers don't."""
    if not phone:
        return ''
    return phone if phone.startswith('whatsapp:') else f'whatsapp:{phone}'


def send_via_twilio(org, *, to_phone, body, parent, reminder=None, sent_by=None):
    """Platform-send one WhatsApp message and record it in the ledger.

    `parent` is the ledger parent as kwargs — ``{'lead': lead}``, ``{'quote':
    quote}`` or ``{'event': event}``. This is the single Twilio send path: the
    lead thread and booking sends both come through here, so delivery handling
    and failure recording can't drift apart between them.

    A failed send is recorded, not raised — the row IS the report. Callers that
    must know check ``msg.status``.
    """
    org_settings = OrgSettings.for_org(org)
    if not platform_sending_available(org_settings):
        raise ValueError('WhatsApp is not configured for this organisation.')
    if not to_phone:
        raise ValueError('No contact phone number.')

    from_phone = f'whatsapp:{org_settings.twilio_whatsapp_number}'
    to_address = normalize_whatsapp_address(to_phone)

    msg = WhatsAppMessage.objects.create(
        organisation=org,
        reminder=reminder,
        to_phone=to_address,
        from_phone=from_phone,
        body=body,
        channel=WhatsAppMessage.CHANNEL_WHATSAPP,
        direction='outbound',
        status='queued',
        sent_by=sent_by,
        **parent,
    )

    try:
        from twilio.rest import Client
        from twilio.http.http_client import TwilioHttpClient
        # Twilio's default client sets no timeout at all, so a hung provider
        # hangs whatever is calling us — including a client's own request on the
        # public sign page, where the signed-copy send runs (REL-474).
        client = Client(
            settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN,
            http_client=TwilioHttpClient(timeout=settings.OUTBOUND_SEND_TIMEOUT),
        )
        twilio_msg = client.messages.create(
            body=body,
            from_=from_phone,
            to=to_address,
        )
        msg.twilio_sid = twilio_msg.sid
        msg.status = 'sent'
        msg.save(update_fields=['twilio_sid', 'status', 'updated_at'])
    except Exception as exc:
        logger.exception('Failed to send WhatsApp message: %s', exc)
        msg.status = 'failed'
        msg.error_message = str(exc)[:500]
        msg.save(update_fields=['status', 'error_message', 'updated_at'])

    return msg


class WhatsAppService:
    def __init__(self, org):
        self.org = org
        self.org_settings = OrgSettings.for_org(org)

    def send_message(self, lead, body, reminder=None, sent_by=None):
        """Send a WhatsApp message to the lead's contact_phone.

        Returns the WhatsAppMessage record.
        """
        # Order matters and is load-bearing: an org with no Twilio hears about
        # that first, whether or not the lead also lacks a phone.
        if not platform_sending_available(self.org_settings):
            raise ValueError('WhatsApp is not configured for this organisation.')
        if not lead.contact_phone:
            raise ValueError('Lead has no contact phone number.')

        msg = send_via_twilio(
            self.org,
            to_phone=lead.contact_phone,
            body=body,
            parent={'lead': lead},
            reminder=reminder,
            sent_by=sent_by,
        )

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
