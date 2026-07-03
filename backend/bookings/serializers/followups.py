from rest_framework import serializers

from bookings.models.followups import FollowUpDraft


class FollowUpDraftSerializer(serializers.ModelSerializer):
    lead_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = FollowUpDraft
        fields = [
            'id', 'lead', 'lead_name', 'channel', 'body', 'reasoning',
            'status', 'model_used', 'whatsapp_message',
            'reviewed_by', 'reviewed_by_name', 'reviewed_at', 'created_at',
        ]
        read_only_fields = [
            'id', 'lead', 'channel', 'reasoning', 'status', 'model_used',
            'whatsapp_message', 'reviewed_by', 'reviewed_at', 'created_at',
        ]

    def get_lead_name(self, obj):
        return obj.lead.contact_name if obj.lead_id else None

    def get_reviewed_by_name(self, obj):
        if obj.reviewed_by_id:
            u = obj.reviewed_by
            return f"{u.first_name} {u.last_name}".strip() or u.email
        return None
