from rest_framework import serializers

from bookings.models import BudgetRangeOption, SiteSettings


class BudgetRangeOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = BudgetRangeOption
        fields = ['id', 'label', 'sort_order', 'is_active']


class SiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = ['currency_symbol', 'currency_code', 'default_price_per_head', 'target_food_cost_percentage', 'price_rounding_step']
