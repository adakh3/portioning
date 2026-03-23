from rest_framework import serializers

from bookings.models import OrgSettings
from bookings.models.settings import DATE_FORMAT_CHOICES


class OrgSettingsSerializer(serializers.ModelSerializer):
    twilio_configured = serializers.BooleanField(read_only=True)
    date_format_choices = serializers.SerializerMethodField()
    # Write-only: accept plain token, store as-is (encrypt later if needed)
    twilio_auth_token = serializers.CharField(
        write_only=True, required=False, allow_blank=True, default='',
    )

    class Meta:
        model = OrgSettings
        fields = [
            'currency_symbol', 'currency_code', 'date_format', 'date_format_choices', 'timezone',
            'tax_label', 'default_tax_rate',
            'default_price_per_head', 'target_food_cost_percentage', 'price_rounding_step',
            'quotation_terms',
            # WhatsApp / Twilio
            'whatsapp_enabled', 'twilio_configured',
            'twilio_account_sid', 'twilio_whatsapp_number',
            'twilio_auth_token',  # write-only
        ]

    def get_date_format_choices(self, obj):
        return [{'value': v, 'label': l} for v, l in DATE_FORMAT_CHOICES]

    def update(self, instance, validated_data):
        # Map write-only twilio_auth_token to the model field
        token = validated_data.pop('twilio_auth_token', None)
        if token:  # only update if a non-empty value was provided
            instance.twilio_auth_token_encrypted = token
        return super().update(instance, validated_data)
