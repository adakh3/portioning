from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from users.managers import TenantManager
from users.model_mixins import OrgScopedModel

class EventStatus(models.TextChoices):
    TENTATIVE = 'tentative', 'Tentative'
    CONFIRMED = 'confirmed', 'Confirmed'
    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'
    CANCELLED = 'cancelled', 'Cancelled'


EVENT_STATUS_TRANSITIONS = {
    EventStatus.TENTATIVE: [EventStatus.CONFIRMED, EventStatus.CANCELLED],
    EventStatus.CONFIRMED: [EventStatus.IN_PROGRESS, EventStatus.CANCELLED],
    EventStatus.IN_PROGRESS: [EventStatus.COMPLETED, EventStatus.CANCELLED],
    EventStatus.COMPLETED: [],
    EventStatus.CANCELLED: [EventStatus.TENTATIVE],
}


class Event(OrgScopedModel, models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation',
        on_delete=models.CASCADE, related_name='events',
    )
    name = models.CharField(max_length=200)
    event_date = models.DateField()
    gents = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    ladies = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    big_eaters = models.BooleanField(default=False)
    big_eaters_percentage = models.FloatField(default=20.0, help_text="Percentage to increase all portions when big_eaters is on")
    dishes = models.ManyToManyField('dishes.Dish', blank=True)
    based_on_template = models.ForeignKey(
        'menus.MenuTemplate', null=True, blank=True, on_delete=models.SET_NULL
    )
    notes = models.TextField(blank=True)
    kitchen_instructions = models.TextField(blank=True, help_text='Cooking-specific notes for the kitchen team')
    banquet_instructions = models.TextField(blank=True, help_text='Front-of-house/service team notes')
    setup_instructions = models.TextField(blank=True, help_text='Logistics, table layout, client-provided items')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='created_events',
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='assigned_events',
        help_text='Salesperson who owns this event; drives commission attribution.',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    # Booking fields
    account = models.ForeignKey(
        'bookings.Account',
        on_delete=models.PROTECT, related_name='events',
        null=True, blank=True,
    )
    primary_contact = models.ForeignKey(
        'bookings.Contact', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='events',
    )
    is_b2b = models.BooleanField(
        default=False, help_text='Business booking — an account (company) is required',
    )
    venue = models.ForeignKey(
        'bookings.Venue', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='events',
    )
    venue_address = models.TextField(blank=True, help_text='Freeform address for ad-hoc locations')
    product = models.ForeignKey(
        'bookings.ProductLine', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='events',
    )
    event_type = models.CharField(max_length=50, blank=True)
    meal_type = models.CharField(max_length=50, blank=True)
    service_style = models.CharField(max_length=50, blank=True)
    price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('9999999.99'))],
        help_text='Food/menu price per head',
    )
    booking_date = models.DateField(null=True, blank=True, help_text='Date the client confirmed/booked')
    status = models.CharField(max_length=20, choices=EventStatus.choices, default=EventStatus.TENTATIVE)
    is_taxable = models.BooleanField(default=False, help_text='Whether tax applies to this event')
    tax_rate = models.DecimalField(
        max_digits=5, decimal_places=4, default=Decimal('0'),
        help_text='Tax rate as a fraction (0.20 = 20%); applied only when is_taxable.',
    )
    # Money totals (food + add-on line items + tax) — computed by recalculate_totals
    # via the shared engine (bookings/services/totals.py), same as quotes.
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))

    # Timeline
    setup_time = models.DateTimeField(null=True, blank=True)
    guest_arrival_time = models.DateTimeField(null=True, blank=True)
    meal_time = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(null=True, blank=True)

    # Guest counts
    guaranteed_count = models.IntegerField(null=True, blank=True)
    final_count = models.IntegerField(null=True, blank=True)
    final_count_due = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['-event_date']

    def __str__(self):
        return f"{self.name} ({self.event_date})"

    @property
    def food_total(self):
        """Taxable food/menu cost: main menu (price_per_head × guests) + any
        additional meals (their own price_per_head × guest_count)."""
        total = Decimal('0.00')
        pph = self.price_per_head
        if pph and pph > 0:
            total += pph * ((self.gents or 0) + (self.ladies or 0))
        for meal in self.additional_meals.all():
            if meal.price_per_head and meal.guest_count:
                total += meal.price_per_head * meal.guest_count
        return total.quantize(Decimal('0.01'))

    def recalculate_totals(self):
        # Shared engine — identical math to quotes. See bookings/services/totals.py.
        from bookings.services.totals import compute_booking_totals
        rate = self.tax_rate if self.is_taxable else Decimal('0')
        totals = compute_booking_totals(self.food_total, self.line_items.all(), rate)
        self.subtotal = totals.subtotal
        self.tax_amount = totals.tax_amount
        self.total = totals.total
        self.save(update_fields=['subtotal', 'tax_amount', 'total'])


class EventConstraintOverride(models.Model):
    event = models.OneToOneField(Event, on_delete=models.CASCADE, related_name='constraint_override')
    max_total_food_per_person_grams = models.FloatField(null=True, blank=True)
    min_portion_per_dish_grams = models.FloatField(null=True, blank=True)

    def __str__(self):
        return f"Overrides for {self.event.name}"


# EventArrangement / EventBeverage were replaced by the unified BookingLineItem
# (bookings/models/addons.py), which attaches priced add-ons to an event or a quote.


class EventDishComment(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='dish_comments')
    dish = models.ForeignKey('dishes.Dish', on_delete=models.CASCADE)
    comment = models.TextField(blank=True)
    portion_grams = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = ('event', 'dish')

    def __str__(self):
        return f"{self.event.name} - {self.dish.name}"


class BookingMeal(models.Model):
    """An additional meal on a quote OR an event (exactly one) — welcome drinks,
    breakfast, a second service — each with its own menu, price-per-head, time and
    notes. Mirrors BookingLineItem's quote-XOR-event parent, so a meal belongs to
    one booking and survives the quote→event conversion as a copy."""
    quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.CASCADE, related_name='additional_meals',
    )
    event = models.ForeignKey(
        Event, null=True, blank=True,
        on_delete=models.CASCADE, related_name='additional_meals',
    )
    label = models.CharField(max_length=100)
    guest_count = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('9999999.99'))],
    )
    dishes = models.ManyToManyField('dishes.Dish', blank=True)
    based_on_template = models.ForeignKey(
        'menus.MenuTemplate', null=True, blank=True, on_delete=models.SET_NULL
    )
    meal_time = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['id']
        constraints = [
            models.CheckConstraint(
                name='bookingmeal_exactly_one_parent',
                condition=(
                    models.Q(quote__isnull=False, event__isnull=True)
                    | models.Q(quote__isnull=True, event__isnull=False)
                ),
            ),
        ]

    def __str__(self):
        return f"{self.label} for {self.event or self.quote}"


class BookingMealDishComment(models.Model):
    meal = models.ForeignKey(BookingMeal, on_delete=models.CASCADE, related_name='dish_comments')
    dish = models.ForeignKey('dishes.Dish', on_delete=models.CASCADE)
    comment = models.TextField(blank=True)
    portion_grams = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = ('meal', 'dish')

    def __str__(self):
        return f"{self.meal.label} - {self.dish.name}"
