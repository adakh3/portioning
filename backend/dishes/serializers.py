from rest_framework import serializers
from .models import Dish, DishCategory


class DishCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = DishCategory
        fields = ['id', 'name', 'display_name', 'display_order', 'pool', 'unit',
                  'baseline_budget_grams', 'min_per_dish_grams', 'fixed_portion_grams',
                  'protein_is_additive', 'addition_surcharge', 'removal_discount']


class DishSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.display_name', read_only=True)
    margin_percent = serializers.SerializerMethodField()

    class Meta:
        model = Dish
        fields = [
            'id', 'name', 'category', 'category_name', 'protein_type',
            'default_portion_grams', 'popularity',
            'cost_per_gram', 'selling_price_per_gram', 'selling_price_override',
            'addition_surcharge', 'removal_discount', 'surcharge_override',
            'margin_percent', 'is_vegetarian', 'notes',
        ]

    def get_margin_percent(self, obj):
        if not obj.selling_price_per_gram or not obj.cost_per_gram:
            return None
        margin = (1 - obj.cost_per_gram / obj.selling_price_per_gram) * 100
        return round(float(margin), 2)
