from rest_framework import serializers

from bookings.models import EquipmentItem, EquipmentReservation


class EquipmentItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = EquipmentItem
        fields = [
            'id', 'name', 'category', 'description',
            'stock_quantity', 'rental_price', 'replacement_cost',
            'notes', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class EquipmentReservationSerializer(serializers.ModelSerializer):
    equipment_name = serializers.CharField(source='equipment.name', read_only=True)
    line_cost = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = EquipmentReservation
        fields = [
            'id', 'event', 'equipment', 'equipment_name',
            'quantity_out', 'quantity_returned', 'return_condition',
            'notes', 'line_cost', 'created_at',
        ]
        read_only_fields = ['created_at']
