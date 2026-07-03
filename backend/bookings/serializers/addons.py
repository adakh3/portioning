from rest_framework import serializers

from bookings.models import AddOnProduct, AddOnVariant


class AddOnVariantSerializer(serializers.ModelSerializer):
    # Expose the resolved price (own price, or the product's when inherited) so
    # the frontend can keep reading `unit_price` without knowing about inheritance.
    unit_price = serializers.DecimalField(
        source='effective_price', max_digits=10, decimal_places=2, read_only=True,
    )

    class Meta:
        model = AddOnVariant
        fields = ['id', 'name', 'unit_price', 'is_active', 'sort_order']


class AddOnProductSerializer(serializers.ModelSerializer):
    variants = serializers.SerializerMethodField()

    class Meta:
        model = AddOnProduct
        fields = [
            'id', 'name', 'category', 'default_unit', 'unit_price',
            'is_featured', 'is_active', 'sort_order', 'variants',
        ]

    def get_variants(self, obj):
        active = [v for v in obj.variants.all() if v.is_active]
        for v in active:
            v.product = obj  # already loaded — avoid a query in effective_price
        return AddOnVariantSerializer(active, many=True).data
