from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from users.mixins import get_request_org
from .models import MenuTemplate, MenuDishPortion, MenuTemplatePriceTier, MenuCourse


class MenuCourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuCourse
        fields = ['name', 'sort_order']


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
    # Courses (REL-417) — carried onto a booking when the template is applied. Shape
    # mirrors the booking API: an ordered `courses` list + `dish_courses` {dish_id: index}.
    courses = MenuCourseSerializer(many=True, read_only=True)
    dish_courses = serializers.SerializerMethodField()

    class Meta:
        model = MenuTemplate
        fields = ['id', 'name', 'description', 'menu_type', 'default_gents', 'default_ladies',
                  'portions', 'courses', 'dish_courses',
                  'suggested_price_per_head', 'has_unpriced_dishes',
                  'price_tiers', 'created_at']

    def get_suggested_price_per_head(self, obj):
        return _suggested_price_per_head(obj.portions.all())

    def get_has_unpriced_dishes(self, obj):
        return _has_unpriced_dishes(obj.portions.all())

    def get_dish_courses(self, obj):
        index_by_id = {c.id: i for i, c in enumerate(obj.courses.all())}
        return {str(p.dish_id): index_by_id[p.course_id]
                for p in obj.portions.all() if p.course_id in index_by_id}


def _auto_portion_grams(template, dish_ids):
    """Per-dish portion (grams) for a template's dish set, so a caterer never has
    to enter grams. Runs the real portioning engine for the template's default
    gents/ladies split and takes each dish's per-gent base grams; if the engine
    can't place a dish it falls back to that dish's own standard portion."""
    if not dish_ids:
        return {}
    grams = {}
    try:
        from calculator.engine.calculator import calculate_portions
        result = calculate_portions(
            dish_ids,
            {'gents': template.default_gents, 'ladies': template.default_ladies},
            org=template.organisation,
        )
        grams = {p['dish_id']: round(p['grams_per_gent'], 1) for p in result.get('portions', [])}
    except Exception:
        grams = {}
    # Fill any gaps (engine returned nothing for a dish, or blew up) with the
    # dish's own standard portion — the snapshot is required and a preview aid;
    # the booking re-runs the calculator with real numbers anyway.
    from dishes.models import Dish
    missing = [i for i in dish_ids if i not in grams]
    if missing:
        for d in Dish.objects.filter(id__in=missing, organisation=template.organisation):
            grams[d.id] = d.default_portion_grams
    return grams


class MenuTemplateManageSerializer(serializers.ModelSerializer):
    """Create/edit a menu template and its composition in one payload (Settings/
    /menus, owner/admin). The editor is compose-only: send the scalar fields plus

      courses:     [{name, sort_order}]              (order = the list order)
      dishes:      [{dish_id, course}]               (course = index into courses, or null)
      price_tiers: [{min_guests, price_per_head}]    (optional)

    Portion grams are auto-computed by the engine — never sent. Each collection is
    replaced wholesale (templates are small and edited as a unit)."""
    courses = serializers.ListField(child=serializers.DictField(), required=False, write_only=True)
    dishes = serializers.ListField(child=serializers.DictField(), required=False, write_only=True)
    price_tiers = serializers.ListField(child=serializers.DictField(), required=False, write_only=True)

    class Meta:
        model = MenuTemplate
        fields = ['id', 'name', 'description', 'menu_type', 'default_gents', 'default_ladies',
                  'is_active', 'courses', 'dishes', 'price_tiers']

    def validate_dishes(self, dishes):
        org = get_request_org(self.context['request'])
        ids = [d.get('dish_id') for d in dishes]
        if None in ids:
            raise serializers.ValidationError('Each dish needs a dish_id.')
        if org and ids:
            from dishes.models import Dish
            valid = set(Dish.objects.filter(id__in=ids, organisation=org).values_list('id', flat=True))
            missing = [i for i in ids if i not in valid]
            if missing:
                raise serializers.ValidationError(f'Dishes not in your organisation: {missing}')
        return dishes

    def validate_price_tiers(self, tiers):
        # The tiers are written with bare .create() (which skips the model's
        # field validators), so guard their values here.
        for t in tiers:
            try:
                min_guests = int(t.get('min_guests'))
                price = Decimal(str(t.get('price_per_head')))
            except (TypeError, ValueError, ArithmeticError):
                raise serializers.ValidationError('Each price tier needs a whole-number guest count and a price.')
            if min_guests < 1:
                raise serializers.ValidationError('A price tier needs a guest count of at least 1.')
            if price < 0:
                raise serializers.ValidationError('A price tier price cannot be negative.')
        # A tier is unique per (menu, min_guests); catch a repeated threshold here
        # so it's a clean 400 rather than an IntegrityError 500 mid-save.
        thresholds = [t.get('min_guests') for t in tiers]
        dupes = {g for g in thresholds if thresholds.count(g) > 1}
        if dupes:
            raise serializers.ValidationError(
                f'Only one price tier per guest-count threshold (repeated: {sorted(dupes)}).'
            )
        return tiers

    def to_representation(self, instance):
        data = super().to_representation(instance)  # scalar fields only (nested are write_only)
        courses = list(instance.courses.all())
        index_by_course_id = {c.id: i for i, c in enumerate(courses)}
        data['courses'] = [{'name': c.name, 'sort_order': c.sort_order} for c in courses]
        data['dishes'] = [
            {'dish_id': p.dish_id, 'dish_name': p.dish.name,
             'category_name': p.dish.category.display_name,
             'portion_grams': p.portion_grams,
             'course': index_by_course_id.get(p.course_id)}
            for p in instance.portions.all()
        ]
        data['price_tiers'] = [
            {'min_guests': t.min_guests, 'price_per_head': str(t.price_per_head)}
            for t in instance.price_tiers.all()
        ]
        return data

    @transaction.atomic
    def create(self, validated_data):
        nested = self._pop_nested(validated_data)
        template = MenuTemplate.objects.create(**validated_data)
        self._sync(template, **nested)
        return template

    @transaction.atomic
    def update(self, instance, validated_data):
        nested = self._pop_nested(validated_data)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        self._sync(instance, **nested)
        return instance

    @staticmethod
    def _pop_nested(validated_data):
        return {
            'courses': validated_data.pop('courses', None),
            'dishes': validated_data.pop('dishes', None),
            'price_tiers': validated_data.pop('price_tiers', None),
        }

    def _sync(self, template, courses, dishes, price_tiers):
        if courses is not None:
            template.courses.all().delete()
            course_objs = [
                MenuCourse.objects.create(
                    menu=template, name=c.get('name', ''), sort_order=c.get('sort_order', i),
                )
                for i, c in enumerate(courses)
            ]
        else:
            course_objs = list(template.courses.all())

        if dishes is not None:
            template.portions.all().delete()
            grams = _auto_portion_grams(template, [d['dish_id'] for d in dishes])
            for d in dishes:
                idx = d.get('course')
                course = course_objs[idx] if (isinstance(idx, int) and 0 <= idx < len(course_objs)) else None
                MenuDishPortion.objects.create(
                    menu=template, dish_id=d['dish_id'],
                    portion_grams=grams.get(d['dish_id'], 0), course=course,
                )

        if price_tiers is not None:
            template.price_tiers.all().delete()
            for t in price_tiers:
                MenuTemplatePriceTier.objects.create(
                    menu=template, min_guests=t['min_guests'], price_per_head=t['price_per_head'],
                )
