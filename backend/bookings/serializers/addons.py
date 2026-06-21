from rest_framework import serializers

from bookings.models import AddOnProduct, AddOnVariant


class AddOnVariantSerializer(serializers.ModelSerializer):
    class Meta:
        model = AddOnVariant
        fields = ['id', 'name', 'unit_price', 'is_active', 'sort_order']


class AddOnProductSerializer(serializers.ModelSerializer):
    variants = serializers.SerializerMethodField()

    class Meta:
        model = AddOnProduct
        fields = [
            'id', 'name', 'category', 'default_unit', 'is_taxable',
            'is_featured', 'is_active', 'sort_order', 'variants',
        ]

    def get_variants(self, obj):
        active = [v for v in obj.variants.all() if v.is_active]
        return AddOnVariantSerializer(active, many=True).data
