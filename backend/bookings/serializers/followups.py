from rest_framework import serializers

from bookings.models.followups import FollowUpDraft


class FollowUpDraftSerializer(serializers.ModelSerializer):
    lead_name = serializers.SerializerMethodField()
    lead_phone = serializers.CharField(source='lead.contact_phone', read_only=True, default='')
    reviewed_by_name = serializers.SerializerMethodField()
    # Compact lead summary for the review card, so the reviewer can judge the
    # draft without opening the lead.
    lead_event_type = serializers.SerializerMethodField()
    lead_event_date = serializers.DateField(source='lead.event_date', read_only=True, default=None)
    lead_guest_estimate = serializers.IntegerField(source='lead.guest_estimate', read_only=True, default=None)
    lead_assigned_to_name = serializers.SerializerMethodField()
    lead_days_stale = serializers.SerializerMethodField()

    def get_lead_event_type(self, obj):
        return obj.lead.event_type if obj.lead_id else ''

    def get_lead_assigned_to_name(self, obj):
        u = obj.lead.assigned_to if obj.lead_id else None
        if not u:
            return None
        return f"{u.first_name} {u.last_name}".strip() or u.email

    def get_lead_days_stale(self, obj):
        from django.utils import timezone
        from bookings.services.followup_scheduler import last_touch_from_parts, lead_last_touch
        if not obj.lead_id:
            return None
        # Fast path: list views annotate the two "last touch" aggregates onto the
        # row (see _annotate_last_touch), so we avoid two queries per draft. Single-
        # object responses (approve/dismiss/generate) aren't annotated → fall back
        # to the live, self-querying computation (one object, negligible cost).
        if hasattr(obj, '_last_reviewed_at'):
            last = last_touch_from_parts(
                obj.lead.updated_at, obj._last_reviewed_at, obj._last_message_at,
            )
        else:
            last = lead_last_touch(obj.lead)
        return max((timezone.now() - last).days, 0)

    class Meta:
        model = FollowUpDraft
        fields = [
            'id', 'lead', 'lead_name', 'lead_phone', 'lead_event_type', 'lead_event_date',
            'lead_guest_estimate', 'lead_assigned_to_name', 'lead_days_stale',
            'channel', 'body', 'reasoning',
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
