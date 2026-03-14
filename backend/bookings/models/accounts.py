from django.db import models
from users.managers import TenantManager


class CustomerType(models.TextChoices):
    CONSUMER = 'consumer', 'Consumer'
    BUSINESS = 'business', 'Business'


class PaymentTerms(models.TextChoices):
    IMMEDIATE = 'immediate', 'Immediate'
    NET_15 = 'net_15', 'Net 15'
    NET_30 = 'net_30', 'Net 30'


class Customer(models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='customers',
    )
    customer_type = models.CharField(
        max_length=20,
        choices=CustomerType.choices,
        default=CustomerType.CONSUMER,
    )
    name = models.CharField(max_length=200, help_text='Person name (consumer) or contact person (business)')
    company_name = models.CharField(max_length=200, blank=True, help_text='Only for business customers')
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    billing_address_line1 = models.CharField(max_length=200, blank=True)
    billing_address_line2 = models.CharField(max_length=200, blank=True)
    billing_city = models.CharField(max_length=100, blank=True)
    billing_postcode = models.CharField(max_length=20, blank=True)
    billing_country = models.CharField(max_length=100, default='UK')
    vat_number = models.CharField(max_length=50, blank=True)
    payment_terms = models.CharField(
        max_length=20,
        choices=PaymentTerms.choices,
        default=PaymentTerms.IMMEDIATE,
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    @property
    def display_name(self):
        return self.company_name or self.name

    def __str__(self):
        if self.customer_type == CustomerType.BUSINESS and self.company_name:
            return f"{self.company_name} ({self.name})"
        return self.name
