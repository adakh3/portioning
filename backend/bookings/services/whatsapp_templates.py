TEMPLATES = {
    'reminder': (
        'Hi {contact_name}, this is a friendly reminder about your upcoming '
        '{event_type} on {event_date}. Please let us know if you have any questions!'
    ),
    'follow_up': (
        'Hi {contact_name}, thank you for your interest in our catering services. '
        'We wanted to follow up on your enquiry for {event_type}. '
        'Would you like to discuss your requirements?'
    ),
}


def render_template(template_key: str, context: dict) -> str:
    """Render a named template with the given context dict.

    Unknown placeholders are left as-is rather than raising.
    """
    template = TEMPLATES.get(template_key, '')
    if not template:
        return ''
    try:
        return template.format_map({**context, **_SafeDict()})
    except (KeyError, IndexError):
        return template


class _SafeDict(dict):
    """Return the placeholder itself for missing keys."""
    def __missing__(self, key):
        return '{' + key + '}'
