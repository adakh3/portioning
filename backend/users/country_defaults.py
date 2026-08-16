"""Sensible OrgSettings defaults derived from an organisation's country.

A new org's currency, tax label/rate, timezone and date format should match its
market — not the app's old hardcoded UK (£/GBP/VAT) defaults. This maps a handful
of countries to appropriate defaults, with a **USD generic fallback** for anything
unmapped. Values are only *defaults* at creation time — the owner can change them
in Settings afterwards.

Tax rates are intentionally conservative (often 0) because catering tax is
destination-based and set per-event by the caterer; this is just the starting
label/rate.

`price_rounding_step` is currency-shaped, not universal: rounding to the nearest
50 makes sense for rupees, and none at all for a $38/head US booking — where a
step of 50 rounds anything under $25 down to ZERO. It follows the currency here
rather than the model's single global default.
"""
from decimal import Decimal

# country ISO alpha-2 -> OrgSettings field defaults
COUNTRY_DEFAULTS = {
    'US': {
        'currency_symbol': '$', 'currency_code': 'USD',
        'tax_label': 'Sales Tax', 'default_tax_rate': Decimal('0.0000'),
        'timezone': 'America/New_York', 'date_format': 'MM/DD/YYYY',
        'time_format': '12h', 'service_charge_default_pct': Decimal('20.00'),
        'price_rounding_step': 1,
        # US caterers send documents by email; everywhere else we start on
        # WhatsApp (the model default), which is why only this entry sets it.
        'default_client_channel': 'email',
    },
    'GB': {
        'currency_symbol': '£', 'currency_code': 'GBP',
        'tax_label': 'VAT', 'default_tax_rate': Decimal('0.2000'),
        'timezone': 'Europe/London', 'date_format': 'DD/MM/YYYY',
        'time_format': '24h', 'price_rounding_step': 1,
    },
    'AE': {
        'currency_symbol': 'د.إ', 'currency_code': 'AED',
        'tax_label': 'VAT', 'default_tax_rate': Decimal('0.0500'),
        'timezone': 'Asia/Dubai', 'date_format': 'DD/MM/YYYY',
        'time_format': '24h', 'price_rounding_step': 1,
    },
    'PK': {
        'currency_symbol': 'Rs', 'currency_code': 'PKR',
        'tax_label': 'GST', 'default_tax_rate': Decimal('0.0000'),
        'timezone': 'Asia/Karachi', 'date_format': 'DD/MM/YYYY',
        'time_format': '24h', 'price_rounding_step': 50,
    },
}

# Used when the org's country isn't in the map above (US-generic).
FALLBACK_DEFAULTS = {
    'currency_symbol': '$', 'currency_code': 'USD',
    'tax_label': 'Sales Tax', 'default_tax_rate': Decimal('0.0000'),
    'timezone': 'UTC', 'date_format': 'MM/DD/YYYY',
    'time_format': '12h', 'service_charge_default_pct': Decimal('20.00'),
    'price_rounding_step': 1,
}


def defaults_for_country(country_code):
    """Return a dict of OrgSettings field defaults for an ISO country code,
    falling back to USD for unmapped/blank countries."""
    return COUNTRY_DEFAULTS.get((country_code or '').upper(), FALLBACK_DEFAULTS)


# ── how the AI should write for this market ──────────────────────────────────
#
# The drafters used to say "enquiry" to everyone, which reads as foreign to a US
# client — and the fix is NOT to hardcode American English, because a UK caterer
# writing "inquiry" and "check" to their own clients is the same bug pointed the
# other way. So the org's country picks the variant, exactly like currency and
# date format above.
#
# Deliberately short: these are the words that actually reach clients in this
# app (an enquiry, a date, a phone number, a payment), not a style guide.

LANGUAGE_VARIANTS = {
    'US': (
        "- Write in American English. Spell it 'inquiry' (never 'enquiry'), "
        "'check' (never 'cheque'), 'canceled', 'catalog', 'favorite'. Say "
        "'cell' rather than 'mobile'. Write dates American style, month first "
        "(e.g. March 14, 2026 or 3/14/2026), never day first.\n"
    ),
    'GB': (
        "- Write in British English. Spell it 'enquiry' (never 'inquiry'), "
        "'cheque' (never 'check' for a payment), 'cancelled', 'catalogue', "
        "'favourite'. Say 'mobile' rather than 'cell'. Write dates British "
        "style, day first (e.g. 14 March 2026 or 14/03/2026), never month "
        "first.\n"
    ),
}

# Countries with no variant of their own follow the market they trade with;
# unmapped and blank both land here, which keeps the app's existing US default.
FALLBACK_LANGUAGE = LANGUAGE_VARIANTS['US']

_LANGUAGE_BY_COUNTRY = {
    **LANGUAGE_VARIANTS,
    # English-speaking markets that write British rather than American.
    'IE': LANGUAGE_VARIANTS['GB'], 'AU': LANGUAGE_VARIANTS['GB'],
    'NZ': LANGUAGE_VARIANTS['GB'], 'ZA': LANGUAGE_VARIANTS['GB'],
    'IN': LANGUAGE_VARIANTS['GB'], 'PK': LANGUAGE_VARIANTS['GB'],
    'AE': LANGUAGE_VARIANTS['GB'],
}


def language_rule_for_country(country_code):
    """The prompt bullet telling a drafter which English to write in.

    Returned as a ready-to-concatenate rule line so every drafter injects it the
    same way and none of them has to know what the variants are.
    """
    return _LANGUAGE_BY_COUNTRY.get((country_code or '').upper(), FALLBACK_LANGUAGE)


def language_rule_for_org(org):
    """The language rule for an organisation, tolerating a missing org."""
    return language_rule_for_country(getattr(org, 'country', '') or '')


def writes_month_first(country_code):
    """True where a written-out date reads 'March 14, 2026' rather than
    '14 March 2026'. Same split as the English variants — the countries that
    write American spell dates American — so the two can never disagree."""
    rule = _LANGUAGE_BY_COUNTRY.get((country_code or '').upper(), FALLBACK_LANGUAGE)
    return rule is LANGUAGE_VARIANTS['US']
