from django.db import models


class MenuTemplate(models.Model):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
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
