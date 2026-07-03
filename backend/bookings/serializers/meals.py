"""Shared serializers for a booking's additional meals (BookingMeal), used by BOTH
the Quote and Event serializers. Lives in `bookings` (not `events`) so quotes can
nest meals without an events→bookings→events import cycle."""
from rest_framework import serializers

from dishes.models import Dish
from events.models import BookingMeal, BookingMealDishComment


class BookingMealDishCommentSerializer(serializers.ModelSerializer):
    dish_id = serializers.PrimaryKeyRelatedField(source='dish', queryset=Dish.objects.none())
    dish_name = serializers.CharField(source='dish.name', read_only=True)

    class Meta:
        model = BookingMealDishComment
        fields = ['dish_id', 'dish_name', 'comment', 'portion_grams']
        extra_kwargs = {'comment': {'max_length': 2000}}


class BookingMealSerializer(serializers.ModelSerializer):
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.none(), write_only=True, required=False
    )
    dish_comments = BookingMealDishCommentSerializer(many=True, required=False)

    class Meta:
        model = BookingMeal
        fields = ['id', 'label', 'guest_count', 'price_per_head', 'dishes', 'dish_ids',
                  'based_on_template', 'meal_time', 'notes', 'dish_comments']
        extra_kwargs = {
            'notes': {'max_length': 5000},
            'label': {'required': False, 'allow_blank': True},
        }


def replace_meals(parent_field, parent_obj, meals_data):
    """Replace a booking's additional meals. ``parent_field`` is 'quote' or 'event'.
    Same nested-write semantics for both kinds of booking (delete-all + recreate)."""
    parent_obj.additional_meals.all().delete()
    for meal_data in meals_data:
        dishes = meal_data.pop('dishes', [])
        dish_comments = meal_data.pop('dish_comments', [])
        meal = BookingMeal.objects.create(**{parent_field: parent_obj}, **meal_data)
        if dishes:
            meal.dishes.set(dishes)
        for dc in dish_comments:
            BookingMealDishComment.objects.create(meal=meal, **dc)
