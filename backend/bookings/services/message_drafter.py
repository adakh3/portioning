"""AI drafting for client messages a human is about to send.

The rep clicks "Send to client", this writes the first draft from the booking's
real details, and the rep edits and sends it. The model never sends anything and
never picks a recipient — it proposes wording, a person disposes.

Drafting failure is not a send failure: every path here degrades to the
deterministic template in ``message_templates.py`` rather than raising, so a
model outage can never stop a caterer emailing their client.
"""
import logging
import re

from bookings.services.greeting import GREETING_RULE, greeting_context_lines
from bookings.services.message_templates import format_event_date, render_client_message
from bookings.services.messaging_kinds import KIND_COMPOSE, KIND_SIGN_LINK, KIND_SIGNED_COPY
from portioning import llm

logger = logging.getLogger(__name__)

MODEL_SETTING = 'LLM_CLIENT_MESSAGE_DRAFTER'

SYSTEM_PROMPT = (
    "You draft client-facing messages for a catering company. A member of staff "
    "will read, edit and send what you write — you are producing a first draft, "
    "not sending anything.\n\n"
    "Rules:\n"
    "- Warm and professional. No emoji, no exclamation marks, no sales language.\n"
    f"{GREETING_RULE}"
    "- Write about what the client already knows: their event, its date, the "
    "guest count, the menu, the total. Never mention internal information — "
    "costs, margins, staffing, internal notes or pipeline status.\n"
    "- Never invent a detail you were not given. If the guest count or date is "
    "absent, write around it rather than guessing. In particular: never refer "
    "to a menu, a document, or a conversation unless the context names one.\n"
    "- Match the stage. A quote that has not been signed is a PROPOSAL: invite "
    "them to review and sign. A signed or confirmed booking is a CONFIRMATION: "
    "thank them and restate what is booked. Never ask a client who has already "
    "signed to sign again.\n"
    "- If you are told a document is attached, refer to it once, naturally.\n"
    "- If you are given a link, include it exactly as given, on its own line. "
    "Never alter, shorten or invent a URL.\n"
    "- Use plain punctuation. Never use long dashes (the — or – "
    "characters); use a comma or a new sentence.\n"
    "- Sign off once, on the last line, with the business name alone.\n"
    "- For WhatsApp, keep the whole message under 60 words and put the link on "
    "its own line. For email, 3 to 5 short paragraphs.\n"
    "- The subject line is for email only: short, specific, no marketing tone. "
    "Always provide one even for WhatsApp; it will be ignored."
)

DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "subject": {"type": "string"},
        "body": {"type": "string"},
    },
    "required": ["subject", "body"],
    "additionalProperties": False,
}

_STAGE_NOTE = {
    KIND_SIGN_LINK: (
        'Stage: the client is being sent this booking to review and sign. It is '
        'a proposal; they have not agreed to it yet.'
    ),
    KIND_SIGNED_COPY: (
        'Stage: the client has already signed. This is their confirmation and '
        'their signed copy. Do not ask them to sign anything.'
    ),
    KIND_COMPOSE: (
        # Says nothing about attachments: a composed message may now carry the
        # booking PDF (REL-478), and the attachment line below is the one place
        # that decides. Two sources would eventually disagree.
        'Stage: an ordinary message about this booking. There is nothing to '
        'sign; keep it brief and useful.'
    ),
}


def is_available():
    """True when a model is configured and its provider key is set."""
    return llm.is_configured(MODEL_SETTING)


def build_context(booking, kind, channel, *, url='', attachment_name=''):
    """The facts the model is allowed to write from.

    Deliberately assembled by hand rather than dumping the booking: everything
    here is something the client already knows or is about to be shown. This is
    the function tests assert on — the prose is not worth pinning, the inputs are.
    """
    from bookings.models import Lead
    from bookings.services.presentation import booking_presentation

    if isinstance(booking, Lead):
        return _lead_context(booking, kind, channel, url=url)

    data = booking_presentation(booking)
    lines = [
        f"Our business name: {data['business_name']}",
        f"Channel: {'email' if channel == 'email' else 'WhatsApp'}",
        _STAGE_NOTE.get(kind, _STAGE_NOTE[KIND_COMPOSE]),
    ]

    contact = getattr(booking, 'primary_contact', None)
    account = getattr(contact, 'account', None) if contact else None
    lines.extend(greeting_context_lines(
        name=data.get('customer_name') or '',
        title=getattr(contact, 'title', '') if contact else '',
        first_name=getattr(contact, 'first_name', '') if contact else '',
        last_name=getattr(contact, 'last_name', '') if contact else '',
        account_name=getattr(account, 'name', '') if account else '',
    ))

    for label, key in (
        ('Event type', 'event_type_label'),
        ('Venue', 'venue_name'),
        ('Service style', 'service_style_label'),
        ('Meal type', 'meal_type_label'),
    ):
        if data.get(key):
            lines.append(f"{label}: {data[key]}")

    # Written out, never ISO: the model copies what it is given, and
    # "2027-03-14" in a message to a client reads like a database leak.
    event_date = format_event_date(data.get('event_date'))
    if event_date:
        lines.append(f"Event date: {event_date}")

    if data.get('guest_count'):
        lines.append(f"Guest count: {data['guest_count']}")

    # Silence invites invention. A booking with no menu chosen yet must SAY so,
    # or the model fills the gap with "the menu details we discussed".
    menu = _menu_summary(data)
    lines.append(
        f"Menu: {menu}" if menu
        else "No menu has been chosen yet. Do not mention or imply a menu."
    )

    if data.get('total') is not None:
        # "agreed" is only true once they have signed; on a proposal it puts a
        # word in the client's mouth.
        label = 'Total price already agreed' if kind == KIND_SIGNED_COPY else 'Total price quoted'
        lines.append(f"{label}: {data.get('currency_symbol', '')}{data['total']}")

    if attachment_name:
        lines.append(f"Attached to this message: {attachment_name}")
    else:
        lines.append(
            "NOTHING is attached to this message. Do not write 'attached', "
            "'enclosed', or refer to any document travelling with it."
        )

    if url:
        lines.append(f"Link to include exactly as written: {url}")

    return "\n".join(lines)


def _lead_context(lead, kind, channel, *, url=''):
    """A lead has an enquiry, not a booking — far fewer facts, same discipline.

    Nothing from the lead's internal record (budget, pipeline status, notes)
    reaches the model here: those are things the client never said to us in
    those words, and a draft must not echo them back.
    """
    lines = [
        f"Our business name: {lead.organisation.name}",
        f"Channel: {'email' if channel == 'email' else 'WhatsApp'}",
        _STAGE_NOTE.get(kind, _STAGE_NOTE[KIND_COMPOSE]),
        "This is an enquiry, not a confirmed booking. Nothing has been agreed.",
    ]
    lines.extend(greeting_context_lines(
        name=lead.contact_name,
        title=lead.contact_title,
        first_name=lead.contact_first_name,
        last_name=lead.contact_last_name,
        account_name=getattr(lead.account, 'name', '') if lead.account_id else '',
    ))
    if lead.event_type:
        lines.append(f"Event type: {lead.event_type}")
    event_date = format_event_date(lead.event_date)
    if event_date:
        lines.append(f"Event date: {event_date}")
    if lead.guest_estimate:
        lines.append(f"Guest estimate: {lead.guest_estimate}")
    lines.append("Nothing is attached to this message.")
    if url:
        lines.append(f"Link to include exactly as written: {url}")
    return "\n".join(lines)


def _menu_summary(data):
    """A short, client-facing list of dish names — never the full menu dump."""
    names = []
    for course in (data.get('menu_courses') or []):
        names.extend(str(item) for item in course.get('items', []) if item)
    if not names:
        names = [str(item) for item in (data.get('menu_flat') or []) if item]
    if not names:
        return ''
    shown = names[:8]
    summary = ', '.join(shown)
    if len(names) > len(shown):
        summary += f", and {len(names) - len(shown)} more"
    return summary


def draft_client_message(booking, kind, channel, *, url='', attachment_name=''):
    """Draft a message, or fall back to the standard template.

    Always returns ``{'subject', 'body', 'used_fallback', 'model_used'}`` —
    there is no failure mode the caller has to handle, because a caterer who
    cannot draft can still send.
    """
    fallback = render_client_message(booking, kind, channel, url=url)
    fallback_result = {
        'subject': fallback['subject'],
        'body': fallback['body'],
        'used_fallback': True,
        'model_used': '',
    }

    if not is_available():
        return fallback_result

    context = build_context(
        booking, kind, channel, url=url, attachment_name=attachment_name,
    )
    try:
        data, model_used = llm.complete_structured(
            MODEL_SETTING,
            SYSTEM_PROMPT,
            'Draft this client message.\n\n' + context,
            DRAFT_SCHEMA,
        )
    except Exception as exc:
        logger.warning('Client-message draft failed for booking %s: %s', booking.pk, exc)
        return fallback_result

    body = _clean(data.get('body') or '')
    subject = _clean(data.get('subject') or '').strip()
    if not body:
        return fallback_result

    # A model that dropped or mangled the link would send the client somewhere
    # that doesn't exist. Restore it rather than trusting the prose.
    if url and url not in body:
        body = f'{body}\n\n{url}'

    return {
        'subject': subject or fallback['subject'],
        'body': body,
        'used_fallback': False,
        'model_used': model_used,
    }


def _clean(text):
    """Belt-and-braces on the prompt rule: long dashes never survive."""
    return re.sub(r'\s*[—–]\s*', ', ', text)
