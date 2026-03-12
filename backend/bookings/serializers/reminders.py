from rest_framework import serializers

from bookings.models.reminders import Reminder


class ReminderSerializer(serializers.ModelSerializer):
    lead_name = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Reminder
        fields = [
            'id', 'lead', 'lead_name', 'user', 'user_name',
            'due_at', 'note', 'status', 'snoozed_until',
            'completed_at', 'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = ['id', 'lead', 'user', 'completed_at', 'created_by', 'created_at']

    def get_lead_name(self, obj):
        return obj.lead.contact_name if obj.lead_id else None

    def get_user_name(self, obj):
        if obj.user_id:
            u = obj.user
            return f"{u.first_name} {u.last_name}".strip() or u.email
        return None

    def get_created_by_name(self, obj):
        if obj.created_by_id:
            u = obj.created_by
            return f"{u.first_name} {u.last_name}".strip() or u.email
        return None
