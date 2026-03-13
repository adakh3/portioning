from rest_framework import serializers

from bookings.models import OrgSettings


class OrgSettingsSerializer(serializers.ModelSerializer):
    twilio_auth_token = serializers.CharField(
        write_only=True, required=False, allow_blank=True, default='',
    )
    twilio_configured = serializers.BooleanField(read_only=True)

    class Meta:
        model = OrgSettings
        fields = [
            'currency_symbol', 'currency_code', 'date_format', 'timezone',
            'tax_label', 'default_tax_rate',
            'default_price_per_head', 'target_food_cost_percentage', 'price_rounding_step',
            'quotation_terms',
            # WhatsApp / Twilio
            'twilio_account_sid', 'twilio_whatsapp_number', 'whatsapp_enabled',
            'twilio_auth_token', 'twilio_configured',
        ]
        extra_kwargs = {
            'quotation_terms': {'max_length': 10000},
            'twilio_auth_token_encrypted': {'read_only': True},
        }

    def update(self, instance, validated_data):
        token = validated_data.pop('twilio_auth_token', None)
        if token is not None and token != '':
            instance.twilio_auth_token = token
        return super().update(instance, validated_data)
