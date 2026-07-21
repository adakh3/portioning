from decimal import Decimal

from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone


class InvoiceType(models.TextChoices):
    DEPOSIT = 'deposit', 'Deposit'
    MILESTONE = 'milestone', 'Milestone'
    FINAL = 'final', 'Final'
    ADJUSTMENT = 'adjustment', 'Adjustment'


class InvoiceStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    SENT = 'sent', 'Sent'
    PARTIAL = 'partial', 'Partially Paid'
    PAID = 'paid', 'Paid'
    OVERDUE = 'overdue', 'Overdue'
    VOID = 'void', 'Void'


class PaymentMethod(models.TextChoices):
    CARD = 'card', 'Card'
    BANK_TRANSFER = 'bank_transfer', 'Bank Transfer'
    CASH = 'cash', 'Cash'
    CHECK = 'check', 'Cheque'
    OTHER = 'other', 'Other'


class Invoice(models.Model):
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='invoices')
    invoice_number = models.CharField(max_length=50, unique=True)
    invoice_type = models.CharField(max_length=20, choices=InvoiceType.choices)
    issue_date = models.DateField()
    due_date = models.DateField()
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=4, default=Decimal('0.2000'))
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=20, choices=InvoiceStatus.choices, default=InvoiceStatus.DRAFT)
    notes = models.TextField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-issue_date']

    def __str__(self):
        return f"{self.invoice_number} — {self.total} ({self.get_status_display()})"

    @property
    def amount_paid(self):
        # Sum the prefetched `payments` cache when present (list views prefetch
        # 'payments'), so this doesn't fire an aggregate query PER invoice on the
        # list. A lone, non-prefetched instance falls back to one query. (Can't
        # annotate this on the queryset — the property would shadow the annotation.)
        return sum((p.amount for p in self.payments.all()), Decimal('0.00'))

    @property
    def balance_due(self):
        return self.total - self.amount_paid

    @property
    def is_overdue(self):
        return self.status == InvoiceStatus.SENT and self.due_date < timezone.now().date()

    def update_payment_status(self):
        paid = self.amount_paid
        if paid >= self.total:
            self.status = InvoiceStatus.PAID
            self.paid_at = timezone.now()
        elif paid > Decimal('0.00'):
            self.status = InvoiceStatus.PARTIAL
        self.save(update_fields=['status', 'paid_at', 'updated_at'])


class Payment(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal('0.01')), MaxValueValidator(Decimal('9999999.99'))])
    payment_date = models.DateField()
    method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    reference = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-payment_date']

    def __str__(self):
        return f"{self.amount} on {self.payment_date} ({self.get_method_display()})"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.invoice.update_payment_status()

    def delete(self, *args, **kwargs):
        invoice = self.invoice
        super().delete(*args, **kwargs)
        invoice.update_payment_status()
