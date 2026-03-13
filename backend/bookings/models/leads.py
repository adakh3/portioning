from django.db import models
from django.utils import timezone
from users.managers import TenantManager


class ProductLine(models.Model):
    objects = TenantManager()

    name = models.CharField(max_length=100)
    organisation = models.ForeignKey(
        'users.Organisation', null=True, blank=True,
        on_delete=models.CASCADE, related_name='product_lines',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Lead(models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation',
        on_delete=models.CASCADE, related_name='leads',
    )
    account = models.ForeignKey(
        'bookings.Account', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='leads',
    )
    contact_name = models.CharField(max_length=200)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=50, blank=True)
    source = models.CharField(max_length=50, default='website')
    event_date = models.DateField(null=True, blank=True)
    guest_estimate = models.IntegerField(null=True, blank=True)
    budget = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    event_type = models.CharField(max_length=50, default='other')
    meal_type = models.CharField(max_length=50, blank=True)
    service_style = models.CharField(max_length=50, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=50, default='new')
    product = models.ForeignKey(
        'bookings.ProductLine', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='leads',
    )
    assigned_to = models.ForeignKey(
        'users.User', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='assigned_leads',
    )
    created_by = models.ForeignKey(
        'users.User', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='created_leads',
    )
    won_quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='source_lead',
    )
    won_event = models.ForeignKey(
        'events.Event', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='source_lead',
    )
    lead_date = models.DateField(
        null=True, blank=True,
        help_text="Date the lead was originally generated (e.g. from ad platform)",
    )
    lost_reason_option = models.ForeignKey(
        'bookings.LostReasonOption', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='leads',
    )
    lost_notes = models.TextField(blank=True)
    contacted_at = models.DateTimeField(null=True, blank=True)
    qualified_at = models.DateTimeField(null=True, blank=True)
    proposal_sent_at = models.DateTimeField(null=True, blank=True)
    won_at = models.DateTimeField(null=True, blank=True)
    lost_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        from bookings.models.choices import EventTypeOption, LeadStatusOption
        et_label = EventTypeOption.objects.filter(value=self.event_type, organisation=self.organisation).values_list('label', flat=True).first() or self.event_type
        st_label = LeadStatusOption.objects.filter(value=self.status, organisation=self.organisation).values_list('label', flat=True).first() or self.status
        return f"{self.contact_name} — {et_label} ({st_label})"

    def can_transition_to(self, new_status):
        from bookings.models.choices import LeadStatusOption
        valid_statuses = set(LeadStatusOption.objects.values_list('value', flat=True))
        return new_status in valid_statuses and new_status != self.status

    def transition_to(self, new_status):
        if not self.can_transition_to(new_status):
            raise ValueError(f"Cannot transition from {self.status} to {new_status}")
        self.status = new_status
        now = timezone.now()
        if new_status == 'contacted':
            self.contacted_at = now
        elif new_status == 'qualified':
            self.qualified_at = now
        elif new_status == 'proposal_sent':
            self.proposal_sent_at = now
        elif new_status == 'won':
            self.won_at = now
        elif new_status == 'lost':
            self.lost_at = now
        self.save()
