from rest_framework import serializers
from .models import Dish, DishCategory


class DishCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = DishCategory
        fields = ['id', 'name', 'display_name', 'display_order', 'pool', 'unit',
                  'baseline_budget_grams', 'min_per_dish_grams', 'fixed_portion_grams',
                  'protein_is_additive']


class DishSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.display_name', read_only=True)

    class Meta:
        model = Dish
        fields = [
            'id', 'name', 'category', 'category_name', 'protein_type',
            'default_portion_grams', 'popularity',
            'cost_per_gram', 'is_vegetarian', 'notes',
        ]
