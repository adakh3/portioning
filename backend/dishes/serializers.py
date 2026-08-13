from rest_framework import serializers

from users.mixins import get_request_org
from .models import DietaryTag, Dish, DishCategory


class DietaryTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = DietaryTag
        fields = ['id', 'slug', 'label', 'short_label', 'kind']


class DishCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = DishCategory
        fields = ['id', 'name', 'display_name', 'display_order', 'pool', 'unit',
                  'baseline_budget_grams', 'min_per_dish_grams', 'fixed_portion_grams',
                  'protein_is_additive', 'addition_surcharge', 'removal_discount']


class DishSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.display_name', read_only=True)
    margin_percent = serializers.SerializerMethodField()
    # Additive and read-only: tags are set in Django admin (and by the starter
    # catalog), and `dishes/urls.py` exposes only a list endpoint — a writable
    # field here would be API surface nothing can reach.
    dietary_tags = DietaryTagSerializer(many=True, read_only=True)

    class Meta:
        model = Dish
        fields = [
            'id', 'name', 'category', 'category_name', 'protein_type',
            'default_portion_grams', 'popularity',
            'cost_per_gram', 'selling_price_per_gram', 'selling_price_override',
            'addition_surcharge', 'removal_discount', 'surcharge_override',
            'margin_percent', 'is_vegetarian', 'notes',
            'dietary_tags',
        ]
        extra_kwargs = {'notes': {'max_length': 5000}}

    def get_margin_percent(self, obj):
        try:
            if not obj.selling_price_per_gram or not obj.cost_per_gram:
                return None
            if obj.selling_price_per_gram == 0:
                return None
            margin = (1 - obj.cost_per_gram / obj.selling_price_per_gram) * 100
            return round(float(margin), 2)
        except Exception:
            return None


class DishManageSerializer(serializers.ModelSerializer):
    """Writable, client-facing dish editor (Settings, owner/admin). Exposes name,
    category (existing only), cost, dietary tags, active and notes — the fields a
    caterer thinks about. The portioning/kitchen internals (pool, baseline, portion
    grams) stay hidden and admin-managed; selling price + per-head surcharge
    auto-compute in Dish.save() and are returned read-only for display."""
    category_name = serializers.CharField(source='category.display_name', read_only=True)
    # Read side: the resolved tag objects (for badges). Write side: a list of tag ids.
    dietary_tags = DietaryTagSerializer(many=True, read_only=True)
    dietary_tag_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=DietaryTag.objects.all(), source='dietary_tags',
        required=False, write_only=True,
    )

    class Meta:
        model = Dish
        fields = [
            'id', 'name', 'category', 'category_name', 'cost_per_gram',
            'selling_price_per_gram', 'addition_surcharge',
            'is_active', 'notes', 'dietary_tags', 'dietary_tag_ids',
        ]
        read_only_fields = ['selling_price_per_gram', 'addition_surcharge']
        extra_kwargs = {'notes': {'max_length': 5000, 'required': False}}

    def validate_category(self, category):
        # A dish may only sit in one of its OWN org's categories.
        org = get_request_org(self.context['request'])
        if org and category.organisation_id != org.id:
            raise serializers.ValidationError('That category does not belong to your organisation.')
        return category

    def create(self, validated_data):
        # default_portion_grams is required by the model but deliberately not in
        # this editor — seed it from the category's standard (baseline) portion so
        # a caterer never has to think in grams. Everything else (selling price,
        # surcharges) is auto-derived in Dish.save().
        validated_data.setdefault(
            'default_portion_grams', validated_data['category'].baseline_budget_grams,
        )
        return super().create(validated_data)
