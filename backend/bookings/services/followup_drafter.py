"""AI drafting for lead follow-ups.

Given a stale lead, ask an LLM to either draft a concise follow-up — by email or
by WhatsApp, whichever the lead can actually be reached on — or decide the lead
should be left alone. The model never sends anything: it only produces a draft a
human reviews.

Which model (and supplier) does the drafting is configured by the
LLM_FOLLOWUP_DRAFTER setting — see portioning/llm.py. Drafting one short
message is a cheap-and-fast-tier job on any provider.
"""
import logging
import re

from django.contrib.contenttypes.models import ContentType

from bookings.models import ActivityLog, WhatsAppMessage
from bookings.services.greeting import GREETING_RULE
from bookings.services.message_templates import format_event_date, org_country
from portioning import llm
from users.country_defaults import language_rule_for_org

logger = logging.getLogger(__name__)

MODEL_SETTING = 'LLM_FOLLOWUP_DRAFTER'

CHANNEL_EMAIL = WhatsAppMessage.CHANNEL_EMAIL
CHANNEL_WHATSAPP = WhatsAppMessage.CHANNEL_WHATSAPP

SYSTEM_PROMPT = (
    "You are a sales assistant for a catering company. Your job is to draft a "
    "short, courteous follow-up to a lead who has gone quiet, so a human "
    "can review and send it.\n\n"
    "Rules:\n"
    "- Formal, professional tone — polite and warm, never chatty. No emoji.\n"
    # One rule for every drafter — see bookings/services/greeting.py. The text is
    # unchanged from what this file used to spell out inline, so what leads
    # receive is exactly what they received before.
    f"{GREETING_RULE}"
    "- If a detail (event type, guest count, date, etc.) appears in both a "
    "structured field and a note, and they conflict or the note is more "
    "specific, use the note's version — don't state both or repeat the same "
    "detail twice. Only fall back to the field's version when there's no note "
    "covering that detail.\n"
    "- The lead's record (budget, pipeline status, internal notes, activity log) "
    "is background for YOUR judgment only — never quote it back to the customer. "
    "Never mention their budget or any money figure, internal status words, or "
    "note text. Only reference things the customer themselves would recognise: "
    "their event, its date, the occasion, their guest numbers.\n"
    "- Reference the specific details you were given (date, guest count) when they "
    "help; never invent details you weren't given.\n"
    "- Apologise for a delayed reply ONLY when the lead sent us a message that "
    "went unanswered (you will see it in the recent messages). If "
    "we have never messaged them before, or the last message was ours, do NOT "
    "apologise. First contact on an older lead should be warm and get "
    "straight to the point.\n"
    "- Use plain punctuation. Never use long dashes (the \u2014 or \u2013 "
    "characters); use a comma or start a new sentence instead. The greeting "
    "line ends with exactly one comma and nothing else (e.g. 'Hello Usman,').\n"
    "- End with ONE clear call to action — the single most useful next step. If "
    "details you need are missing (event date, guest count, venue), ask for them "
    "specifically. If you have enough, propose the concrete next step (e.g. "
    "sharing menu options and a quote). Never end on a vague 'let us know if you "
    "need anything'.\n"
    "- Sign off once at the end as the business's team using the business name "
    "you were given (e.g. 'The Honey Flash Booth team') — never as a named "
    "person, and don't repeat the business name elsewhere in the message.\n"
    "- If following up would be inappropriate (the lead just replied, is waiting "
    "on us, explicitly asked for space, or there is nothing useful to say), set "
    "should_follow_up to false and leave message empty.\n"
    "- Always give a one-sentence reasoning for your decision."
)

# What changes between the two channels. A WhatsApp follow-up is a message on
# someone's phone and a five-paragraph email would be absurd there; an email
# with no subject and no sign-off looks like spam. Same facts, different form.
CHANNEL_RULES = {
    CHANNEL_WHATSAPP: (
        "\n- You are writing a WhatsApp message. Keep it to 2-4 short sentences "
        "after the greeting. There is no subject line.\n"
    ),
    CHANNEL_EMAIL: (
        "\n- You are writing an EMAIL. Also give a subject line: short and "
        "specific, naming the occasion or the event (e.g. 'Your wedding "
        "catering on March 14'), never marketing language, never 'Follow-up' "
        "on its own.\n"
        "- Keep the body to 2-4 short paragraphs after the greeting — a little "
        "more room than a text message, but still brief.\n"
    ),
}


def build_system_prompt(org, channel):
    """The system prompt for this org and channel.

    Two things vary and both come from data, never from a hardcoded default:
    the channel's register, and which English the org's market writes in.
    """
    return (
        SYSTEM_PROMPT
        + CHANNEL_RULES.get(channel, CHANNEL_RULES[CHANNEL_WHATSAPP])
        + language_rule_for_org(org)
    )


# Validated structure the model must return. Email additionally returns a
# subject; WhatsApp does not, so its schema is unchanged from before email
# existed and its drafts come back exactly as they always did.
DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "should_follow_up": {"type": "boolean"},
        "message": {"type": "string"},
        "reasoning": {"type": "string"},
    },
    "required": ["should_follow_up", "message", "reasoning"],
    "additionalProperties": False,
}

EMAIL_DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "should_follow_up": {"type": "boolean"},
        "subject": {"type": "string"},
        "message": {"type": "string"},
        "reasoning": {"type": "string"},
    },
    "required": ["should_follow_up", "subject", "message", "reasoning"],
    "additionalProperties": False,
}


def _event_label(lead):
    """The org's configured human label for the lead's event type.

    (e.g. 'Mehndi / Mayoon / Qawali Night') rather than the raw stored value —
    the org's Event Type list IS the occasion vocabulary: one field, one term.
    """
    from bookings.models.choices import EventTypeOption
    if not lead.event_type:
        return lead.event_type
    opt = EventTypeOption.objects.filter(
        organisation=lead.organisation, value=lead.event_type,
    ).first()
    return opt.label if opt else lead.event_type


def _build_context(lead, channel=CHANNEL_WHATSAPP):
    """Assemble the lead's details, recent activity, and recent message thread."""
    lines = [
        f"Our business name: {lead.organisation.name}",
        f"Contact name: {lead.contact_name}",
        f"Event type: {_event_label(lead)}",
        f"Channel: {'email' if channel == CHANNEL_EMAIL else 'WhatsApp'}",
    ]
    if lead.contact_title:
        lines.insert(0, f"Contact title: {lead.contact_title}")
    if lead.contact_first_name:
        lines.insert(1, f"Contact first name: {lead.contact_first_name}")
    if lead.contact_last_name:
        lines.insert(2, f"Contact surname: {lead.contact_last_name}")
    if lead.event_date:
        # Written out in the org's own order, never ISO: the model copies what
        # it is given, and a date in the wrong order can be read as a different
        # day entirely (REL-501).
        lines.append(
            f"Event date: {format_event_date(lead.event_date, org_country(lead))}"
        )
    if lead.guest_estimate:
        lines.append(f"Guest estimate: {lead.guest_estimate}")
    if lead.notes:
        lines.append(f"Notes: {lead.notes}")

    ct = ContentType.objects.get_for_model(lead)
    recent_activity = (
        ActivityLog.objects.filter(content_type=ct, object_id=lead.pk)
        .order_by('-created_at')[:8]
    )
    if recent_activity:
        lines.append("\nRecent activity (newest first):")
        for entry in recent_activity:
            lines.append(f"- {entry.created_at:%Y-%m-%d}: {entry.description or entry.action}")

    # Quotations tied to this lead — stated as facts so the model never has
    # to guess. The sent/not-sent distinction matters: a draft quote is
    # internal and the customer has NOT seen it.
    quotes = lead.quotes.order_by('-created_at')[:3]
    if quotes:
        lines.append("\nQuotations for this lead:")
        for q in quotes:
            if q.status == 'sent':
                lines.append(
                    f"- A quotation WAS SENT to the lead (on {q.updated_at:%Y-%m-%d})."
                )
            elif q.status in ('accepted', 'declined'):
                lines.append(f"- A quotation was sent and the lead {q.status} it.")
            else:
                lines.append(
                    "- A quotation has been drafted internally but NOT sent — "
                    "the lead has not seen it; do not refer to it."
                )

    # The authoritative follow-up ledger — the model must base "how many times
    # have we nudged them" on THIS, never on counting messages in the thread.
    sent = lead.followup_drafts.filter(status='sent').order_by('-reviewed_at')
    sent_count = sent.count()
    lines.append(f"\nFollow-ups already sent to this lead: {sent_count}")
    if sent_count:
        lines.append(f"Most recent follow-up sent: {sent[0].reviewed_at:%Y-%m-%d}")
    last_reply = (
        WhatsAppMessage.objects.filter(lead=lead, direction='inbound')
        .order_by('-created_at').first()
    )
    if last_reply:
        lines.append(f"Most recent reply from the lead: {last_reply.created_at:%Y-%m-%d}")
    else:
        lines.append("The lead has never replied to us.")

    # The ledger carries email as well as WhatsApp, so the thread is named for
    # what it is rather than for one of the channels in it.
    recent_messages = (
        WhatsAppMessage.objects.filter(lead=lead).order_by('-created_at')[:6]
    )
    if recent_messages:
        lines.append("\nRecent messages with this lead (newest first):")
        for msg in recent_messages:
            who = 'Us' if msg.direction == 'outbound' else 'Lead'
            lines.append(f"- {who} ({msg.get_channel_display()}): {msg.body}")

    return "\n".join(lines)


def draft_followup(lead, channel=CHANNEL_WHATSAPP):
    """Ask the configured LLM to draft a follow-up for a lead, on one channel.

    Returns a dict {should_follow_up, message, subject, reasoning, model_used},
    or None if the model declined or the call failed. `subject` is always
    present and is empty for WhatsApp, so callers never have to branch on
    channel just to read the result.
    """
    is_email = channel == CHANNEL_EMAIL
    context = _build_context(lead, channel)
    instruction = (
        "Draft an email follow-up for this lead, or decide to skip it."
        if is_email else
        "Draft a WhatsApp follow-up for this lead, or decide to skip it."
    )
    try:
        data, model_used = llm.complete_structured(
            MODEL_SETTING,
            build_system_prompt(lead.organisation, channel),
            instruction + "\n\n" + context,
            EMAIL_DRAFT_SCHEMA if is_email else DRAFT_SCHEMA,
        )
    except Exception as exc:
        logger.exception("Follow-up draft failed for lead %s: %s", lead.pk, exc)
        return None

    # Belt-and-braces on top of the prompt rule: long dashes never survive.
    if data.get("message"):
        data["message"] = re.sub(r"\s*\u2014\s*", ", ", data["message"])
    # An email whose subject the model dropped still has to be sendable \u2014 a
    # blank subject line is worse than a plain one (AC5).
    subject = (data.get("subject") or '').strip() if is_email else ''
    data["subject"] = subject or (fallback_subject(lead) if is_email else '')
    data["model_used"] = model_used
    return data


def fallback_subject(lead):
    """A plain, honest subject when we have no drafted one.

    Shared with the send path, which needs it when a draft written for WhatsApp
    (no subject) is switched to email at send time.
    """
    business = lead.organisation.name if lead.organisation_id else ''
    event = _event_label(lead)
    if event:
        return f"Your {event} catering"
    return f"Catering with {business}" if business else "Your catering"
