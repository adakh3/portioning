from decimal import Decimal

from django.db import models

from bookings.models.leads import EventType, ServiceStyle


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


class Event(models.Model):
    name = models.CharField(max_length=200)
    date = models.DateField()
    gents = models.IntegerField(default=0)
    ladies = models.IntegerField(default=0)
    big_eaters = models.BooleanField(default=False)
    big_eaters_percentage = models.FloatField(default=20.0, help_text="Percentage to increase all portions when big_eaters is on")
    dishes = models.ManyToManyField('dishes.Dish', blank=True)
    based_on_template = models.ForeignKey(
        'menus.MenuTemplate', null=True, blank=True, on_delete=models.SET_NULL
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # Booking fields
    account = models.ForeignKey(
        'bookings.Account', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='events',
    )
    primary_contact = models.ForeignKey(
        'bookings.Contact', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='events',
    )
    venue = models.ForeignKey(
        'bookings.Venue', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='events',
    )
    venue_address = models.TextField(blank=True, help_text='Freeform address for ad-hoc locations')
    event_type = models.CharField(max_length=20, choices=EventType.choices, blank=True)
    service_style = models.CharField(max_length=20, choices=ServiceStyle.choices, blank=True)
    price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text='Food/menu price per head',
    )
    status = models.CharField(max_length=20, choices=EventStatus.choices, default=EventStatus.TENTATIVE)

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
        ordering = ['-date']

    def __str__(self):
        return f"{self.name} ({self.date})"


class EventConstraintOverride(models.Model):
    event = models.OneToOneField(Event, on_delete=models.CASCADE, related_name='constraint_override')
    max_total_food_per_person_grams = models.FloatField(null=True, blank=True)
    min_portion_per_dish_grams = models.FloatField(null=True, blank=True)

    def __str__(self):
        return f"Overrides for {self.event.name}"


class EventDishComment(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='dish_comments')
    dish = models.ForeignKey('dishes.Dish', on_delete=models.CASCADE)
    comment = models.TextField(blank=True)
    portion_grams = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = ('event', 'dish')

    def __str__(self):
        return f"{self.event.name} - {self.dish.name}"
