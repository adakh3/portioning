from rest_framework import serializers

from bookings.models import SiteSettings


class SiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = ['currency_symbol', 'currency_code', 'date_format', 'default_price_per_head', 'target_food_cost_percentage', 'price_rounding_step']
