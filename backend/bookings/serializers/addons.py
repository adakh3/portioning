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


class AddOnVariantManageSerializer(serializers.ModelSerializer):
    """Editable view of a variant (Settings). Unlike the read serializer — whose
    `unit_price` is the resolved `effective_price` — this exposes the RAW override:
    null/blank means "inherit the product's base price"."""
    id = serializers.IntegerField(required=False)
    unit_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True,
    )

    class Meta:
        model = AddOnVariant
        fields = ['id', 'name', 'unit_price', 'is_active', 'sort_order']


class AddOnProductManageSerializer(serializers.ModelSerializer):
    """Create/update an add-on product and its variants in one payload (Settings,
    owner/admin). Variants are upserted by `id`; any existing variant omitted from
    the payload is deleted."""
    variants = AddOnVariantManageSerializer(many=True, required=False)

    class Meta:
        model = AddOnProduct
        fields = [
            'id', 'name', 'category', 'default_unit', 'unit_price',
            'is_taxable', 'is_featured', 'is_active', 'sort_order', 'variants',
        ]

    def create(self, validated_data):
        variants = validated_data.pop('variants', [])
        product = AddOnProduct.objects.create(**validated_data)
        self._sync_variants(product, variants)
        return product

    def update(self, instance, validated_data):
        variants = validated_data.pop('variants', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        # Only touch variants when the caller sent them — a PATCH of just the
        # product fields leaves the variants alone.
        if variants is not None:
            self._sync_variants(instance, variants)
        return instance

    def _sync_variants(self, product, variants):
        existing = {v.id: v for v in product.variants.all()}
        seen = set()
        for data in variants:
            vid = data.get('id')
            fields = {k: v for k, v in data.items() if k != 'id'}
            if vid and vid in existing:
                variant = existing[vid]
                for attr, value in fields.items():
                    setattr(variant, attr, value)
                variant.save()
                seen.add(vid)
            else:
                AddOnVariant.objects.create(
                    product=product, organisation=product.organisation, **fields,
                )
        for vid, variant in existing.items():
            if vid not in seen:
                variant.delete()
