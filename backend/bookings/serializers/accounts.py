from rest_framework import serializers

from bookings.models import Customer


class CustomerSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = Customer
        fields = [
            'id', 'customer_type', 'name', 'company_name', 'display_name',
            'email', 'phone',
            'billing_address_line1', 'billing_address_line2',
            'billing_city', 'billing_postcode', 'billing_country',
            'vat_number', 'payment_terms', 'notes',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {'notes': {'max_length': 5000}}
