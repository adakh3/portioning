"""Sending messages to clients — one service for every channel and surface.

Quotes, events and leads all send through here, so "what did we tell this client
and when" has exactly one answer, recorded in one ledger
(``bookings/models/whatsapp.py``).

Two rules shape everything below.

**The ledger never claims more than it knows.** Email through the caterer's
mailbox and WhatsApp through Twilio both leave the platform, so they can be
recorded as sent. A ``wa.me`` shortcut only opens WhatsApp on the caterer's own
phone — we never learn whether they pressed send — so it is recorded
``handed_off``, never ``sent``.

**Machines don't send on channels that need a human.** Anything triggered
without a person clicking (the signed-copy send after a client signs) may only
use an API-capable channel. When the only channel left is a shortcut, nothing is
claimed: a ``to_send`` task row is written for a human to action.
"""
import logging

from django.conf import settings

from bookings.models import OrgSettings, WhatsAppMessage
from bookings.services import email as email_service
from bookings.services import whatsapp as whatsapp_service
from bookings.services.message_templates import render_client_message
from bookings.services.messaging_kinds import (  # noqa: F401  (re-exported)
    ALL_KINDS, KIND_COMPOSE, KIND_SIGN_LINK, KIND_SIGNED_COPY,
)

logger = logging.getLogger(__name__)

CHANNEL_EMAIL = WhatsAppMessage.CHANNEL_EMAIL
CHANNEL_WHATSAPP = WhatsAppMessage.CHANNEL_WHATSAPP


class MessagingError(Exception):
    """Base for every reason a client message could not be sent."""


class ChannelUnavailable(MessagingError):
    """The requested channel cannot be used for this recipient right now.

    Carries `reason` so the UI can tell the two email failures apart: an org
    with no mailbox needs a Connect link, a contact with no address needs their
    record fixed. Conflating them sends the caterer to the wrong screen.
    """

    def __init__(self, message, *, reason):
        super().__init__(message)
        self.reason = reason


# `reason` values — the frontend branches on these, so they are API surface.
NO_MAILBOX = 'no_mailbox'
# A mailbox that was connected and has since died needs *re*connecting; sending
# that caterer to "Connect your email" as if they had never set it up reads as
# the platform having lost their setup.
MAILBOX_NEEDS_RECONNECT = 'mailbox_needs_reconnect'
NO_EMAIL_ADDRESS = 'no_email_address'
NO_PHONE = 'no_phone'
WHATSAPP_DISABLED = 'whatsapp_disabled'
UNKNOWN_CHANNEL = 'unknown_channel'

_EMAIL_BLOCKER_MESSAGES = {
    NO_MAILBOX: 'Connect your email in Settings to send emails.',
    MAILBOX_NEEDS_RECONNECT: 'Your email connection needs renewing in Settings.',
    NO_EMAIL_ADDRESS: 'This contact has no email address on file.',
}


# ── the recipient and the parent ─────────────────────────────────────────────

def _is_lead(parent):
    from bookings.models import Lead
    return isinstance(parent, Lead)


def parent_kwargs(parent):
    """Ledger parent as create() kwargs — a lead, a quote or an event."""
    from bookings.models import Quote
    from events.models import Event
    if isinstance(parent, Quote):
        return {'quote': parent}
    if isinstance(parent, Event):
        return {'event': parent}
    if _is_lead(parent):
        return {'lead': parent}
    raise MessagingError(f'Cannot attach a message to {type(parent).__name__}.')


def recipient_for(parent):
    """The client's email and phone, whichever surface we're sending from.

    Leads keep their contact details on the lead itself; bookings carry a
    Contact. Both are reduced to the same two strings so nothing downstream has
    to care which it was handed.
    """
    if _is_lead(parent):
        return {
            'name': parent.contact_name or '',
            'email': parent.contact_email or '',
            'phone': parent.contact_phone or '',
            'preferred_channel': '',
        }
    contact = parent.primary_contact
    if contact is None:
        return {'name': '', 'email': '', 'phone': '', 'preferred_channel': ''}
    return {
        'name': contact.name or '',
        'email': contact.email or '',
        'phone': contact.phone or '',
        'preferred_channel': contact.preferred_channel or '',
    }


# ── what this org can actually do right now ──────────────────────────────────

def _valid_email(value):
    """The address if it is one, else ''. Never raises."""
    from django.core.exceptions import ValidationError
    from django.core.validators import validate_email
    address = (value or '').strip()
    if not address:
        return ''
    try:
        validate_email(address)
    except ValidationError:
        return ''
    return address


def _email_blocker(org, address):
    """Why email can't be used, or None. Order matters: an org-level problem is
    reported before a record-level one, because it blocks every client."""
    from bookings.models import ConnectedMailbox
    mailbox = email_service.get_mailbox(org)
    if mailbox is None:
        return NO_MAILBOX
    if mailbox.status != ConnectedMailbox.CONNECTED:
        return MAILBOX_NEEDS_RECONNECT
    if not address:
        return NO_EMAIL_ADDRESS
    return None


def channel_availability(org, parent):
    """Which channels can be used, by which mechanism, and why not.

    Returns a dict the send modal renders directly, so the backend stays the one
    place that decides what is possible — the UI never re-derives it.
    """
    state = _messaging_state(org, parent)
    who, org_settings = state['who'], state['org_settings']
    platform = state['platform']

    whatsapp_reason = None
    if not who['phone']:
        whatsapp_reason = NO_PHONE
    # A shortcut send goes out from someone's personal WhatsApp. An org that
    # switched that off means it — it is not a fallback we may quietly use.
    elif not platform and not org_settings.whatsapp_shortcuts_enabled:
        whatsapp_reason = WHATSAPP_DISABLED

    return {
        'email': {
            'available': state['email_reason'] is None,
            'reason': state['email_reason'],
            'address': who['email'],
            'mailbox': getattr(state['mailbox'], 'email_address', '') or '',
        },
        'whatsapp': {
            'available': whatsapp_reason is None,
            'reason': whatsapp_reason,
            'address': who['phone'],
            # 'platform' can send unattended; 'shortcut' always needs a human tap.
            'mechanism': 'platform' if platform else 'shortcut',
            'number': org_settings.twilio_whatsapp_number if platform else '',
        },
        'default_channel': _resolve_from(state),
    }


def _messaging_state(org, parent):
    """Everything the channel decisions need, fetched exactly once.

    The mailbox, the org settings and the contact were each being re-read three
    times per request because the helpers called each other; this gathers them
    so an endpoint that only answers "what can I use" costs one pass.
    """
    from bookings.models import ConnectedMailbox
    org_settings = OrgSettings.for_org(org)
    who = recipient_for(parent)
    mailbox = email_service.get_mailbox(org)

    if mailbox is None:
        email_reason = NO_MAILBOX
    elif mailbox.status != ConnectedMailbox.CONNECTED:
        email_reason = MAILBOX_NEEDS_RECONNECT
    elif not who['email']:
        email_reason = NO_EMAIL_ADDRESS
    else:
        email_reason = None

    return {
        'org_settings': org_settings,
        'who': who,
        'mailbox': mailbox,
        'email_reason': email_reason,
        'platform': whatsapp_service.platform_sending_available(org_settings),
    }


def resolve_channel(org, parent, requested=None):
    """Which channel to use: what was asked for, else contact, else org default.

    A preference for a channel that isn't usable degrades to one that is, rather
    than presenting the rep a preselected dead end.
    """
    if requested:
        return requested
    return _resolve_from(_messaging_state(org, parent))


def _resolve_from(state):
    who, org_settings = state['who'], state['org_settings']
    preference = who['preferred_channel'] or org_settings.default_client_channel
    flags = {
        CHANNEL_EMAIL: state['email_reason'] is None,
        CHANNEL_WHATSAPP: bool(
            who['phone']
            and (state['platform'] or org_settings.whatsapp_shortcuts_enabled)
        ),
    }
    if flags.get(preference):
        return preference
    other = CHANNEL_WHATSAPP if preference == CHANNEL_EMAIL else CHANNEL_EMAIL
    return other if flags.get(other) else preference


# ── links and attachments ────────────────────────────────────────────────────

def booking_public_url(booking):
    """The client-facing sign page for a booking — mints a token if needed."""
    token = booking.ensure_public_token()
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/b/{token}"


def attachment_filename(booking, kind, signed=False):
    """What the attachment will be called — without rendering it.

    Kept separate from the bytes so the draft screen, which only needs to show a
    filename chip, doesn't pay for a full PDF render on every keystroke-triggered
    redraft.
    """
    from bookings.models import Quote
    prefix = 'Quote' if isinstance(booking, Quote) else 'Booking'
    if kind == KIND_SIGNED_COPY and signed:
        return f'{prefix}-{booking.pk}-signed.pdf'
    return f'{prefix}-{booking.pk}.pdf'


def effective_signature(booking):
    """The signature that counts for this booking, or None.

    Canonical on the event, so a quote reads its own signed state through the
    event it produced. Thin wrapper so services don't reach into a views module
    for the rule, and so there is one answer rather than two.
    """
    from bookings.views.public_sign import _effective_signature
    return _effective_signature(booking)


def _booking_pdf(booking, kind, signature=None):
    """(filename, bytes, mimetype) for the document this send carries.

    A signed copy attaches the *frozen* PDF — the exact document the client put
    their name to — never a freshly rendered one, which later edits could have
    changed underneath them. Callers that don't hand us the signature (a rep
    re-sending the signed copy from the booking page) get it looked up, because
    the alternative is mailing a client a document titled "your signed
    confirmation" that carries no signature and reflects every edit since.
    """
    from bookings.models import Quote
    from bookings.pdf import generate_quote_pdf, generate_event_pdf

    if kind == KIND_SIGNED_COPY and signature is None:
        signature = effective_signature(booking)

    is_quote = isinstance(booking, Quote)
    frozen = kind == KIND_SIGNED_COPY and signature is not None and signature.signed_pdf

    if frozen:
        content = bytes(signature.signed_pdf)
    else:
        content = (generate_quote_pdf(booking, signature=signature) if is_quote
                   else generate_event_pdf(booking, signature=signature))
    return (attachment_filename(booking, kind, signed=bool(frozen)),
            content, 'application/pdf')


def compose_attachment_available(parent, channel):
    """Can an ordinary composed message carry a document at all?

    Only over email, and only for a booking: WhatsApp goes out as a link, and a
    lead has no document to send.
    """
    from bookings.models import Lead
    return channel == CHANNEL_EMAIL and not isinstance(parent, Lead)


def compose_attachment(booking):
    """The booking's own PDF for a composed message, or None if it won't render.

    Deliberately swallows a render failure. The rep is emailing their client;
    losing the attachment is a smaller harm than losing the message, and the
    ledger row records what actually went — no attachment filename — rather than
    claiming one that never left.
    """
    from bookings.models import Lead
    if isinstance(booking, Lead):
        return None
    try:
        return _booking_pdf(booking, KIND_COMPOSE)
    except Exception:
        logger.exception(
            'Could not render the PDF for a composed message on %s %s',
            type(booking).__name__, booking.pk,
        )
        return None


# ── the sends ────────────────────────────────────────────────────────────────

def send_client_email(parent, *, subject, body, sent_by=None, attachment=None,
                      to_email=None):
    """Send one email through the org's connected mailbox and ledger it.

    `to_email` overrides the contact's stored address — used when a client signs
    under a different address from the one on their record, so their signed copy
    reaches the person who actually signed.

    Returns the ledger row. A transport failure is recorded as a `failed` row
    and re-raised, so an interactive caller can report it while the ledger keeps
    the evidence either way.
    """
    org = parent.organisation
    who = recipient_for(parent)
    address = _valid_email(to_email or who['email'])
    blocker = _email_blocker(org, address)
    if blocker is not None:
        raise ChannelUnavailable(_EMAIL_BLOCKER_MESSAGES[blocker], reason=blocker)

    msg = WhatsAppMessage.objects.create(
        organisation=org,
        channel=CHANNEL_EMAIL,
        to_email=address,
        subject=subject,
        body=body,
        attachment_filename=attachment[0] if attachment else '',
        direction='outbound',
        status='queued',
        sent_by=sent_by,
        **parent_kwargs(parent),
    )

    try:
        message_id = email_service.send_via_mailbox(
            org,
            to=address,
            subject=subject,
            body=body,
            attachments=[attachment] if attachment else None,
        )
    except email_service.MailboxError as exc:
        msg.status = 'failed'
        msg.error_message = str(exc)[:500]
        msg.save(update_fields=['status', 'error_message', 'updated_at'])
        raise

    msg.provider_message_id = message_id or ''
    msg.status = 'sent'
    msg.save(update_fields=['provider_message_id', 'status', 'updated_at'])
    return msg


def record_whatsapp_handoff(parent, *, body, sent_by=None):
    """Log a shortcut send the caterer is about to make from their own WhatsApp.

    The platform did not send this and cannot confirm it, so the row says
    exactly that (`handed_off`). The caller opens `wa.me` itself.
    """
    org = parent.organisation
    who = recipient_for(parent)
    if not who['phone']:
        raise ChannelUnavailable(
            'This contact has no phone number on file.', reason=NO_PHONE,
        )
    if not OrgSettings.for_org(org).whatsapp_shortcuts_enabled:
        raise ChannelUnavailable(
            'WhatsApp shortcuts are turned off for this organisation.',
            reason=WHATSAPP_DISABLED,
        )

    return WhatsAppMessage.objects.create(
        organisation=org,
        channel=CHANNEL_WHATSAPP,
        to_phone=who['phone'],
        body=body,
        direction='outbound',
        status=WhatsAppMessage.HANDED_OFF,
        sent_by=sent_by,
        **parent_kwargs(parent),
    )


def record_task_row(parent, *, body, reason=''):
    """Write a `to_send` task: something needed sending, only a human can.

    Never counted as a send. It exists so a signed booking whose org has no
    API-capable channel leaves a visible obligation instead of silence.
    """
    who = recipient_for(parent)
    return WhatsAppMessage.objects.create(
        organisation=parent.organisation,
        channel=CHANNEL_WHATSAPP,
        to_phone=who['phone'],
        body=body,
        direction='outbound',
        status=WhatsAppMessage.TO_SEND,
        error_message=reason[:500],
        sent_by=None,
        **parent_kwargs(parent),
    )


def send_booking_link(booking, kind, *, channel=None, sent_by=None,
                      subject=None, body=None, signature=None):
    """Send a client the link to their booking, on the channel that fits.

    `kind` is 'sign_link' or 'signed_copy'. `subject`/`body` override the
    deterministic template — that is how an edited AI draft is sent, and why the
    ledger records what the rep actually approved rather than what we proposed.
    """
    org = booking.organisation
    channel = channel or resolve_channel(org, booking)
    url = booking_public_url(booking)
    rendered = render_client_message(booking, kind, channel, url=url)
    final_subject = subject if subject is not None else rendered['subject']
    final_body = body if body is not None else rendered['body']

    if channel == CHANNEL_EMAIL:
        msg = send_client_email(
            booking,
            subject=final_subject,
            body=final_body,
            sent_by=sent_by,
            attachment=_booking_pdf(booking, kind, signature=signature),
        )
        _mark_quote_sent(booking, kind, msg)
        return msg

    if channel != CHANNEL_WHATSAPP:
        raise ChannelUnavailable(f'Unknown channel {channel!r}.', reason=UNKNOWN_CHANNEL)

    who = recipient_for(booking)
    if not who['phone']:
        raise ChannelUnavailable(
            'This contact has no phone number on file.', reason=NO_PHONE,
        )

    org_settings = OrgSettings.for_org(org)
    if whatsapp_service.platform_sending_available(org_settings):
        msg = whatsapp_service.send_via_twilio(
            org,
            to_phone=who['phone'],
            body=final_body,
            parent=parent_kwargs(booking),
            sent_by=sent_by,
        )
    else:
        # Shortcut mechanism: the caller opens wa.me; we only record the handoff.
        msg = record_whatsapp_handoff(booking, body=final_body, sent_by=sent_by)
    _mark_quote_sent(booking, kind, msg)
    return msg


def _mark_quote_sent(booking, kind, msg):
    """A draft quote the client has now been sent is no longer a draft.

    Lives here rather than in one view because every caller that sends a sign
    link means the same thing by it — including the agents that will send
    through this service without going near an HTTP endpoint. A send that
    failed changes nothing; a handoff still counts, because the caterer has the
    message in their hand.
    """
    from bookings.models import Quote
    from bookings.models.quotes import QuoteStatus

    if kind != KIND_SIGN_LINK or not isinstance(booking, Quote):
        return
    if msg.status == 'failed' or booking.status != QuoteStatus.DRAFT:
        return
    try:
        booking.transition_to(QuoteStatus.SENT)
    except ValueError:
        # An invalid transition is the quote's business, not the message's.
        logger.info('Quote %s could not move to sent after a client send.', booking.pk)


# ── automatic: the signed copy (AC5/AC6) ─────────────────────────────────────

def send_signed_copy(booking, signature):
    """After a client signs, get them their signed copy — without ever blocking.

    Runs on every API-capable channel the org has. Nothing here may raise: this
    is called from inside signing, and a messaging problem must never cost a
    client their signature. Every outcome, including total failure, leaves a row.
    """
    org = booking.organisation
    org_settings = OrgSettings.for_org(org)
    who = recipient_for(booking)
    sent = []

    url = booking_public_url(booking)
    rendered = render_client_message(booking, KIND_SIGNED_COPY, CHANNEL_EMAIL, url=url)

    # Where the signed copy goes is NOT a free choice for whoever opened the
    # link. The sign page is unauthenticated and its token gets forwarded, so an
    # arbitrary `signer_email` would let anyone holding a link make the
    # caterer's own mailbox send a booking document wherever they liked. The
    # contact on record wins; the signer's address is only used when we have no
    # other, and only when it is actually an address.
    email_address = who['email'] or _valid_email(
        getattr(signature, 'signer_email', ''),
    )

    if email_service.mailbox_is_usable(org) and email_address:
        try:
            sent.append(send_client_email(
                booking,
                subject=rendered['subject'],
                body=rendered['body'],
                sent_by=None,
                to_email=email_address,
                attachment=_booking_pdf(booking, KIND_SIGNED_COPY, signature=signature),
            ))
        except Exception as exc:
            # send_client_email already wrote the `failed` row before raising.
            logger.warning('Signed-copy email failed for booking %s: %s', booking.pk, exc)

    wa_rendered = render_client_message(
        booking, KIND_SIGNED_COPY, CHANNEL_WHATSAPP, url=url,
    )
    if who['phone'] and whatsapp_service.platform_sending_available(org_settings):
        try:
            sent.append(whatsapp_service.send_via_twilio(
                org,
                to_phone=who['phone'],
                body=wa_rendered['body'],
                parent=parent_kwargs(booking),
                sent_by=None,
            ))
        except Exception as exc:
            logger.warning('Signed-copy WhatsApp failed for booking %s: %s', booking.pk, exc)

    if sent:
        return sent

    # Nothing could be sent unattended. Say so honestly, and leave a task if a
    # human could still do it by hand.
    try:
        if who['phone'] and org_settings.whatsapp_shortcuts_enabled:
            return [record_task_row(
                booking,
                body=wa_rendered['body'],
                reason='WhatsApp cannot send unattended without a business number.',
            )]
        return [_record_undeliverable(booking, rendered, email_address)]
    except Exception as exc:
        # Absolute last resort: signing must survive even a broken ledger write.
        logger.exception('Could not record signed-copy outcome for %s: %s', booking.pk, exc)
        return []


def _record_undeliverable(booking, rendered, email_address):
    """No channel at all — record the failure rather than staying silent."""
    reason = ('No connected mailbox — signing succeeded, send did not.'
              if not email_service.mailbox_is_usable(booking.organisation)
              else 'No usable channel for this client.')
    return WhatsAppMessage.objects.create(
        organisation=booking.organisation,
        channel=CHANNEL_EMAIL,
        to_email=email_address,
        subject=rendered['subject'],
        body=rendered['body'],
        direction='outbound',
        status='failed',
        error_message=reason,
        sent_by=None,
        **parent_kwargs(booking),
    )
