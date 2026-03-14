from rest_framework import serializers

from bookings.models import OrgSettings
from bookings.models.settings import DATE_FORMAT_CHOICES


class OrgSettingsSerializer(serializers.ModelSerializer):
    date_format_choices = serializers.SerializerMethodField()

    class Meta:
        model = OrgSettings
        fields = [
            'currency_symbol', 'currency_code', 'date_format', 'date_format_choices', 'timezone',
            'tax_label', 'default_tax_rate',
            'default_price_per_head', 'target_food_cost_percentage', 'price_rounding_step',
            'quotation_terms',
        ]
        extra_kwargs = {'quotation_terms': {'max_length': 10000}}

    def get_date_format_choices(self, obj):
        return [{'value': v, 'label': l} for v, l in DATE_FORMAT_CHOICES]
