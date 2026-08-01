from decimal import Decimal

from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.db.models.deletion import ProtectedError

from users.managers import TenantManager, TenantQuerySet


class PoolType(models.TextChoices):
    PROTEIN = 'protein', 'Protein'
    ACCOMPANIMENT = 'accompaniment', 'Accompaniment'
    DESSERT = 'dessert', 'Dessert'
    SERVICE = 'service', 'Service'


class UnitType(models.TextChoices):
    KG = 'kg', 'Kilograms'
    QTY = 'qty', 'Quantity/Pieces'


class DishCategory(models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation',
        on_delete=models.CASCADE, related_name='dish_categories',
    )
    name = models.CharField(max_length=50)
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
        validators=[MinValueValidator(0)],
        help_text="Standard budget for this category with 1 dish (per person)",
    )
    min_per_dish_grams = models.FloatField(
        default=0,
        validators=[MinValueValidator(0)],
        help_text="Minimum viable portion for any single dish in this category",
    )
    fixed_portion_grams = models.FloatField(
        null=True, blank=True,
        help_text="For service pool only: fixed per-person amount",
    )
    addition_surcharge = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        validators=[MinValueValidator(Decimal('0'))],
        help_text="Per-head surcharge when adding a dish in this category",
    )
    removal_discount = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        validators=[MinValueValidator(Decimal('0'))],
        help_text="Per-head discount when removing a dish from this category",
    )

    class Meta:
        ordering = ['display_order', 'name']
        verbose_name_plural = 'dish categories'
        # Category names are unique per-org (not globally) — two orgs may each
        # have an "Entrées" / "Curry" category.
        constraints = [
            models.UniqueConstraint(
                fields=['organisation', 'name'], name='uniq_category_org_name',
            ),
        ]

    def __str__(self):
        return self.display_name


class ProteinType(models.TextChoices):
    CHICKEN = "chicken", "Chicken"
    BEEF = "beef", "Beef"
    PORK = "pork", "Pork"
    TURKEY = "turkey", "Turkey"
    LAMB = "lamb", "Lamb"
    MUTTON = "mutton", "Mutton"
    VEAL = "veal", "Veal"
    FISH = "fish", "Fish"
    SEAFOOD = "seafood", "Seafood"
    NONE = "none", "None"


class DietaryTagKind(models.TextChoices):
    DIETARY = 'dietary', 'Dietary'
    ALLERGEN = 'allergen', 'Allergen'


class DietaryTag(models.Model):
    """A dietary or allergen label a dish can carry (gluten-free, contains peanuts…).

    Deliberately a **global reference table** — no `organisation` column. The
    vocabulary is a fixed universal standard (the FDA's 9 major allergens are law,
    not a per-org preference), so every org shares one copy and nothing here is
    tenant data. Two consequences worth knowing:

    * `block_cross_org_m2m` skips this model (it only guards org-scoped ones), so
      a dish in any org may link any tag — that is correct, not a hole.
    * It is seeded by a **data migration** keyed on `slug`, not by `seed.json`,
      because seed.json is dev-only and prod needs the vocabulary too.
    """
    slug = models.SlugField(max_length=30, unique=True)
    label = models.CharField(max_length=50)
    short_label = models.CharField(
        max_length=8, blank=True,
        help_text='Compact badge text, e.g. "GF". Blank falls back to the label.',
    )
    kind = models.CharField(
        max_length=10, choices=DietaryTagKind.choices, default=DietaryTagKind.DIETARY,
        help_text='Dietary tags read as "is" (vegan); allergens read as "contains".',
    )
    sort_order = models.IntegerField(default=0)

    class Meta:
        # DESCENDING on kind so 'dietary' sorts before 'allergen' — a dish reads
        # as what it IS first ("GF, DF"), then what it contains. Alphabetical
        # would put the allergens first, which reads backwards.
        ordering = ['-kind', 'sort_order', 'slug']

    def __str__(self):
        return self.label

    @property
    def badge(self):
        return self.short_label or self.label


def bookings_using_dish(dish):
    """(quotes, events, meals) counts for the bookings that reference ``dish``."""
    from bookings.models import Quote
    from events.models import BookingMeal, Event

    return (
        Quote.objects.filter(dishes=dish).count(),
        Event.objects.filter(dishes=dish).count(),
        BookingMeal.objects.filter(dishes=dish).count(),
    )


def protect_dish_on_bookings(dish):
    """Refuse to delete a dish that is on a booking; point at deactivating it.

    ``Quote.dishes`` / ``Event.dishes`` / ``BookingMeal.dishes`` are plain M2M
    relations, so deleting a dish cascaded the join rows away and the dish
    silently vanished from every booking that had it — historical and
    already-accepted ones included. A caterer tidying their catalogue quietly
    changed what past clients had ordered.

    The codebase already protects this class of thing: ``Contact`` is PROTECTed
    while a booking references it, and ``GuestSegment`` while a
    ``BookingGuestCount`` uses it. Dishes were the gap.

    Menu templates deliberately do NOT protect: a template is reusable config,
    not a record of something that happened, so pulling a dish out rewrites
    nothing.
    """
    quotes, events, meals = bookings_using_dish(dish)
    if not (quotes or events or meals):
        return
    used_on = ', '.join(
        f'{n} {label}' for n, label in
        [(quotes, 'quote(s)'), (events, 'event(s)'), (meals, 'additional meal(s)')]
        if n
    )
    raise ProtectedError(
        f'"{dish.name}" is on {used_on} and cannot be deleted — removing it would '
        'silently change those bookings\' menus. Untick "is active" instead: the '
        'dish disappears from new bookings and keeps its place on the ones that '
        'already have it.',
        {dish},
    )


class DishQuerySet(TenantQuerySet):
    def delete(self):
        # Checked here rather than in a pre_delete receiver so it raises BEFORE
        # Django opens the delete transaction — a receiver aborts mid-transaction
        # and leaves it unusable, which is not how PROTECT behaves.
        for dish in self:
            protect_dish_on_bookings(dish)
        return super().delete()


class DishManager(TenantManager):
    def get_queryset(self):
        return DishQuerySet(self.model, using=self._db)


class Dish(models.Model):
    objects = DishManager()

    organisation = models.ForeignKey(
        'users.Organisation',
        on_delete=models.CASCADE, related_name='dishes',
    )
    name = models.CharField(max_length=200)
    category = models.ForeignKey(DishCategory, on_delete=models.CASCADE, related_name='dishes')
    protein_type = models.CharField(max_length=20, choices=ProteinType.choices, default=ProteinType.NONE)
    default_portion_grams = models.FloatField(help_text="Baseline portion in grams")
    popularity = models.FloatField(default=1.0, help_text="Relative popularity weight")
    cost_per_gram = models.DecimalField(max_digits=10, decimal_places=4, default=0, validators=[MinValueValidator(Decimal('0'))])
    selling_price_per_gram = models.DecimalField(
        max_digits=10, decimal_places=4, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0'))],
        help_text='Selling price per gram; auto-calculated unless overridden',
    )
    selling_price_override = models.BooleanField(
        default=False,
        help_text='If True, selling_price_per_gram is manually set and not auto-calculated',
    )
    addition_surcharge = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        validators=[MinValueValidator(Decimal('0'))],
        help_text="Per-head surcharge when adding this dish; auto-calculated unless overridden",
    )
    removal_discount = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        validators=[MinValueValidator(Decimal('0'))],
        help_text="Per-head discount when removing this dish; auto-calculated unless overridden",
    )
    surcharge_override = models.BooleanField(
        default=False,
        help_text="If True, surcharges are manually set and not auto-calculated",
    )
    is_vegetarian = models.BooleanField(default=False)
    # Additive: `is_vegetarian`/`protein_type` stay the calculator's inputs; these
    # are the client-facing dietary/allergen labels. Default none — an untagged
    # dish renders exactly as it did before.
    dietary_tags = models.ManyToManyField(
        DietaryTag, blank=True, related_name='dishes',
    )
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['category__display_order', 'name']

    def __str__(self):
        return f"{self.name} ({self.category.display_name})"

    def delete(self, *args, **kwargs):
        # Before super(), so it raises outside Django's delete transaction —
        # the same point at which a PROTECT FK would refuse.
        protect_dish_on_bookings(self)
        return super().delete(*args, **kwargs)

    @property
    def computed_selling_price(self):
        """Selling price per gram based on cost and target food cost %."""
        from bookings.models import OrgSettings
        if not self.cost_per_gram:
            return None
        settings = OrgSettings.for_org(self.organisation)
        if not settings.target_food_cost_percentage:
            return None
        cost = Decimal(str(self.cost_per_gram))
        return cost / (settings.target_food_cost_percentage / Decimal('100'))

    def save(self, *args, **kwargs):
        if not self.selling_price_override and self.cost_per_gram:
            from bookings.models import OrgSettings
            settings = OrgSettings.for_org(self.organisation)
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
