import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone
from users.managers import TenantManager
from users.model_mixins import OrgScopedModel

# Reuse the invoice-side payment methods so client-payment recording is
# consistent app-wide. Safe import: bookings.models.finance imports no events.
from bookings.models.finance import PaymentMethod

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
    # Guest count is THE number: it drives all money math and every display.
    # gents/ladies is an optional split for kitchen portioning only — when set,
    # it must add up to guest_count (serializer-enforced); 0/0 = not specified.
    guest_count = models.IntegerField(
        default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
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

    # Unguessable token for the client-facing (unauthenticated) sign link —
    # used when a booking is created directly as an event (no quote). Only set
    # once the event is sent for signature. See bookings/views/public_sign.py.
    public_token = models.UUIDField(null=True, blank=True, unique=True, editable=False, db_index=True)

    class Meta:
        ordering = ['-event_date']

    def __str__(self):
        return f"{self.name} ({self.event_date})"

    def ensure_public_token(self):
        """Assign a client-link token if this event doesn't have one yet."""
        if not self.public_token:
            self.public_token = uuid.uuid4()
            self.save(update_fields=['public_token'])
        return self.public_token

    @property
    def latest_signature(self):
        return self.signatures.order_by('-signed_at').first()

    @property
    def has_guest_split(self):
        """True when a real gents/ladies split was entered (it adds up)."""
        return bool((self.gents or self.ladies)
                    and self.gents + self.ladies == self.guest_count)

    def portioning_guests(self):
        """Guest mix for the portion calculator: the entered split when there
        is one, otherwise everyone under the org's default guest profile."""
        if self.has_guest_split:
            return {'gents': self.gents, 'ladies': self.ladies}
        from bookings.models import OrgSettings
        default = OrgSettings.for_org(self.organisation).default_guest_profile
        return {
            'gents': self.guest_count if default != 'ladies' else 0,
            'ladies': self.guest_count if default == 'ladies' else 0,
        }

    @property
    def food_total(self):
        """Taxable food/menu cost: main menu (price_per_head × guest_count) +
        any additional meals (their own price_per_head × guest_count)."""
        total = Decimal('0.00')
        pph = self.price_per_head
        if pph and pph > 0:
            total += pph * (self.guest_count or 0)
        for meal in self.additional_meals.all():
            if meal.price_per_head and meal.guest_count:
                total += meal.price_per_head * meal.guest_count
        return total.quantize(Decimal('0.01'))

    def recalculate_totals(self):
        # Shared engine — identical math to quotes. See bookings/services/totals.py.
        from bookings.services.totals import compute_booking_totals
        rate = self.tax_rate if self.is_taxable else Decimal('0')
        # Drop any prefetch cache first: a caller may have loaded this event via
        # prefetch_related('line_items'), and that cache predates rows added in the
        # same save — so line_items.all() would omit the just-added add-ons and the
        # stored subtotal would silently drop them.
        for rel in ('line_items', 'additional_meals'):
            getattr(self, '_prefetched_objects_cache', {}).pop(rel, None)
        totals = compute_booking_totals(self.food_total, self.line_items.all(), rate)
        self.subtotal = totals.subtotal
        self.tax_amount = totals.tax_amount
        self.total = totals.total
        self.save(update_fields=['subtotal', 'tax_amount', 'total'])

    # ── Client payment tracking (advances / part / full) ──
    # Read-only settlement view over the event's EventPayments. These record money
    # the client has paid against `total`; they do NOT change the event's price, so
    # they never touch recalculate_totals().
    @property
    def amount_paid(self):
        paid = self.payments.aggregate(total=models.Sum('amount'))['total']
        return (paid or Decimal('0.00')).quantize(Decimal('0.01'))

    @property
    def balance_due(self):
        return (self.total - self.amount_paid).quantize(Decimal('0.01'))

    @property
    def payment_status(self):
        """'unpaid' (nothing paid), 'partial' (some but < total), or 'paid'
        (paid >= total). A zero-total event with any payment counts as paid."""
        paid = self.amount_paid
        if paid <= Decimal('0.00'):
            return 'unpaid'
        if paid >= self.total:
            return 'paid'
        return 'partial'


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


class EventPayment(models.Model):
    """A payment the client has made against an event (advance / part / full).

    This is operational settlement tracking — recording money already received
    (cash, bank transfer, etc.) so ops can see paid-vs-owed against the event's
    ``total``. It is NOT the SaaS subscription billing (``payments`` app), and NOT
    a formal invoice/accounting ledger (see bookings.finance for that). Org scope
    is inherited via ``event.organisation``.
    """
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='payments',
    )
    amount = models.DecimalField(
        max_digits=10, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01')), MaxValueValidator(Decimal('9999999.99'))],
    )
    payment_date = models.DateField()
    method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='event_payments_received',
        help_text='Which team member took this payment.',
    )
    reference = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-payment_date', '-id']

    def __str__(self):
        return f"{self.amount} on {self.payment_date} ({self.get_method_display()})"
