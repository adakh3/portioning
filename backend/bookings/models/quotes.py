from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from .leads import EventType, ServiceStyle


class QuoteStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    SENT = 'sent', 'Sent'
    ACCEPTED = 'accepted', 'Accepted'
    EXPIRED = 'expired', 'Expired'
    DECLINED = 'declined', 'Declined'


QUOTE_TRANSITIONS = {
    QuoteStatus.DRAFT: [QuoteStatus.SENT, QuoteStatus.ACCEPTED],
    QuoteStatus.SENT: [QuoteStatus.ACCEPTED, QuoteStatus.EXPIRED, QuoteStatus.DECLINED, QuoteStatus.DRAFT],
    QuoteStatus.ACCEPTED: [],
    QuoteStatus.EXPIRED: [QuoteStatus.DRAFT],
    QuoteStatus.DECLINED: [QuoteStatus.DRAFT],
}


class Quote(models.Model):
    lead = models.ForeignKey(
        'bookings.Lead', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quotes',
    )
    account = models.ForeignKey(
        'bookings.Account', on_delete=models.PROTECT, related_name='quotes',
    )
    primary_contact = models.ForeignKey(
        'bookings.Contact', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quotes',
    )
    version = models.IntegerField(default=1)
    status = models.CharField(max_length=20, choices=QuoteStatus.choices, default=QuoteStatus.DRAFT)
    event_date = models.DateField()
    venue = models.ForeignKey(
        'bookings.Venue', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quotes',
    )
    venue_address = models.TextField(blank=True, help_text='Freeform address for ad-hoc venues')
    guest_count = models.IntegerField(validators=[MinValueValidator(1)])
    price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text='Food/menu price per head',
    )
    event_type = models.CharField(max_length=20, choices=EventType.choices, default=EventType.OTHER)
    service_style = models.CharField(max_length=20, choices=ServiceStyle.choices, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    tax_rate = models.DecimalField(max_digits=5, decimal_places=4, default=Decimal('0.2000'))
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    event = models.OneToOneField(
        'events.Event', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='source_quote',
    )
    dishes = models.ManyToManyField('dishes.Dish', blank=True, related_name='quotes')
    based_on_template = models.ForeignKey(
        'menus.MenuTemplate', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quotes',
    )
    notes = models.TextField(blank=True, help_text='Customer-visible notes')
    internal_notes = models.TextField(blank=True, help_text='Staff-only notes')
    sent_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Quote #{self.pk} v{self.version} — {self.account.name} ({self.get_status_display()})"

    def can_transition_to(self, new_status):
        return new_status in QUOTE_TRANSITIONS.get(self.status, [])

    def transition_to(self, new_status):
        if not self.can_transition_to(new_status):
            raise ValueError(f"Cannot transition from {self.status} to {new_status}")
        self.status = new_status
        now = timezone.now()
        if new_status == QuoteStatus.SENT:
            self.sent_at = now
        elif new_status == QuoteStatus.ACCEPTED:
            self.accepted_at = now
        self.save()

    @property
    def food_total(self):
        if self.price_per_head and self.price_per_head > 0:
            return (self.price_per_head * self.guest_count).quantize(Decimal('0.01'))
        return Decimal('0.00')

    def recalculate_totals(self):
        items = self.line_items.all()
        taxable_subtotal = Decimal('0.00')
        non_taxable_subtotal = Decimal('0.00')
        for item in items:
            if item.is_taxable:
                taxable_subtotal += item.line_total
            else:
                non_taxable_subtotal += item.line_total
        # Add food/menu cost (price per head × guest count)
        taxable_subtotal += self.food_total
        self.subtotal = taxable_subtotal + non_taxable_subtotal
        self.tax_amount = (taxable_subtotal * self.tax_rate).quantize(Decimal('0.01'))
        self.total = self.subtotal + self.tax_amount
        self.save(update_fields=['subtotal', 'tax_amount', 'total', 'updated_at'])

    @property
    def is_editable(self):
        return True


class LineItemCategory(models.TextChoices):
    FOOD = 'food', 'Food'
    BEVERAGE = 'beverage', 'Beverage'
    RENTAL = 'rental', 'Rental'
    LABOR = 'labor', 'Labour'
    FEE = 'fee', 'Fee'
    DISCOUNT = 'discount', 'Discount'


class LineItemUnit(models.TextChoices):
    PER_GUEST = 'per_guest', 'Per Guest'
    PER_HOUR = 'per_hour', 'Per Hour'
    FLAT = 'flat', 'Flat Rate'
    EACH = 'each', 'Each'


class QuoteLineItem(models.Model):
    quote = models.ForeignKey(Quote, on_delete=models.CASCADE, related_name='line_items')
    category = models.CharField(max_length=20, choices=LineItemCategory.choices)
    description = models.CharField(max_length=500)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('1.00'))
    unit = models.CharField(max_length=20, choices=LineItemUnit.choices, default=LineItemUnit.EACH)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    is_taxable = models.BooleanField(default=True)
    line_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    sort_order = models.IntegerField(default=0)
    menu_item = models.ForeignKey(
        'dishes.Dish', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quote_line_items',
    )
    equipment_item = models.ForeignKey(
        'bookings.EquipmentItem', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quote_line_items',
    )
    labor_role = models.ForeignKey(
        'bookings.LaborRole', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quote_line_items',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'pk']

    def __str__(self):
        return f"{self.description} — £{self.line_total}"

    def save(self, *args, **kwargs):
        if self.unit == LineItemUnit.PER_GUEST:
            self.line_total = (self.unit_price * self.quote.guest_count).quantize(Decimal('0.01'))
        elif self.category == LineItemCategory.DISCOUNT:
            self.line_total = -(abs(self.quantity * self.unit_price)).quantize(Decimal('0.01'))
        else:
            self.line_total = (self.quantity * self.unit_price).quantize(Decimal('0.01'))
        super().save(*args, **kwargs)
        self.quote.recalculate_totals()

    def delete(self, *args, **kwargs):
        quote = self.quote
        super().delete(*args, **kwargs)
        quote.recalculate_totals()
