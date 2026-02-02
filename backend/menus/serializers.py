from rest_framework import serializers
from .models import MenuTemplate, MenuDishPortion


class MenuDishPortionSerializer(serializers.ModelSerializer):
    dish_name = serializers.CharField(source='dish.name', read_only=True)
    dish_id = serializers.IntegerField(source='dish.id', read_only=True)
    category_name = serializers.CharField(source='dish.category.display_name', read_only=True)

    class Meta:
        model = MenuDishPortion
        fields = ['dish_id', 'dish_name', 'category_name', 'portion_grams']


class MenuTemplateListSerializer(serializers.ModelSerializer):
    dish_count = serializers.SerializerMethodField()

    class Meta:
        model = MenuTemplate
        fields = ['id', 'name', 'description', 'default_gents', 'default_ladies',
                  'dish_count', 'created_at']

    def get_dish_count(self, obj):
        return obj.portions.count()


class MenuTemplateDetailSerializer(serializers.ModelSerializer):
    portions = MenuDishPortionSerializer(many=True, read_only=True)

    class Meta:
        model = MenuTemplate
        fields = ['id', 'name', 'description', 'default_gents', 'default_ladies',
                  'portions', 'created_at']
