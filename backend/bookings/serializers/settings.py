from rest_framework import serializers

from bookings.models import OrgSettings
from bookings.models.settings import (
    DATE_FORMAT_CHOICES, TIME_FORMAT_CHOICES, COMMISSION_MODEL_CHOICES, TARGET_PERIOD_CHOICES,
    COMMISSION_BASIS_CHOICES, FISCAL_YEAR_START_CHOICES,
)


def _choices(pairs):
    return [{'value': v, 'label': l} for v, l in pairs]


class OrgSettingsSerializer(serializers.ModelSerializer):
    # Twilio account + Anthropic key are platform-level (env). The org config
    # here is just the WhatsApp number (admin-managed) and on/off toggles.
    twilio_configured = serializers.BooleanField(read_only=True)
    twilio_whatsapp_number = serializers.CharField(read_only=True)
    date_format_choices = serializers.SerializerMethodField()
    time_format_choices = serializers.SerializerMethodField()
    commission_model_choices = serializers.SerializerMethodField()
    target_period_choices = serializers.SerializerMethodField()
    commission_basis_choices = serializers.SerializerMethodField()
    fiscal_year_start_month_choices = serializers.SerializerMethodField()
    ai_followups_configured = serializers.BooleanField(read_only=True)

    class Meta:
        model = OrgSettings
        fields = [
            'currency_symbol', 'currency_code', 'date_format', 'date_format_choices',
            'time_format', 'time_format_choices', 'timezone',
            'tax_label', 'default_tax_rate',
            'default_price_per_head', 'target_food_cost_percentage', 'price_rounding_step',
            'default_guest_profile',
            'quotation_terms',
            # Commission & targets (model/rate are per-plan now; choices kept for the plan form)
            'commission_model_choices',
            'target_period', 'target_period_choices',
            'commission_basis', 'commission_basis_choices',
            'fiscal_year_start_month', 'fiscal_year_start_month_choices',
            # WhatsApp (read-only config, org can only toggle enabled)
            'whatsapp_enabled', 'twilio_configured', 'twilio_whatsapp_number',
            # AI follow-ups
            'ai_followups_enabled', 'followup_gap_first_days', 'followup_gap_second_days',
            'followup_gap_final_days', 'followup_max_drafts_per_lead',
            'ai_followups_configured',
        ]

    def get_date_format_choices(self, obj):
        return _choices(DATE_FORMAT_CHOICES)

    def get_time_format_choices(self, obj):
        return _choices(TIME_FORMAT_CHOICES)

    def get_commission_model_choices(self, obj):
        return _choices(COMMISSION_MODEL_CHOICES)

    def get_target_period_choices(self, obj):
        return _choices(TARGET_PERIOD_CHOICES)

    def get_commission_basis_choices(self, obj):
        return _choices(COMMISSION_BASIS_CHOICES)

    def get_fiscal_year_start_month_choices(self, obj):
        return _choices(FISCAL_YEAR_START_CHOICES)
