from django.db import models
from django.utils import timezone


class LeadSource(models.TextChoices):
    WEBSITE = 'website', 'Website'
    REFERRAL = 'referral', 'Referral'
    PHONE = 'phone', 'Phone'
    EMAIL = 'email', 'Email'
    SOCIAL = 'social', 'Social Media'
    WALK_IN = 'walk_in', 'Walk-in'
    REPEAT = 'repeat', 'Repeat Customer'


class LeadStatus(models.TextChoices):
    NEW = 'new', 'New'
    CONTACTED = 'contacted', 'Contacted'
    QUALIFIED = 'qualified', 'Qualified'
    CONVERTED = 'converted', 'Converted'
    LOST = 'lost', 'Lost'


class EventType(models.TextChoices):
    WEDDING = 'wedding', 'Wedding'
    CORPORATE = 'corporate', 'Corporate Event'
    BIRTHDAY = 'birthday', 'Birthday Party'
    FUNERAL = 'funeral', 'Funeral / Wake'
    RELIGIOUS = 'religious', 'Religious Event'
    SOCIAL = 'social', 'Social Gathering'
    OTHER = 'other', 'Other'


class ServiceStyle(models.TextChoices):
    BUFFET = 'buffet', 'Buffet'
    PLATED = 'plated', 'Plated / Sit-down'
    STATIONS = 'stations', 'Food Stations'
    FAMILY = 'family_style', 'Family Style'
    BOXED = 'boxed', 'Boxed / Individual'
    CANAPES = 'canapes', 'Canapés'
    MIXED = 'mixed', 'Mixed Service'


LEAD_TRANSITIONS = {
    LeadStatus.NEW: [LeadStatus.CONTACTED, LeadStatus.LOST],
    LeadStatus.CONTACTED: [LeadStatus.QUALIFIED, LeadStatus.LOST],
    LeadStatus.QUALIFIED: [LeadStatus.CONVERTED, LeadStatus.LOST],
    LeadStatus.CONVERTED: [],
    LeadStatus.LOST: [LeadStatus.NEW],
}


class Lead(models.Model):
    account = models.ForeignKey(
        'bookings.Account', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='leads',
    )
    contact_name = models.CharField(max_length=200)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=50, blank=True)
    source = models.CharField(max_length=20, choices=LeadSource.choices, default=LeadSource.WEBSITE)
    event_date = models.DateField(null=True, blank=True)
    guest_estimate = models.IntegerField(null=True, blank=True)
    budget_range = models.ForeignKey(
        'bookings.BudgetRangeOption', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='leads',
    )
    event_type = models.CharField(max_length=20, choices=EventType.choices, default=EventType.OTHER)
    service_style = models.CharField(max_length=20, choices=ServiceStyle.choices, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=LeadStatus.choices, default=LeadStatus.NEW)
    converted_to_quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='source_lead',
    )
    lost_reason = models.TextField(blank=True)
    contacted_at = models.DateTimeField(null=True, blank=True)
    qualified_at = models.DateTimeField(null=True, blank=True)
    converted_at = models.DateTimeField(null=True, blank=True)
    lost_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.contact_name} — {self.get_event_type_display()} ({self.get_status_display()})"

    def can_transition_to(self, new_status):
        return new_status in LEAD_TRANSITIONS.get(self.status, [])

    def transition_to(self, new_status):
        if not self.can_transition_to(new_status):
            raise ValueError(f"Cannot transition from {self.status} to {new_status}")
        self.status = new_status
        now = timezone.now()
        if new_status == LeadStatus.CONTACTED:
            self.contacted_at = now
        elif new_status == LeadStatus.QUALIFIED:
            self.qualified_at = now
        elif new_status == LeadStatus.CONVERTED:
            self.converted_at = now
        elif new_status == LeadStatus.LOST:
            self.lost_at = now
        self.save()
