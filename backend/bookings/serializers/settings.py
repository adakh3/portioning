from rest_framework import serializers

from bookings.models import OrgSettings
from bookings.models.settings import DATE_FORMAT_CHOICES


class OrgSettingsSerializer(serializers.ModelSerializer):
    twilio_configured = serializers.BooleanField(read_only=True)
    twilio_whatsapp_number = serializers.CharField(read_only=True)
    date_format_choices = serializers.SerializerMethodField()

    class Meta:
        model = OrgSettings
        fields = [
            'currency_symbol', 'currency_code', 'date_format', 'date_format_choices', 'timezone',
            'tax_label', 'default_tax_rate',
            'default_price_per_head', 'target_food_cost_percentage', 'price_rounding_step',
            'quotation_terms',
            # WhatsApp (read-only config, org can only toggle enabled)
            'whatsapp_enabled', 'twilio_configured', 'twilio_whatsapp_number',
        ]

    def get_date_format_choices(self, obj):
        return [{'value': v, 'label': l} for v, l in DATE_FORMAT_CHOICES]
