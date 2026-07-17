from rest_framework import serializers

from bookings.models import Account, Contact


class ContactSerializer(serializers.ModelSerializer):
    # The display name is composed from first/last on save; forms send parts.
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)

    def validate(self, attrs):
        creating = self.instance is None
        if creating and not (attrs.get('name') or attrs.get('first_name')):
            raise serializers.ValidationError({'first_name': 'First name is required.'})
        return attrs

    class Meta:
        model = Contact
        fields = [
            'id', 'account', 'name', 'first_name', 'last_name', 'email', 'phone', 'address', 'role',
            'is_primary', 'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {
            'account': {'required': False},
            'notes': {'max_length': 5000},
        }


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
        extra_kwargs = {'notes': {'max_length': 5000}}
