"""Phone number normalization to E.164 (+923001269792).

One rule, applied on save (Lead, Contact, the org's WhatsApp sender) and by
the backfill migration: a number that declares its country (starts with + or
00) keeps it; a domestic-format number (leading 0, or a bare national number)
gets the org's dial code; anything unintelligible is left untouched so junk
fails visibly at send time instead of being silently mangled.
"""
import re

# Org country (ISO 3166-1 alpha-2) -> dial code. Extend as orgs onboard.
DIAL_CODES = {
    'US': '1', 'CA': '1', 'GB': '44', 'PK': '92', 'AE': '971',
    'IN': '91', 'SA': '966', 'AU': '61',
}


def normalize_phone(raw, country=''):
    """Best-effort E.164. Returns `raw` unchanged when not intelligible."""
    if not raw:
        return raw
    cleaned = re.sub(r'[\s\-().]', '', raw.strip())
    if cleaned.startswith('00'):
        cleaned = '+' + cleaned[2:]
    if cleaned.startswith('+'):
        digits = cleaned[1:]
        if digits.isdigit() and 7 <= len(digits) <= 15:
            return '+' + digits
        return raw
    if not cleaned.isdigit():
        return raw
    code = DIAL_CODES.get((country or '').upper())
    if not code:
        return raw
    if cleaned.startswith('0') and len(cleaned) >= 9:
        candidate = code + cleaned.lstrip('0')
    elif not cleaned.startswith('0') and 7 <= len(cleaned) <= 12:
        candidate = code + cleaned
    else:
        return raw
    if 8 <= len(candidate) <= 15:
        return '+' + candidate
    return raw
