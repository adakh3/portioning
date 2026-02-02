from rest_framework import serializers
from .models import Event, EventConstraintOverride
from dishes.models import Dish


class EventConstraintOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventConstraintOverride
        fields = ['max_total_food_per_person_grams', 'min_portion_per_dish_grams']


class EventSerializer(serializers.ModelSerializer):
    constraint_override = EventConstraintOverrideSerializer(required=False)
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.all(), write_only=True, required=False
    )

    class Meta:
        model = Event
        fields = ['id', 'name', 'date', 'gents', 'ladies',
                  'big_eaters', 'big_eaters_percentage',
                  'dishes', 'dish_ids', 'based_on_template', 'notes',
                  'constraint_override', 'created_at']
        read_only_fields = ['created_at']

    def create(self, validated_data):
        override_data = validated_data.pop('constraint_override', None)
        dishes = validated_data.pop('dishes', [])
        event = Event.objects.create(**validated_data)
        if dishes:
            event.dishes.set(dishes)
        if override_data:
            EventConstraintOverride.objects.create(event=event, **override_data)
        return event

    def update(self, instance, validated_data):
        override_data = validated_data.pop('constraint_override', None)
        dishes = validated_data.pop('dishes', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if dishes is not None:
            instance.dishes.set(dishes)
        if override_data is not None:
            EventConstraintOverride.objects.update_or_create(
                event=instance, defaults=override_data
            )
        return instance
