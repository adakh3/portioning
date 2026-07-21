from decimal import Decimal

from rest_framework import serializers
from .models import MenuTemplate, MenuDishPortion, MenuTemplatePriceTier


class MenuDishPortionSerializer(serializers.ModelSerializer):
    dish_name = serializers.CharField(source='dish.name', read_only=True)
    dish_id = serializers.IntegerField(source='dish.id', read_only=True)
    category_name = serializers.CharField(source='dish.category.display_name', read_only=True)

    class Meta:
        model = MenuDishPortion
        fields = ['dish_id', 'dish_name', 'category_name', 'portion_grams']


class PriceTierSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuTemplatePriceTier
        fields = ['min_guests', 'price_per_head']


def _suggested_price_per_head(portions):
    """Sum selling price across a template's portions. Takes an iterable so the
    caller passes the PREFETCHED `obj.portions.all()` cache — never re-query per
    row (the views prefetch `portions__dish`)."""
    total = Decimal('0')
    for p in portions:
        if p.dish.selling_price_per_gram:
            total += p.dish.selling_price_per_gram * Decimal(str(p.portion_grams))
    return round(float(total), 2) if total else None


def _has_unpriced_dishes(portions):
    """True if any portion's dish lacks a selling price. Reads the prefetched
    cache, so no per-row query."""
    return any(p.dish.selling_price_per_gram is None for p in portions)


class MenuTemplateListSerializer(serializers.ModelSerializer):
    dish_count = serializers.SerializerMethodField()
    suggested_price_per_head = serializers.SerializerMethodField()
    has_unpriced_dishes = serializers.SerializerMethodField()
    price_tiers = PriceTierSerializer(many=True, read_only=True)

    class Meta:
        model = MenuTemplate
        fields = ['id', 'name', 'description', 'menu_type', 'default_gents', 'default_ladies',
                  'dish_count', 'suggested_price_per_head', 'has_unpriced_dishes',
                  'price_tiers', 'created_at']

    def get_dish_count(self, obj):
        return len(obj.portions.all())          # len() over the prefetch cache, not .count()

    def get_suggested_price_per_head(self, obj):
        return _suggested_price_per_head(obj.portions.all())

    def get_has_unpriced_dishes(self, obj):
        return _has_unpriced_dishes(obj.portions.all())


class MenuTemplateDetailSerializer(serializers.ModelSerializer):
    portions = MenuDishPortionSerializer(many=True, read_only=True)
    suggested_price_per_head = serializers.SerializerMethodField()
    has_unpriced_dishes = serializers.SerializerMethodField()
    price_tiers = PriceTierSerializer(many=True, read_only=True)

    class Meta:
        model = MenuTemplate
        fields = ['id', 'name', 'description', 'menu_type', 'default_gents', 'default_ladies',
                  'portions', 'suggested_price_per_head', 'has_unpriced_dishes',
                  'price_tiers', 'created_at']

    def get_suggested_price_per_head(self, obj):
        return _suggested_price_per_head(obj.portions.all())

    def get_has_unpriced_dishes(self, obj):
        return _has_unpriced_dishes(obj.portions.all())
