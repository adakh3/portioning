from decimal import Decimal

from django.db import models


DATE_FORMAT_CHOICES = [
    ('DD/MM/YYYY', 'DD/MM/YYYY (UK / Europe)'),
    ('MM/DD/YYYY', 'MM/DD/YYYY (US)'),
    ('YYYY-MM-DD', 'YYYY-MM-DD (ISO)'),
]


class SiteSettings(models.Model):
    DATE_FORMAT_CHOICES = [
        ('DD/MM/YYYY', 'DD/MM/YYYY (UK / Europe)'),
        ('MM/DD/YYYY', 'MM/DD/YYYY (US)'),
        ('YYYY-MM-DD', 'YYYY-MM-DD (ISO)'),
    ]

    currency_symbol = models.CharField(max_length=10, default='£', help_text='e.g. £, $, €')
    currency_code = models.CharField(max_length=10, default='GBP', help_text='e.g. GBP, USD, EUR')
    date_format = models.CharField(
        max_length=10, choices=DATE_FORMAT_CHOICES, default='DD/MM/YYYY',
        help_text='Date display format across the application',
    )
    default_price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00'),
        help_text='Default food price per head for new quotes/events',
    )
    target_food_cost_percentage = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('30.00'),
        help_text='Target food cost as % of selling price (e.g. 30 means 30%)',
    )
    price_rounding_step = models.PositiveIntegerField(
        default=50,
        help_text='Round calculated prices to the nearest N (e.g. 50, 100). Set to 1 to disable rounding.',
    )

    class Meta:
        verbose_name = 'Site Settings'
        verbose_name_plural = 'Site Settings'

    def __str__(self):
        return f"Site Settings ({self.currency_code})"

    def save(self, *args, **kwargs):
        # Enforce singleton — always use pk=1
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class OrgSettings(models.Model):
    organisation = models.OneToOneField(
        'users.Organisation', on_delete=models.CASCADE, related_name='settings',
    )
    currency_symbol = models.CharField(max_length=10, default='£', help_text='e.g. £, $, €')
    currency_code = models.CharField(max_length=10, default='GBP', help_text='e.g. GBP, USD, EUR')
    date_format = models.CharField(
        max_length=10, choices=DATE_FORMAT_CHOICES, default='DD/MM/YYYY',
        help_text='Date display format across the application',
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
    target_food_cost_percentage = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('30.00'),
        help_text='Target food cost as % of selling price (e.g. 30 means 30%)',
    )
    price_rounding_step = models.PositiveIntegerField(
        default=50,
        help_text='Round calculated prices to the nearest N (e.g. 50, 100). Set to 1 to disable rounding.',
    )

    class Meta:
        verbose_name = 'Organisation Settings'
        verbose_name_plural = 'Organisation Settings'

    def __str__(self):
        return f"Settings for {self.organisation.name}"

    @classmethod
    def for_org(cls, org):
        """Return OrgSettings for the given org, creating with defaults if needed."""
        if org is None:
            return cls()
        obj, _ = cls.objects.get_or_create(organisation=org)
        return obj
