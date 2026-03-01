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
        return obj.portions.count()

    def get_suggested_price_per_head(self, obj):
        total = Decimal('0')
        for portion in obj.portions.select_related('dish').all():
            if portion.dish.selling_price_per_gram:
                total += portion.dish.selling_price_per_gram * Decimal(str(portion.portion_grams))
        return round(float(total), 2) if total else None

    def get_has_unpriced_dishes(self, obj):
        return obj.portions.select_related('dish').filter(
            dish__selling_price_per_gram__isnull=True
        ).exists()


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
        total = Decimal('0')
        for portion in obj.portions.select_related('dish').all():
            if portion.dish.selling_price_per_gram:
                total += portion.dish.selling_price_per_gram * Decimal(str(portion.portion_grams))
        return round(float(total), 2) if total else None

    def get_has_unpriced_dishes(self, obj):
        return obj.portions.select_related('dish').filter(
            dish__selling_price_per_gram__isnull=True
        ).exists()
