import uuid
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
    # Structured address parts for ad-hoc venues (additive; venue_address kept as-is).
    venue_city = models.CharField(max_length=100, blank=True)
    venue_state = models.CharField(max_length=100, blank=True)
    venue_zip = models.CharField(max_length=20, blank=True)
    product = models.ForeignKey(
        'bookings.ProductLine', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='quotes',
    )
    guest_count = models.IntegerField(validators=[MinValueValidator(1), MaxValueValidator(50000)])
    # Gender split (shared booking field, mirrors Event) — backfilled 50/50 from
    # guest_count; the food total still uses guest_count until the editor sends the
    # split directly (frontend unification step).
    gents = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    ladies = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    big_eaters = models.BooleanField(default=False)
    big_eaters_percentage = models.FloatField(default=20.0, help_text="Percentage to increase all portions when big_eaters is on")
    price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('9999999.99'))],
        help_text='Food/menu price per head',
    )
    event_type = models.CharField(max_length=50, blank=True)
    meal_type = models.CharField(max_length=50, blank=True)
    booking_date = models.DateField(null=True, blank=True, help_text='Date the client confirmed/booked')
    service_style = models.CharField(max_length=50, blank=True)
    # Timeline (shared booking field, mirrors Event)
    setup_time = models.DateTimeField(null=True, blank=True)
    guest_arrival_time = models.DateTimeField(null=True, blank=True)
    meal_time = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    is_taxable = models.BooleanField(default=True, help_text='Whether tax applies to this booking')
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    # Rate fields are user-editable, so they carry bounds: without them the API
    # accepted a NEGATIVE tax (a tax that pays the customer), a 150% tax, and
    # negative service charge / gratuity — each of which recomputed the totals and
    # rendered happily into a sendable PDF.
    tax_rate = models.DecimalField(
        max_digits=5, decimal_places=4, default=Decimal('0.2000'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('1'))],
    )
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    # Service charge (snapshot % + stored amount) and gratuity — copied from
    # OrgSettings at creation; amounts stored by recalculate_totals. Default 0 so
    # existing rows and non-US orgs are unaffected.
    service_charge_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
        help_text='Service charge as a percentage of the subtotal')
    service_charge_taxable = models.BooleanField(default=True, help_text='Whether the service charge is added to the tax base')
    service_charge = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    gratuity_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
        help_text='Gratuity as a percentage of the subtotal (post-tax, never taxed)')
    gratuity = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
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
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='assigned_quotes',
        help_text='Salesperson who owns this quote; drives commission attribution '
                  'and carries to the event on conversion.',
    )
    sent_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    # Unguessable token for the client-facing (unauthenticated) sign link. Only
    # set once the quote is sent for signature; the token itself authorises
    # read + sign of this one quote (see bookings/views/public_sign.py).
    public_token = models.UUIDField(null=True, blank=True, unique=True, editable=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        who = self.account.name if self.account_id else (self.primary_contact.name if self.primary_contact_id else '—')
        return f"Quote #{self.pk} v{self.version} — {who} ({self.get_status_display()})"

    def ensure_public_token(self):
        """Assign a client-link token if this quote doesn't have one yet."""
        if not self.public_token:
            self.public_token = uuid.uuid4()
            self.save(update_fields=['public_token', 'updated_at'])
        return self.public_token

    @property
    def latest_signature(self):
        return self.signatures.order_by('-signed_at').first()

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
        """Taxable food/menu cost: main menu priced per guest segment
        (``price_per_head × price_multiplier × count``, summed over all segments) +
        any additional meals. Computed by the engine, identically to Event."""
        from bookings.services.booking_pricing import food_total_for
        return food_total_for(self)

    def recalculate_totals(self):
        """Re-price through the engine and store. Identical math to events, because
        it is literally the same call — see bookings/services/booking_pricing.py."""
        from bookings.services.booking_pricing import price_and_store
        price_and_store(self, extra_update_fields=['updated_at'])

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
