from django.db import models
from users.managers import TenantManager


class GlobalConfig(models.Model):
    """Per-org portioning settings (one per organisation)."""
    objects = TenantManager()

    organisation = models.OneToOneField(
        'users.Organisation', on_delete=models.CASCADE, related_name='portioning_config',
    )
    popularity_enabled = models.BooleanField(default=True)
    popularity_strength = models.FloatField(
        default=0.3,
        help_text="0 = ignore popularity, 1 = fully proportional"
    )
    protein_pool_ceiling_grams = models.FloatField(
        default=440,
        help_text="Hard max for total protein pool per person (grams)",
    )
    accompaniment_pool_ceiling_grams = models.FloatField(
        default=150,
        help_text="Hard max for accompaniment pool per person (grams)",
    )
    dessert_pool_ceiling_grams = models.FloatField(
        default=150,
        help_text="Hard max for dessert pool per person (grams)",
    )
    dish_growth_rate = models.FloatField(
        default=0.20,
        help_text="Each extra dish adds this fraction of baseline to category budget",
    )
    absent_redistribution_fraction = models.FloatField(
        default=0.70,
        help_text="Fraction of absent-category budget that redistributes to present categories (protein pool only, 0-1)",
    )

    class Meta:
        verbose_name = 'global config'
        verbose_name_plural = 'global config'

    def __str__(self):
        return f"Global Config ({self.organisation})"

    @classmethod
    def for_org(cls, org):
        obj, _ = cls.objects.get_or_create(organisation=org)
        return obj


class BudgetProfile(models.Model):
    """Named budget profile — overrides pool ceilings for different tiers."""
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='budget_profiles',
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    categories = models.ManyToManyField(
        'dishes.DishCategory',
        related_name='budget_profiles',
        help_text="Which categories this profile is designed for",
    )
    is_default = models.BooleanField(
        default=False,
        help_text="Fallback profile if no other matches the menu",
    )
    protein_pool_ceiling_grams = models.FloatField(
        null=True, blank=True,
        help_text="Override protein pool ceiling for this tier (null = use global)",
    )
    accompaniment_pool_ceiling_grams = models.FloatField(
        null=True, blank=True,
        help_text="Override accompaniment pool ceiling for this tier (null = use global)",
    )
    dessert_pool_ceiling_grams = models.FloatField(
        null=True, blank=True,
        help_text="Override dessert pool ceiling for this tier (null = use global)",
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        ceiling = self.protein_pool_ceiling_grams or 'default'
        return f"{self.name} (protein ceiling: {ceiling}g)"

    def save(self, *args, **kwargs):
        if self.is_default:
            BudgetProfile.objects.filter(
                is_default=True, organisation=self.organisation,
            ).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


class GuestProfile(models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='guest_profiles',
    )
    name = models.CharField(max_length=50)
    portion_multiplier = models.FloatField(help_text="1.0 for adult, 0.6 for child, etc.")

    class Meta:
        unique_together = [('organisation', 'name')]

    def __str__(self):
        return f"{self.name} (x{self.portion_multiplier})"


class CombinationRule(models.Model):
    """When certain category combos appear, reduce portions."""
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='combination_rules',
    )
    categories = models.ManyToManyField('dishes.DishCategory')
    reduction_factor = models.FloatField(help_text="e.g. 0.85 = reduce by 15%")
    description = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.description


class GlobalConstraint(models.Model):
    """Per-org hard caps and floors (one per organisation)."""
    objects = TenantManager()

    organisation = models.OneToOneField(
        'users.Organisation', on_delete=models.CASCADE, related_name='portioning_constraint',
    )
    max_total_food_per_person_grams = models.FloatField(default=1000)
    min_portion_per_dish_grams = models.FloatField(default=30)

    class Meta:
        verbose_name = 'global constraint'
        verbose_name_plural = 'global constraints'

    def __str__(self):
        return f"Global Constraint ({self.organisation})"

    @classmethod
    def for_org(cls, org):
        obj, _ = cls.objects.get_or_create(organisation=org)
        return obj


class CategoryConstraint(models.Model):
    """Per-category min/max overrides."""
    category = models.OneToOneField('dishes.DishCategory', on_delete=models.CASCADE)
    min_portion_grams = models.FloatField(null=True, blank=True)
    max_portion_grams = models.FloatField(null=True, blank=True)
    max_total_category_grams = models.FloatField(null=True, blank=True)

    def __str__(self):
        return f"Constraint for {self.category.display_name}"
