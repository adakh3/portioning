from rest_framework import serializers

from bookings.models import Venue


class VenueSerializer(serializers.ModelSerializer):
    class Meta:
        model = Venue
        fields = [
            'id', 'name', 'address_line1', 'address_line2',
            'city', 'postcode', 'country',
            'contact_name', 'contact_phone', 'contact_email',
            'loading_notes', 'kitchen_access', 'power_water_notes',
            'rules', 'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {
            'loading_notes': {'max_length': 2000},
            'power_water_notes': {'max_length': 2000},
            'rules': {'max_length': 2000},
            'notes': {'max_length': 5000},
        }
