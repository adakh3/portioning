from decimal import Decimal

from django.core.validators import MinValueValidator, MaxValueValidator
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
    unit_price = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0'),
        validators=[MinValueValidator(Decimal('0'))],
        help_text='Base price. Variants without their own price inherit this.',
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
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0'))],
        help_text='Leave blank to inherit the product price; set a value to override it.',
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'name']

    def __str__(self):
        return f"{self.product.name} — {self.name}" if self.name else self.product.name

    @property
    def effective_price(self):
        """The variant's own price, or the product's base price when not set."""
        return self.unit_price if self.unit_price is not None else self.product.unit_price


class BookingLineItem(models.Model):
    """A priced add-on line on a quote OR an event (exactly one). Catalog-driven
    (via `variant`) or ad-hoc free-text. Unifies the old QuoteLineItem and the
    event arrangements/beverages."""
    quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.CASCADE, related_name='line_items',
    )
    event = models.ForeignKey(
        'events.Event', null=True, blank=True,
        on_delete=models.CASCADE, related_name='line_items',
    )
    variant = models.ForeignKey(
        AddOnVariant, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='line_items',
    )
    category = models.CharField(max_length=20, choices=LineItemCategory.choices)
    description = models.CharField(max_length=500)
    quantity = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('1.00'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('99999'))],
    )
    unit = models.CharField(max_length=20, choices=LineItemUnit.choices, default=LineItemUnit.EACH)
    unit_price = models.DecimalField(
        max_digits=10, decimal_places=2,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('9999999.99'))],
    )
    is_taxable = models.BooleanField(default=True)
    line_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    sort_order = models.IntegerField(default=0)
    menu_item = models.ForeignKey(
        'dishes.Dish', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quote_line_items',
    )
    equipment_item = models.ForeignKey(
        'equipment.EquipmentItem', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quote_line_items',
    )
    labor_role = models.ForeignKey(
        'staff.LaborRole', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quote_line_items',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'pk']
        constraints = [
            models.CheckConstraint(
                name='bookinglineitem_exactly_one_parent',
                condition=(
                    models.Q(quote__isnull=False, event__isnull=True)
                    | models.Q(quote__isnull=True, event__isnull=False)
                ),
            ),
        ]

    def __str__(self):
        return f"{self.description} — £{self.line_total}"

    @property
    def _guest_count(self):
        if self.quote_id:
            return self.quote.guest_count
        if self.event_id:
            return self.event.gents + self.event.ladies
        return 0

    def save(self, *args, **kwargs):
        if self.unit == LineItemUnit.PER_GUEST:
            self.line_total = (self.unit_price * self._guest_count).quantize(Decimal('0.01'))
        elif self.category == LineItemCategory.DISCOUNT:
            self.line_total = -(abs(self.quantity * self.unit_price)).quantize(Decimal('0.01'))
        else:
            self.line_total = (self.quantity * self.unit_price).quantize(Decimal('0.01'))
        super().save(*args, **kwargs)
        if self.quote_id:
            self.quote.recalculate_totals()
        elif self.event_id:
            self.event.recalculate_totals()

    def delete(self, *args, **kwargs):
        quote = self.quote if self.quote_id else None
        event = self.event if self.event_id else None
        super().delete(*args, **kwargs)
        if quote is not None:
            quote.recalculate_totals()
        elif event is not None:
            event.recalculate_totals()
