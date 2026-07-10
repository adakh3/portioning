from django.db import models
from django.utils import timezone
from users.managers import TenantManager, TenantQuerySet
from users.model_mixins import OrgScopedModel


# Statuses treated as terminal for "active pipeline" queries. Matches the
# default seeded workflow's is_won/is_lost values.
TERMINAL_STATUSES = ['won', 'lost']


class LeadQuerySet(TenantQuerySet):
    """Lead-specific queryset. Houses the single shared definition of a
    "stale" lead so the dashboard and the follow-up agent never drift apart."""

    def active(self):
        """Leads still in the working pipeline (not won/lost)."""
        return self.exclude(status__in=TERMINAL_STATUSES)

    def stale(self, cutoff):
        """Active leads untouched since `cutoff` (a timezone-aware datetime).

        Staleness is keyed off `updated_at`. Callers pick the cutoff: the
        dashboard uses 7 days; the follow-up agent uses OrgSettings.followup_stale_hours.
        """
        return self.active().filter(updated_at__lt=cutoff)


class LeadManager(TenantManager):
    def get_queryset(self):
        return LeadQuerySet(self.model, using=self._db)


class ProductLine(models.Model):
    objects = TenantManager()

    name = models.CharField(max_length=100)
    organisation = models.ForeignKey(
        'users.Organisation', null=True, blank=True,
        on_delete=models.CASCADE, related_name='product_lines',
    )
    colour = models.CharField(max_length=7, default='#6B7280', help_text='Hex colour for calendar display')
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False, help_text='Pre-selected on new bookings when not carried from a lead.')
    round_robin_index = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # At most one default per org: setting this one clears the others.
        if self.is_default and self.organisation_id:
            ProductLine.objects.filter(
                organisation_id=self.organisation_id, is_default=True,
            ).exclude(pk=self.pk).update(is_default=False)

    @classmethod
    def default_for(cls, org):
        """The product line to pre-fill on a new booking: the org's marked default,
        else its first active line (by name), else None."""
        if org is None:
            return None
        active = cls.objects.filter(organisation=org, is_active=True)
        return active.filter(is_default=True).first() or active.order_by('name').first()


class Lead(OrgScopedModel, models.Model):
    objects = LeadManager()

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
    source = models.CharField(max_length=50, blank=True, default='')
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
        return f"{self.contact_name} — {self.event_type} ({self.status})"

    def can_transition_to(self, new_status):
        from bookings.models.choices import LeadStatusOption
        valid_statuses = set(
            LeadStatusOption.objects.filter(organisation=self.organisation)
            .values_list('value', flat=True)
        )
        return new_status in valid_statuses and new_status != self.status

    def transition_to(self, new_status):
        from bookings.models.choices import LeadStatusOption
        if not self.can_transition_to(new_status):
            raise ValueError(f"Cannot transition from {self.status} to {new_status}")
        option = LeadStatusOption.objects.filter(
            organisation=self.organisation, value=new_status,
        ).first()
        self.status = new_status
        now = timezone.now()
        # Legacy per-stage timestamps for the default workflow (best-effort by value).
        if new_status == 'contacted':
            self.contacted_at = now
        elif new_status == 'qualified':
            self.qualified_at = now
        elif new_status == 'proposal_sent':
            self.proposal_sent_at = now
        # Terminal stamps follow the semantic flags so renamed stages still work.
        if option and option.is_won:
            self.won_at = now
        elif option and option.is_lost:
            self.lost_at = now
        self.save()
