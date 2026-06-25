from rest_framework import serializers

from bookings.models import OrgSettings
from bookings.models.settings import (
    DATE_FORMAT_CHOICES, COMMISSION_MODEL_CHOICES, TARGET_PERIOD_CHOICES,
    COMMISSION_BASIS_CHOICES,
)


def _choices(pairs):
    return [{'value': v, 'label': l} for v, l in pairs]


class OrgSettingsSerializer(serializers.ModelSerializer):
    twilio_configured = serializers.BooleanField(read_only=True)
    twilio_whatsapp_number = serializers.CharField(read_only=True)
    date_format_choices = serializers.SerializerMethodField()
    commission_model_choices = serializers.SerializerMethodField()
    target_period_choices = serializers.SerializerMethodField()
    commission_basis_choices = serializers.SerializerMethodField()

    class Meta:
        model = OrgSettings
        fields = [
            'currency_symbol', 'currency_code', 'date_format', 'date_format_choices', 'timezone',
            'tax_label', 'default_tax_rate',
            'default_price_per_head', 'target_food_cost_percentage', 'price_rounding_step',
            'quotation_terms',
            # Commission & targets
            'commission_model', 'commission_model_choices',
            'commission_flat_rate',
            'target_period', 'target_period_choices',
            'commission_basis', 'commission_basis_choices',
            # WhatsApp (read-only config, org can only toggle enabled)
            'whatsapp_enabled', 'twilio_configured', 'twilio_whatsapp_number',
        ]

    def get_date_format_choices(self, obj):
        return _choices(DATE_FORMAT_CHOICES)

    def get_commission_model_choices(self, obj):
        return _choices(COMMISSION_MODEL_CHOICES)

    def get_target_period_choices(self, obj):
        return _choices(TARGET_PERIOD_CHOICES)

    def get_commission_basis_choices(self, obj):
        return _choices(COMMISSION_BASIS_CHOICES)
