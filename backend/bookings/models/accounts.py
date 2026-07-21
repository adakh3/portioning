from django.db import models
from users.managers import TenantManager


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
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='accounts',
    )
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
    billing_country = models.CharField(max_length=100, blank=True)
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

    def save(self, *args, **kwargs):
        # New rows default billing_country to the org's country (not 'UK');
        # existing rows are never rewritten.
        if not self.pk and not self.billing_country and self.organisation_id:
            self.billing_country = self.organisation.country
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Contact(models.Model):
    objects = TenantManager()

    # The PERSON is the primary customer and is org-scoped directly. The
    # business (account) is now OPTIONAL — a person is not tied to a company;
    # the company attaches to the booking (Quote/Event) instead.
    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='contacts',
    )
    account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True, related_name='contacts',
    )
    name = models.CharField(max_length=200)
    first_name = models.CharField(max_length=100, blank=True, default='')
    last_name = models.CharField(max_length=100, blank=True, default='')
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    address = models.TextField(
        blank=True, help_text='Home/billing address — used to prefill the venue address',
    )
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
        if self.account_id:
            return f"{self.name} ({self.account.name})"
        return self.name

    def save(self, *args, **kwargs):
        # Same rule as Lead: name is the display column, parts win when set,
        # a bare two-word name is split into parts.
        from bookings.names import compose_full_name, split_full_name
        from bookings.phones import normalize_phone
        composed = compose_full_name(self.first_name, self.last_name)
        if composed:
            self.name = composed
        elif self.name:
            self.first_name, self.last_name = split_full_name(self.name)
        if self.phone and self.organisation_id:
            self.phone = normalize_phone(self.phone, self.organisation.country)
        super().save(*args, **kwargs)
