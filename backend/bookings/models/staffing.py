from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models


class LaborRole(models.Model):
    name = models.CharField(max_length=100, unique=True)
    default_hourly_rate = models.DecimalField(max_digits=8, decimal_places=2)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} (£{self.default_hourly_rate}/hr)"


class StaffMember(models.Model):
    name = models.CharField(max_length=200)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    roles = models.ManyToManyField(LaborRole, blank=True, related_name='staff_members')
    hourly_rate = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True,
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
    break_minutes = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    hourly_rate = models.DecimalField(max_digits=8, decimal_places=2)
    status = models.CharField(max_length=20, choices=ShiftStatus.choices, default=ShiftStatus.SCHEDULED)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['start_time']

    def __str__(self):
        staff = self.staff_member.name if self.staff_member else 'Unassigned'
        return f"{self.role.name}: {staff} ({self.start_time:%H:%M}–{self.end_time:%H:%M})"

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
