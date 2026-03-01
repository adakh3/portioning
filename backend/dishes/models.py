from decimal import Decimal

from django.db import models


class PoolType(models.TextChoices):
    PROTEIN = 'protein', 'Protein'
    ACCOMPANIMENT = 'accompaniment', 'Accompaniment'
    DESSERT = 'dessert', 'Dessert'
    SERVICE = 'service', 'Service'


class UnitType(models.TextChoices):
    KG = 'kg', 'Kilograms'
    QTY = 'qty', 'Quantity/Pieces'


class DishCategory(models.Model):
    name = models.CharField(max_length=50, unique=True)
    display_name = models.CharField(max_length=100)
    display_order = models.IntegerField(default=0)
    protein_is_additive = models.BooleanField(
        default=False,
        help_text="If True, protein (meat) is added on top of the dish weight "
                  "(e.g. rice dishes). If False, dish weight IS the protein weight "
                  "(e.g. curry, dry/barbecue).",
    )
    pool = models.CharField(
        max_length=20,
        choices=PoolType.choices,
        default=PoolType.PROTEIN,
        help_text="Which allocation pool this category belongs to",
    )
    unit = models.CharField(
        max_length=10,
        choices=UnitType.choices,
        default=UnitType.KG,
    )
    baseline_budget_grams = models.FloatField(
        default=0,
        help_text="Standard budget for this category with 1 dish (per person)",
    )
    min_per_dish_grams = models.FloatField(
        default=0,
        help_text="Minimum viable portion for any single dish in this category",
    )
    fixed_portion_grams = models.FloatField(
        null=True, blank=True,
        help_text="For service pool only: fixed per-person amount",
    )
    addition_surcharge = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Per-head surcharge when adding a dish in this category",
    )
    removal_discount = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Per-head discount when removing a dish from this category",
    )

    class Meta:
        ordering = ['display_order', 'name']
        verbose_name_plural = 'dish categories'

    def __str__(self):
        return self.display_name


class ProteinType(models.TextChoices):
    CHICKEN = "chicken", "Chicken"
    MUTTON = "mutton", "Mutton"
    LAMB = "lamb", "Lamb"
    BEEF = "beef", "Beef"
    VEAL = "veal", "Veal"
    FISH = "fish", "Fish"
    NONE = "none", "None"


class Dish(models.Model):
    name = models.CharField(max_length=200)
    category = models.ForeignKey(DishCategory, on_delete=models.CASCADE, related_name='dishes')
    protein_type = models.CharField(max_length=20, choices=ProteinType.choices, default=ProteinType.NONE)
    default_portion_grams = models.FloatField(help_text="Baseline portion in grams")
    popularity = models.FloatField(default=1.0, help_text="Relative popularity weight")
    cost_per_gram = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    selling_price_per_gram = models.DecimalField(
        max_digits=10, decimal_places=4, null=True, blank=True,
        help_text='Selling price per gram; auto-calculated unless overridden',
    )
    selling_price_override = models.BooleanField(
        default=False,
        help_text='If True, selling_price_per_gram is manually set and not auto-calculated',
    )
    addition_surcharge = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Per-head surcharge when adding this dish; auto-calculated unless overridden",
    )
    removal_discount = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Per-head discount when removing this dish; auto-calculated unless overridden",
    )
    surcharge_override = models.BooleanField(
        default=False,
        help_text="If True, surcharges are manually set and not auto-calculated",
    )
    is_vegetarian = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['category__display_order', 'name']

    def __str__(self):
        return f"{self.name} ({self.category.display_name})"

    @property
    def computed_selling_price(self):
        """Selling price per gram based on cost and target food cost %."""
        from bookings.models import SiteSettings
        if not self.cost_per_gram:
            return None
        settings = SiteSettings.load()
        if not settings.target_food_cost_percentage:
            return None
        cost = Decimal(str(self.cost_per_gram))
        return cost / (settings.target_food_cost_percentage / Decimal('100'))

    def save(self, *args, **kwargs):
        if not self.selling_price_override and self.cost_per_gram:
            from bookings.models import SiteSettings
            settings = SiteSettings.load()
            if settings.target_food_cost_percentage:
                cost = Decimal(str(self.cost_per_gram))
                self.selling_price_per_gram = cost / (
                    settings.target_food_cost_percentage / Decimal('100')
                )

        # Auto-calculate surcharges: baseline_budget_grams × selling_price_per_gram
        if not self.surcharge_override and self.selling_price_per_gram:
            portion = Decimal(str(self.category.baseline_budget_grams))
            surcharge = (portion * self.selling_price_per_gram).quantize(Decimal('0.01'))
            self.addition_surcharge = surcharge
            self.removal_discount = (surcharge / 2).quantize(Decimal('0.01'))

        super().save(*args, **kwargs)
