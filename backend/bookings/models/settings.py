from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from users.managers import TenantManager


DATE_FORMAT_CHOICES = [
    ('DD/MM/YYYY', 'DD/MM/YYYY (UK / Europe)'),
    ('MM/DD/YYYY', 'MM/DD/YYYY (US)'),
    ('YYYY-MM-DD', 'YYYY-MM-DD (ISO)'),
    ('DD MMM YYYY', 'DD MMM YYYY (e.g. 14 Mar 2026)'),
    ('DD MMM YY', 'DD MMM YY (e.g. 14 Mar 26)'),
    ('MMM DD, YYYY', 'MMM DD, YYYY (e.g. Mar 14, 2026)'),
]

TIME_FORMAT_CHOICES = [
    ('24h', '24-hour (e.g. 19:00)'),
    ('12h', '12-hour AM/PM (e.g. 7:00 PM)'),
]

COMMISSION_MODEL_CHOICES = [
    ('flat', 'Flat rate'),
    ('accelerated', 'Accelerated (banded by target attainment)'),
]

TARGET_PERIOD_CHOICES = [
    ('monthly', 'Monthly'),
    ('quarterly', 'Quarterly'),
    ('yearly', 'Yearly'),
]

COMMISSION_BASIS_CHOICES = [
    ('event_date', 'Event date (when the event takes place)'),
    ('booking_date', 'Booking date (when the event was confirmed)'),
]

# (month_number, label) — the month the org's financial year starts (1 = calendar year).
FISCAL_YEAR_START_CHOICES = [
    (1, 'January (calendar year)'), (2, 'February'), (3, 'March'), (4, 'April'),
    (5, 'May'), (6, 'June'), (7, 'July'), (8, 'August'),
    (9, 'September'), (10, 'October'), (11, 'November'), (12, 'December'),
]


class OrgSettings(models.Model):
    objects = TenantManager()

    organisation = models.OneToOneField(
        'users.Organisation', on_delete=models.CASCADE, related_name='settings',
    )
    currency_symbol = models.CharField(max_length=10, default='£', help_text='e.g. £, $, €')
    currency_code = models.CharField(max_length=10, default='GBP', help_text='e.g. GBP, USD, EUR')
    date_format = models.CharField(
        max_length=20, choices=DATE_FORMAT_CHOICES, default='DD/MM/YYYY',
        help_text='Date display format across the application',
    )
    time_format = models.CharField(
        max_length=3, choices=TIME_FORMAT_CHOICES, default='24h',
        help_text='Time display format (12-hour AM/PM or 24-hour) across the application',
    )
    timezone = models.CharField(max_length=50, default='Europe/London')
    tax_label = models.CharField(max_length=20, default='VAT', help_text='e.g. VAT, Sales Tax, GST')
    default_tax_rate = models.DecimalField(
        max_digits=5, decimal_places=4, default=Decimal('0.2000'),
        help_text='Default tax rate as decimal (e.g. 0.2000 = 20%)',
    )
    default_price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00'),
        help_text='Default food price per head for new quotes/events',
    )
    default_guest_profile = models.CharField(
        max_length=10, default='gents',
        choices=[('gents', 'Standard (gents)'), ('ladies', 'Ladies')],
        help_text='Portion rule applied to all guests when an event has no gents/ladies split',
    )
    target_food_cost_percentage = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('30.00'),
        help_text='Target food cost as % of selling price (e.g. 30 means 30%)',
    )
    price_rounding_step = models.PositiveIntegerField(
        default=50,
        validators=[MaxValueValidator(1000)],
        help_text='Round calculated prices to the nearest N (e.g. 50, 100). Set to 1 to disable rounding.',
    )
    quotation_terms = models.TextField(
        blank=True,
        help_text='Terms & Conditions text printed on quotation PDFs.',
    )

    # WhatsApp / Twilio integration.
    # The Twilio account (SID + auth token) is platform-level — see
    # settings.TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN. Each org configures only
    # its own WhatsApp sender number.
    whatsapp_enabled = models.BooleanField(default=False)
    twilio_whatsapp_number = models.CharField(
        max_length=20, blank=True, default='',
        help_text='Twilio WhatsApp sender number, e.g. +14155238886',
    )

    # Commission & targets (per-org)
    commission_model = models.CharField(
        max_length=20, choices=COMMISSION_MODEL_CHOICES, default='flat',
        help_text='Flat rate on all revenue, or accelerated bands keyed to target attainment.',
    )
    commission_flat_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
        help_text='Commission rate % on all won revenue (used when model is flat).',
    )
    target_period = models.CharField(
        max_length=20, choices=TARGET_PERIOD_CHOICES, default='monthly',
        help_text='Period over which sales targets and commission are measured and reset.',
    )
    commission_basis = models.CharField(
        max_length=20, choices=COMMISSION_BASIS_CHOICES, default='event_date',
        help_text='Which date attributes a confirmed event to a commission period.',
    )
    fiscal_year_start_month = models.PositiveSmallIntegerField(
        choices=FISCAL_YEAR_START_CHOICES, default=1,
        validators=[MinValueValidator(1), MaxValueValidator(12)],
        help_text="Month the financial year starts (1 = calendar year). Drives 'this year' and yearly targets.",
    )

    # AI follow-up drafting. The Anthropic key is platform-level
    # (settings.ANTHROPIC_API_KEY); orgs only toggle the feature and tune it.
    ai_followups_enabled = models.BooleanField(
        default=False,
        help_text='Let the AI agent draft WhatsApp follow-ups for stale leads (always reviewed before sending).',
    )
    followup_stale_hours = models.PositiveIntegerField(
        default=168,
        validators=[MaxValueValidator(8760)],
        help_text='Hours a lead can sit untouched before the agent drafts a follow-up (default 168 = 7 days).',
    )
    followup_max_drafts_per_lead = models.PositiveIntegerField(
        default=3,
        validators=[MaxValueValidator(50)],
        help_text='Never generate more than this many follow-up drafts for a single lead.',
    )

    class Meta:
        verbose_name = 'Organisation Settings'
        verbose_name_plural = 'Organisation Settings'

    def __str__(self):
        return f"Settings for {self.organisation.name}"

    @property
    def ai_followups_configured(self):
        """Whether the AI agent can *draft* follow-ups for this org.

        Drafting only needs the org opted-in plus the platform Anthropic key.
        Delivery is a separate concern: approving a draft sends it via WhatsApp,
        which surfaces its own error if Twilio isn't configured. Keeping these
        decoupled lets an org review AI drafts before wiring up WhatsApp.
        """
        from django.conf import settings as django_settings
        return bool(
            self.ai_followups_enabled
            and django_settings.ANTHROPIC_API_KEY
        )

    @property
    def twilio_configured(self):
        """Platform Twilio account present AND this org has a sender number."""
        from django.conf import settings as django_settings
        return bool(
            django_settings.TWILIO_ACCOUNT_SID
            and django_settings.TWILIO_AUTH_TOKEN
            and self.twilio_whatsapp_number
        )

    @classmethod
    def for_org(cls, org):
        """Return OrgSettings for the given org, creating with defaults if needed."""
        if org is None:
            return cls()
        obj, _ = cls.objects.get_or_create(organisation=org)
        return obj
