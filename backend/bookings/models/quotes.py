from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone
from users.managers import TenantManager
from users.model_mixins import OrgScopedModel

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


class Quote(OrgScopedModel, models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation',
        on_delete=models.CASCADE, related_name='quotes',
    )
    lead = models.ForeignKey(
        'bookings.Lead', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quotes',
    )
    # The customer (person) is required; the business (account) is optional and
    # only required when this is a B2B booking (enforced in the serializer).
    primary_contact = models.ForeignKey(
        'bookings.Contact', on_delete=models.PROTECT, related_name='quotes',
    )
    is_b2b = models.BooleanField(
        default=False, help_text='Business booking — an account (company) is required',
    )
    account = models.ForeignKey(
        'bookings.Account', null=True, blank=True,
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
    product = models.ForeignKey(
        'bookings.ProductLine', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quotes',
    )
    guest_count = models.IntegerField(validators=[MinValueValidator(1), MaxValueValidator(50000)])
    price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MaxValueValidator(Decimal('9999999.99'))],
        help_text='Food/menu price per head',
    )
    event_type = models.CharField(max_length=50, default='other')
    meal_type = models.CharField(max_length=50, blank=True)
    booking_date = models.DateField(null=True, blank=True, help_text='Date the client confirmed/booked')
    service_style = models.CharField(max_length=50, blank=True)
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
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='created_quotes',
    )
    sent_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        who = self.account.name if self.account_id else (self.primary_contact.name if self.primary_contact_id else '—')
        return f"Quote #{self.pk} v{self.version} — {who} ({self.get_status_display()})"

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


# QuoteLineItem was renamed to BookingLineItem and moved to bookings/models/addons.py
# (it now attaches to a quote OR an event). LineItemCategory/LineItemUnit live here
# and are imported by addons.py.
