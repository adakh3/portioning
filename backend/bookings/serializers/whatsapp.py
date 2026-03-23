from rest_framework import serializers

from bookings.models import WhatsAppMessage
from bookings.services.whatsapp_templates import TEMPLATES


class WhatsAppMessageSerializer(serializers.ModelSerializer):
    sent_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WhatsAppMessage
        fields = [
            'id', 'lead', 'reminder', 'to_phone', 'from_phone', 'body',
            'direction', 'status', 'twilio_sid', 'error_code', 'error_message',
            'sent_by', 'sent_by_name', 'created_at', 'updated_at',
        ]

    def get_sent_by_name(self, obj):
        if obj.sent_by:
            return obj.sent_by.get_full_name() or obj.sent_by.email
        return None


class WhatsAppSendSerializer(serializers.Serializer):
    body = serializers.CharField(required=False, allow_blank=True)
    template = serializers.ChoiceField(
        choices=[(k, k) for k in TEMPLATES],
        required=False,
    )
    template_context = serializers.DictField(child=serializers.CharField(), required=False)

    def validate(self, data):
        if not data.get('body') and not data.get('template'):
            raise serializers.ValidationError('Provide either body or template.')
        return data
