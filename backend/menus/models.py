from django.db import models


MENU_TYPE_CHOICES = [
    ('barat', 'Barat / Walima'),
    ('mehndi', 'Mehndi / Mayon'),
    ('custom', 'Custom'),
]


class MenuTemplate(models.Model):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    menu_type = models.CharField(max_length=20, choices=MENU_TYPE_CHOICES, default='custom')
    is_active = models.BooleanField(default=True)
    default_gents = models.IntegerField(default=50)
    default_ladies = models.IntegerField(default=50)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class MenuDishPortion(models.Model):
    """Snapshot: pre-calculated portion for a dish in a template."""
    menu = models.ForeignKey(MenuTemplate, on_delete=models.CASCADE, related_name='portions')
    dish = models.ForeignKey('dishes.Dish', on_delete=models.CASCADE)
    portion_grams = models.FloatField(help_text="Stored snapshot per-person portion in grams")

    class Meta:
        unique_together = ['menu', 'dish']

    def __str__(self):
        return f"{self.dish.name} in {self.menu.name}: {self.portion_grams}g"


class MenuTemplatePriceTier(models.Model):
    """Fixed price-per-head at a guest-count threshold."""
    menu = models.ForeignKey(MenuTemplate, on_delete=models.CASCADE, related_name='price_tiers')
    min_guests = models.PositiveIntegerField(help_text="Guest count threshold (e.g. 50, 100, 200)")
    price_per_head = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        unique_together = ['menu', 'min_guests']
        ordering = ['min_guests']

    def __str__(self):
        return f"{self.menu.name} — {self.min_guests}+ pax: {self.price_per_head}"
