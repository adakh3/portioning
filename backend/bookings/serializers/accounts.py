from rest_framework import serializers

from bookings.models import Account, Contact
from users.serializer_mixins import OrgScopedModelSerializer


class ContactSerializer(OrgScopedModelSerializer):
    # Org-scoped, not a plain ModelSerializer: `account` is writable on the flat
    # /bookings/contacts/ route, where nothing else org-checks it. Unscoped, a
    # client could attach their contact to another tenant's account and have it
    # surface in that tenant's customer list (REL-483).
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
            'id', 'account', 'name', 'title', 'first_name', 'last_name', 'email', 'phone', 'address', 'role',
            'preferred_channel', 'is_primary', 'notes', 'created_at', 'updated_at',
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
