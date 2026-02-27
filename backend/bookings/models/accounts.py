from django.db import models


class AccountType(models.TextChoices):
    INDIVIDUAL = 'individual', 'Individual'
    COMPANY = 'company', 'Company'
    AGENCY = 'agency', 'Agency'
    VENUE = 'venue', 'Venue'


class PaymentTerms(models.TextChoices):
    IMMEDIATE = 'immediate', 'Immediate'
    NET_15 = 'net_15', 'Net 15'
    NET_30 = 'net_30', 'Net 30'


class ContactRole(models.TextChoices):
    DECISION_MAKER = 'decision_maker', 'Decision Maker'
    COORDINATOR = 'coordinator', 'Coordinator'
    BILLING = 'billing', 'Billing'
    ONSITE = 'onsite', 'Onsite Contact'


class Account(models.Model):
    name = models.CharField(max_length=200)
    account_type = models.CharField(
        max_length=20,
        choices=AccountType.choices,
        default=AccountType.INDIVIDUAL,
    )
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

    def __str__(self):
        return self.name


class Contact(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='contacts')
    name = models.CharField(max_length=200)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    role = models.CharField(
        max_length=20,
        choices=ContactRole.choices,
        default=ContactRole.COORDINATOR,
    )
    is_primary = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_primary', 'name']

    def __str__(self):
        return f"{self.name} ({self.account.name})"
