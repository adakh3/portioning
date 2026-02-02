from django.db import models


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
