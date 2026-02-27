from rest_framework import serializers

from bookings.models import Account, Contact


class ContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = [
            'id', 'account', 'name', 'email', 'phone', 'role',
            'is_primary', 'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {'account': {'required': False}}


class AccountSerializer(serializers.ModelSerializer):
    contacts = ContactSerializer(many=True, read_only=True)

    class Meta:
        model = Account
        fields = [
            'id', 'name', 'account_type',
            'billing_address_line1', 'billing_address_line2',
            'billing_city', 'billing_postcode', 'billing_country',
            'vat_number', 'payment_terms', 'notes',
            'contacts', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
