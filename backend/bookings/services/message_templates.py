"""Deterministic client-message wording.

This is the wording that goes out when no human will read it first — the
signed-copy email a client gets the moment they sign (REL-445 AC5) — and the
prefill the send modal falls back to when AI drafting is unavailable (AC3c).

It is deliberately plain and never generated: an automatic send has no reviewer,
so the model proposes nothing here. The AI drafter (``message_drafter.py``)
covers the case a human is about to read and edit.
"""
from bookings.services.messaging_kinds import KIND_SIGN_LINK, KIND_SIGNED_COPY, KIND_COMPOSE

CHANNEL_EMAIL = 'email'


def format_event_date(value):
    """'14 March 2026' from a date — or from the string one that hasn't been
    round-tripped through the database yet.

    A model instance created in memory still holds whatever was assigned to it,
    so a freshly built booking can carry `event_date` as a string. Formatting
    that with a date format specifier raises, and a message must never fail to
    render over the shape of a date.
    """
    if not value:
        return ''
    if isinstance(value, str):
        from django.utils.dateparse import parse_date
        parsed = parse_date(value)
        if parsed is None:
            return value
        value = parsed
    return f'{value:%d %B %Y}'


def _first_name(full_name):
    return (full_name or '').strip().split(' ')[0] if full_name else ''


def _greeting(name):
    first = _first_name(name)
    return f'Hello {first},' if first else 'Hello,'


def _event_phrase(booking):
    """'your event on 14 March 2026' — with whatever parts we actually have."""
    label = ''
    event_type = getattr(booking, 'event_type', '') or ''
    if event_type:
        from bookings.models.choices import EventTypeOption
        option = EventTypeOption.objects.filter(
            organisation=booking.organisation, value=event_type,
        ).first()
        label = (option.label if option else event_type).lower()

    subject = f'your {label}' if label else 'your event'
    date = format_event_date(getattr(booking, 'event_date', None))
    return f'{subject} on {date}' if date else subject


def _reference(booking):
    """Q-12 / E-12 — or nothing at all for a lead, which has no booking to cite."""
    from bookings.models import Lead, Quote
    if isinstance(booking, Lead):
        return ''
    return f'Q-{booking.pk}' if isinstance(booking, Quote) else f'E-{booking.pk}'


def render_client_message(booking, kind, channel, *, url=''):
    """Return {'subject', 'body'} for one deterministic client message.

    WhatsApp bodies stay short — they double as the `wa.me` prefill, which the
    caterer sees in their own app before sending. Subjects are email-only but
    are always returned, so a caller never has to branch on channel to read the
    result.
    """
    org_name = booking.organisation.name
    who = _recipient_name(booking)
    event_phrase = _event_phrase(booking)
    reference = _reference(booking)
    is_email = channel == CHANNEL_EMAIL

    if kind == KIND_SIGNED_COPY:
        subject = f'Your signed booking confirmation ({reference})'
        if is_email:
            body = (
                f'{_greeting(who)}\n\n'
                f'Thank you for confirming {event_phrase}. Your signed booking '
                f'confirmation is attached for your records.\n\n'
                f'You can also view it here:\n{url}\n\n'
                f'We look forward to it.\n\n'
                f'{org_name}'
            )
        else:
            body = (
                f'{_greeting(who)} thank you for confirming {event_phrase}. '
                f'Your signed booking confirmation is here: {url}\n\n{org_name}'
            )
        return {'subject': subject, 'body': body}

    if kind == KIND_SIGN_LINK:
        subject = f'Your booking from {org_name} ({reference})'
        if is_email:
            body = (
                f'{_greeting(who)}\n\n'
                f'Please find your booking for {event_phrase} attached.\n\n'
                f'When you are happy with it, you can review and sign it here:\n{url}\n\n'
                f'Do let us know if you would like anything changed.\n\n'
                f'{org_name}'
            )
        else:
            body = (
                f'{_greeting(who)} here is your booking for {event_phrase}. '
                f'You can review and sign it here: {url}\n\n{org_name}'
            )
        return {'subject': subject, 'body': body}

    if kind == KIND_COMPOSE:
        # Compose starts nearly empty on purpose — a template the rep has to
        # delete is worse than a blank page.
        return {
            'subject': f'{org_name}, {event_phrase}',
            'body': f'{_greeting(who)}\n\n',
        }

    raise ValueError(f'Unknown message kind {kind!r}.')


def _recipient_name(booking):
    contact = getattr(booking, 'primary_contact', None)
    if contact is not None:
        return contact.first_name or contact.name or ''
    return getattr(booking, 'contact_first_name', '') or getattr(booking, 'contact_name', '') or ''
