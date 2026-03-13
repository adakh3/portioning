from decimal import Decimal

from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from users.managers import TenantManager


class LaborRole(models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation',
        on_delete=models.CASCADE, related_name='labor_roles',
    )
    name = models.CharField(max_length=100, unique=True)
    default_hourly_rate = models.DecimalField(max_digits=8, decimal_places=2, validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('9999.99'))])
    description = models.TextField(blank=True)
    color = models.CharField(max_length=7, blank=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'bookings_laborrole'
        ordering = ['sort_order', 'name']

    def __str__(self):
        pound = "\u00A3"
        return f"{self.name} ({pound}{self.default_hourly_rate}/hr)"


class StaffMember(models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation',
        on_delete=models.CASCADE, related_name='staff_members',
    )
    name = models.CharField(max_length=200)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    roles = models.ManyToManyField(LaborRole, blank=True, related_name='staff_members')
    hourly_rate = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('9999.99'))],
        help_text='Override default role rate',
    )
    certifications = models.TextField(blank=True)
    emergency_contact = models.CharField(max_length=200, blank=True)
    emergency_phone = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'bookings_staffmember'
        ordering = ['name']

    def __str__(self):
        return self.name


class ShiftStatus(models.TextChoices):
    SCHEDULED = 'scheduled', 'Scheduled'
    CONFIRMED = 'confirmed', 'Confirmed'
    COMPLETED = 'completed', 'Completed'
    NO_SHOW = 'no_show', 'No Show'
    CANCELLED = 'cancelled', 'Cancelled'


class Shift(models.Model):
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='shifts')
    staff_member = models.ForeignKey(
        StaffMember, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='shifts',
    )
    role = models.ForeignKey(LaborRole, on_delete=models.PROTECT, related_name='shifts')
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    break_minutes = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(480)])
    hourly_rate = models.DecimalField(max_digits=8, decimal_places=2, validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('9999.99'))])
    status = models.CharField(max_length=20, choices=ShiftStatus.choices, default=ShiftStatus.SCHEDULED)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'bookings_shift'
        ordering = ['start_time']

    def __str__(self):
        staff = self.staff_member.name if self.staff_member else 'Unassigned'
        return f"{self.role.name}: {staff} ({self.start_time:%H:%M}\u2013{self.end_time:%H:%M})"

    @property
    def duration_hours(self):
        delta = self.end_time - self.start_time
        return max(Decimal('0'), (Decimal(str(delta.total_seconds())) / 3600) - (Decimal(str(self.break_minutes)) / 60))

    @property
    def shift_cost(self):
        return (self.duration_hours * self.hourly_rate).quantize(Decimal('0.01'))

    def save(self, *args, **kwargs):
        if not self.hourly_rate:
            if self.staff_member and self.staff_member.hourly_rate:
                self.hourly_rate = self.staff_member.hourly_rate
            else:
                self.hourly_rate = self.role.default_hourly_rate
        super().save(*args, **kwargs)


class AllocationRule(models.Model):
    role = models.ForeignKey(LaborRole, on_delete=models.CASCADE, related_name='allocation_rules')
    event_type = models.CharField(max_length=50, blank=True, help_text='Blank = applies to all event types')
    guests_per_staff = models.IntegerField(validators=[MinValueValidator(1), MaxValueValidator(1000)], help_text='e.g. 30 means 1 staff per 30 guests')
    minimum_staff = models.IntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(500)])
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['role__name', 'event_type']

    def __str__(self):
        scope = self.event_type or 'All events'
        return f"{self.role.name}: 1 per {self.guests_per_staff} guests ({scope})"
