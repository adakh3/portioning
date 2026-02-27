from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models


class EquipmentCategory(models.TextChoices):
    CHAFER = 'chafer', 'Chafer / Warmer'
    TABLE = 'table', 'Table'
    LINEN = 'linen', 'Linen'
    GLASSWARE = 'glassware', 'Glassware'
    COOKING = 'cooking', 'Cooking Equipment'
    SERVING = 'serving', 'Serving Equipment'
    DECOR = 'decor', 'Decor'
    TRANSPORT = 'transport', 'Transport'
    OTHER = 'other', 'Other'


class EquipmentItem(models.Model):
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=EquipmentCategory.choices, default=EquipmentCategory.OTHER)
    description = models.TextField(blank=True)
    stock_quantity = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    rental_price = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
        help_text='Per unit per event',
    )
    replacement_cost = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['category', 'name']

    def __str__(self):
        return f"{self.name} ({self.stock_quantity} in stock)"

    def available_on_date(self, date):
        reserved = self.reservations.filter(
            event__date=date,
        ).aggregate(total=models.Sum('quantity_out'))['total'] or 0
        return max(0, self.stock_quantity - reserved)


class ReturnCondition(models.TextChoices):
    PENDING = 'pending', 'Pending'
    GOOD = 'good', 'Good'
    DAMAGED = 'damaged', 'Damaged'
    LOST = 'lost', 'Lost'


class EquipmentReservation(models.Model):
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='equipment_reservations')
    equipment = models.ForeignKey(EquipmentItem, on_delete=models.PROTECT, related_name='reservations')
    quantity_out = models.IntegerField(validators=[MinValueValidator(1)])
    quantity_returned = models.IntegerField(null=True, blank=True, validators=[MinValueValidator(0)])
    return_condition = models.CharField(
        max_length=20, choices=ReturnCondition.choices,
        default=ReturnCondition.PENDING,
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('event', 'equipment')
        ordering = ['equipment__name']

    def __str__(self):
        return f"{self.quantity_out}x {self.equipment.name} for {self.event.name}"

    @property
    def line_cost(self):
        return (self.quantity_out * self.equipment.rental_price).quantize(Decimal('0.01'))
