from rest_framework import serializers

from .models import EquipmentItem, EquipmentReservation


class EquipmentItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = EquipmentItem
        fields = [
            'id', 'name', 'category', 'description',
            'stock_quantity', 'rental_price', 'replacement_cost',
            'notes', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {
            'description': {'max_length': 2000},
            'notes': {'max_length': 5000},
        }


class EquipmentReservationSerializer(serializers.ModelSerializer):
    equipment_name = serializers.CharField(source='equipment.name', read_only=True)
    line_cost = serializers.SerializerMethodField()

    class Meta:
        model = EquipmentReservation
        fields = [
            'id', 'event', 'equipment', 'equipment_name',
            'quantity_out', 'quantity_returned', 'return_condition',
            'notes', 'line_cost', 'created_at',
        ]
        read_only_fields = ['created_at']
        extra_kwargs = {'notes': {'max_length': 5000}}

    def get_line_cost(self, obj):
        try:
            return str(obj.line_cost)
        except Exception:
            return None
