"""Sensible OrgSettings defaults derived from an organisation's country.

A new org's currency, tax label/rate, timezone and date format should match its
market — not the app's old hardcoded UK (£/GBP/VAT) defaults. This maps a handful
of countries to appropriate defaults, with a **USD generic fallback** for anything
unmapped. Values are only *defaults* at creation time — the owner can change them
in Settings afterwards.

Tax rates are intentionally conservative (often 0) because catering tax is
destination-based and set per-event by the caterer; this is just the starting
label/rate.
"""
from decimal import Decimal

# country ISO alpha-2 -> OrgSettings field defaults
COUNTRY_DEFAULTS = {
    'US': {
        'currency_symbol': '$', 'currency_code': 'USD',
        'tax_label': 'Sales Tax', 'default_tax_rate': Decimal('0.0000'),
        'timezone': 'America/New_York', 'date_format': 'MM/DD/YYYY',
    },
    'GB': {
        'currency_symbol': '£', 'currency_code': 'GBP',
        'tax_label': 'VAT', 'default_tax_rate': Decimal('0.2000'),
        'timezone': 'Europe/London', 'date_format': 'DD/MM/YYYY',
    },
    'AE': {
        'currency_symbol': 'د.إ', 'currency_code': 'AED',
        'tax_label': 'VAT', 'default_tax_rate': Decimal('0.0500'),
        'timezone': 'Asia/Dubai', 'date_format': 'DD/MM/YYYY',
    },
    'PK': {
        'currency_symbol': 'Rs', 'currency_code': 'PKR',
        'tax_label': 'GST', 'default_tax_rate': Decimal('0.0000'),
        'timezone': 'Asia/Karachi', 'date_format': 'DD/MM/YYYY',
    },
}

# Used when the org's country isn't in the map above.
FALLBACK_DEFAULTS = {
    'currency_symbol': '$', 'currency_code': 'USD',
    'tax_label': 'Sales Tax', 'default_tax_rate': Decimal('0.0000'),
    'timezone': 'UTC', 'date_format': 'MM/DD/YYYY',
}


def defaults_for_country(country_code):
    """Return a dict of OrgSettings field defaults for an ISO country code,
    falling back to USD for unmapped/blank countries."""
    return COUNTRY_DEFAULTS.get((country_code or '').upper(), FALLBACK_DEFAULTS)
