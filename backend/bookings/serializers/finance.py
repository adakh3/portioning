from rest_framework import serializers

from bookings.models import Invoice, Payment


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = [
            'id', 'invoice', 'amount', 'payment_date',
            'method', 'reference', 'notes', 'created_at',
        ]
        read_only_fields = ['created_at']
        extra_kwargs = {'invoice': {'required': False}}


class InvoiceSerializer(serializers.ModelSerializer):
    payments = PaymentSerializer(many=True, read_only=True)
    amount_paid = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    balance_due = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'event', 'invoice_number', 'invoice_type',
            'issue_date', 'due_date',
            'subtotal', 'tax_rate', 'tax_amount', 'total',
            'status', 'notes',
            'sent_at', 'paid_at',
            'payments', 'amount_paid', 'balance_due', 'is_overdue',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['sent_at', 'paid_at', 'created_at', 'updated_at']
