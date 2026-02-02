from rest_framework import serializers


class GuestMixSerializer(serializers.Serializer):
    gents = serializers.IntegerField(min_value=0, default=0)
    ladies = serializers.IntegerField(min_value=0, default=0)


class ConstraintOverrideSerializer(serializers.Serializer):
    max_total_food_per_person_grams = serializers.FloatField(required=False)
    min_portion_per_dish_grams = serializers.FloatField(required=False)


class CalculateRequestSerializer(serializers.Serializer):
    dish_ids = serializers.ListField(child=serializers.IntegerField(), min_length=1)
    guests = GuestMixSerializer()
    big_eaters = serializers.BooleanField(default=False)
    big_eaters_percentage = serializers.FloatField(default=20.0, min_value=0, max_value=100)
    constraint_overrides = ConstraintOverrideSerializer(required=False, default={})


class UserPortionSerializer(serializers.Serializer):
    dish_id = serializers.IntegerField()
    grams_per_person = serializers.FloatField(min_value=0)


class CheckPortionsRequestSerializer(serializers.Serializer):
    dish_ids = serializers.ListField(child=serializers.IntegerField(), min_length=1)
    guests = GuestMixSerializer()
    user_portions = serializers.ListField(child=UserPortionSerializer(), min_length=1)
    big_eaters = serializers.BooleanField(default=False)
    big_eaters_percentage = serializers.FloatField(default=20.0, min_value=0, max_value=100)
    constraint_overrides = ConstraintOverrideSerializer(required=False, default={})

    def validate(self, data):
        dish_id_set = set(data['dish_ids'])
        portion_ids = set(p['dish_id'] for p in data['user_portions'])
        missing = dish_id_set - portion_ids
        extra = portion_ids - dish_id_set
        if missing:
            raise serializers.ValidationError(
                f"Missing portions for dish IDs: {sorted(missing)}"
            )
        if extra:
            raise serializers.ValidationError(
                f"Extra portions for dish IDs not in dish_ids: {sorted(extra)}"
            )
        return data


class ExportPDFRequestSerializer(CalculateRequestSerializer):
    menu_name = serializers.CharField(max_length=200, default='Custom Menu')
    date = serializers.CharField(max_length=20, required=False, default=None, allow_null=True)
