"""AI drafting for lead follow-ups.

Given a stale lead, ask an LLM to either draft a concise WhatsApp follow-up or
decide the lead should be left alone. The model never sends anything — it only
produces a draft a human reviews.

Which model (and supplier) does the drafting is configured by the
LLM_FOLLOWUP_DRAFTER setting — see portioning/llm.py. Drafting one short
message is a cheap-and-fast-tier job on any provider.
"""
import logging

from django.contrib.contenttypes.models import ContentType

from bookings.models import ActivityLog, WhatsAppMessage
from portioning import llm

logger = logging.getLogger(__name__)

MODEL_SETTING = 'LLM_FOLLOWUP_DRAFTER'

SYSTEM_PROMPT = (
    "You are a sales assistant for a catering company. Your job is to draft a "
    "short, friendly WhatsApp follow-up to a lead who has gone quiet, so a human "
    "can review and send it.\n\n"
    "Rules:\n"
    "- Keep it to 2-3 sentences, warm and conversational, no emoji spam.\n"
    "- Reference the specific event details you were given (type, date, guests) "
    "when they help; never invent details you weren't given.\n"
    "- Open by name. Sign off as the catering team, not a named person.\n"
    "- If following up would be inappropriate (the lead just replied, is waiting "
    "on us, explicitly asked for space, or there is nothing useful to say), set "
    "should_follow_up to false and leave message empty.\n"
    "- Always give a one-sentence reasoning for your decision."
)

# Validated structure the model must return.
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


def _build_context(lead):
    """Assemble the lead's details, recent activity, and recent WhatsApp thread."""
    lines = [
        f"Contact name: {lead.contact_name}",
        f"Current pipeline status: {lead.status}",
        f"Event type: {lead.event_type}",
    ]
    if lead.event_date:
        lines.append(f"Event date: {lead.event_date.isoformat()}")
    if lead.guest_estimate:
        lines.append(f"Guest estimate: {lead.guest_estimate}")
    if lead.budget:
        lines.append(f"Budget: {lead.budget}")
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

    recent_messages = (
        WhatsAppMessage.objects.filter(lead=lead).order_by('-created_at')[:6]
    )
    if recent_messages:
        lines.append("\nRecent WhatsApp messages (newest first):")
        for msg in recent_messages:
            who = 'Us' if msg.direction == 'outbound' else 'Lead'
            lines.append(f"- {who}: {msg.body}")

    return "\n".join(lines)


def draft_followup(lead):
    """Ask the configured LLM to draft a follow-up for a lead.

    Returns a dict {should_follow_up, message, reasoning, model_used}, or None
    if the model declined or the call failed.
    """
    context = _build_context(lead)
    try:
        data, model_used = llm.complete_structured(
            MODEL_SETTING,
            SYSTEM_PROMPT,
            "Draft a WhatsApp follow-up for this lead, or decide to skip it.\n\n" + context,
            DRAFT_SCHEMA,
        )
    except Exception as exc:
        logger.exception("Follow-up draft failed for lead %s: %s", lead.pk, exc)
        return None

    data["model_used"] = model_used
    return data
