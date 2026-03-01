from decimal import Decimal

from django.db import models


class BudgetRangeOption(models.Model):
    label = models.CharField(max_length=100, help_text='Display label, e.g. "£1,000 – £5,000"')
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['sort_order', 'pk']

    def __str__(self):
        return self.label


class SiteSettings(models.Model):
    currency_symbol = models.CharField(max_length=10, default='£', help_text='e.g. £, $, €')
    currency_code = models.CharField(max_length=10, default='GBP', help_text='e.g. GBP, USD, EUR')
    default_price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00'),
        help_text='Default food price per head for new quotes/events',
    )
    target_food_cost_percentage = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('30.00'),
        help_text='Target food cost as % of selling price (e.g. 30 means 30%)',
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
