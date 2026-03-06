from rest_framework import serializers

from bookings.models.activity import ActivityLog


class ActivityLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = ActivityLog
        fields = ['id', 'action', 'field_name', 'old_value', 'new_value', 'description', 'user_name', 'created_at']
        read_only_fields = fields

    def get_user_name(self, obj):
        if obj.user:
            return f"{obj.user.first_name} {obj.user.last_name}".strip() or obj.user.email
        return None
