from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

from users.managers import TenantManager
from users.model_mixins import OrgScopedModel

from .quotes import LineItemCategory, LineItemUnit


class AddOnProduct(OrgScopedModel, models.Model):
    """A catalog product/service (e.g. 'Mocktails', 'Chair rental'). Featured
    products surface as quick checkboxes on quotes/events; each product has one
    or more priced variants."""
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='addon_products',
    )
    name = models.CharField(max_length=200)
    category = models.CharField(
        max_length=20, choices=LineItemCategory.choices, default=LineItemCategory.RENTAL,
    )
    default_unit = models.CharField(
        max_length=20, choices=LineItemUnit.choices, default=LineItemUnit.EACH,
    )
    is_taxable = models.BooleanField(default=True)
    is_featured = models.BooleanField(
        default=False, help_text='Show as a quick checkbox when adding items',
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.name


class AddOnVariant(OrgScopedModel, models.Model):
    """A priced variant of an AddOnProduct (e.g. 'Mojito' £3). A simple product
    has a single variant."""
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='addon_variants',
    )
    product = models.ForeignKey(
        AddOnProduct, on_delete=models.CASCADE, related_name='variants',
    )
    name = models.CharField(max_length=200, blank=True)
    unit_price = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0'),
        validators=[MinValueValidator(Decimal('0'))],
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'name']

    def __str__(self):
        return f"{self.product.name} — {self.name}" if self.name else self.product.name
