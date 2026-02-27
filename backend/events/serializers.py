from rest_framework import serializers
from .models import Event, EventConstraintOverride, EventDishComment
from dishes.models import Dish
from bookings.serializers.staffing import ShiftSerializer
from bookings.serializers.equipment import EquipmentReservationSerializer
from bookings.serializers.finance import InvoiceSerializer


class EventConstraintOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventConstraintOverride
        fields = ['max_total_food_per_person_grams', 'min_portion_per_dish_grams']


class EventDishCommentSerializer(serializers.ModelSerializer):
    dish_id = serializers.PrimaryKeyRelatedField(source='dish', queryset=Dish.objects.all())
    dish_name = serializers.CharField(source='dish.name', read_only=True)

    class Meta:
        model = EventDishComment
        fields = ['dish_id', 'dish_name', 'comment', 'portion_grams']


class EventSerializer(serializers.ModelSerializer):
    constraint_override = EventConstraintOverrideSerializer(required=False)
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.all(), write_only=True, required=False
    )
    dish_comments = EventDishCommentSerializer(many=True, required=False)

    # Read-only computed fields
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)
    contact_name = serializers.CharField(source='primary_contact.name', read_only=True, default=None)
    venue_name = serializers.CharField(source='venue.name', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source_quote_id = serializers.SerializerMethodField()

    # Nested read-only relations
    shifts = ShiftSerializer(many=True, read_only=True)
    equipment_reservations = EquipmentReservationSerializer(many=True, read_only=True)
    invoices = InvoiceSerializer(many=True, read_only=True)

    class Meta:
        model = Event
        fields = ['id', 'name', 'date', 'gents', 'ladies',
                  'big_eaters', 'big_eaters_percentage',
                  'dishes', 'dish_ids', 'based_on_template', 'notes',
                  'constraint_override', 'dish_comments', 'created_at',
                  # Booking fields
                  'account', 'account_name',
                  'primary_contact', 'contact_name',
                  'venue', 'venue_name', 'venue_address',
                  'event_type', 'service_style', 'price_per_head',
                  'status', 'status_display',
                  # Timeline
                  'setup_time', 'guest_arrival_time', 'meal_time', 'end_time',
                  # Guest counts
                  'guaranteed_count', 'final_count', 'final_count_due',
                  # Nested
                  'source_quote_id', 'shifts', 'equipment_reservations', 'invoices']
        read_only_fields = ['created_at']

    def get_source_quote_id(self, obj):
        quote = getattr(obj, 'source_quote', None)
        return quote.id if quote else None

    def create(self, validated_data):
        override_data = validated_data.pop('constraint_override', None)
        dishes = validated_data.pop('dishes', [])
        dish_comments_data = validated_data.pop('dish_comments', [])
        event = Event.objects.create(**validated_data)
        if dishes:
            event.dishes.set(dishes)
        if override_data:
            EventConstraintOverride.objects.create(event=event, **override_data)
        for dc in dish_comments_data:
            EventDishComment.objects.create(event=event, **dc)
        return event

    def update(self, instance, validated_data):
        override_data = validated_data.pop('constraint_override', None)
        dishes = validated_data.pop('dishes', None)
        dish_comments_data = validated_data.pop('dish_comments', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if dishes is not None:
            instance.dishes.set(dishes)
        if override_data is not None:
            EventConstraintOverride.objects.update_or_create(
                event=instance, defaults=override_data
            )
        if dish_comments_data is not None:
            # Replace all dish comments
            instance.dish_comments.all().delete()
            for dc in dish_comments_data:
                EventDishComment.objects.create(event=instance, **dc)
        return instance
