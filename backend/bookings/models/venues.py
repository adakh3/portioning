from django.db import models


class Venue(models.Model):
    name = models.CharField(max_length=200)
    address_line1 = models.CharField(max_length=200, blank=True)
    address_line2 = models.CharField(max_length=200, blank=True)
    city = models.CharField(max_length=100, blank=True)
    postcode = models.CharField(max_length=20, blank=True)
    country = models.CharField(max_length=100, default='UK')
    contact_name = models.CharField(max_length=200, blank=True)
    contact_phone = models.CharField(max_length=50, blank=True)
    contact_email = models.EmailField(blank=True)
    loading_notes = models.TextField(blank=True, help_text='Dock, access, parking info')
    kitchen_access = models.BooleanField(default=False)
    power_water_notes = models.TextField(blank=True)
    rules = models.TextField(blank=True, help_text='Restrictions, curfews, noise limits')
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name
