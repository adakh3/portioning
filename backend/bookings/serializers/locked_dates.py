from rest_framework import serializers
from bookings.models import LockedDate


class LockedDateSerializer(serializers.ModelSerializer):
    locked_by_name = serializers.SerializerMethodField()

    class Meta:
        model = LockedDate
        fields = ['id', 'date', 'reason', 'locked_by', 'locked_by_name', 'created_at']
        read_only_fields = ['locked_by', 'created_at']

    def get_locked_by_name(self, obj):
        if obj.locked_by:
            return obj.locked_by.get_full_name() or obj.locked_by.email
        return None
