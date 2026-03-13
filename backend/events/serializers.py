from rest_framework import serializers
from .models import Event, EventConstraintOverride, EventDishComment, EventArrangement, EventBeverage
from dishes.models import Dish
from staff.serializers import ShiftSerializer
from equipment.serializers import EquipmentReservationSerializer
from bookings.serializers.finance import InvoiceSerializer
from users.mixins import get_request_org


class EventConstraintOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventConstraintOverride
        fields = ['max_total_food_per_person_grams', 'min_portion_per_dish_grams']


class EventDishCommentSerializer(serializers.ModelSerializer):
    dish_id = serializers.PrimaryKeyRelatedField(source='dish', queryset=Dish.objects.none())
    dish_name = serializers.CharField(source='dish.name', read_only=True)

    class Meta:
        model = EventDishComment
        fields = ['dish_id', 'dish_name', 'comment', 'portion_grams']
        extra_kwargs = {'comment': {'max_length': 2000}}


class EventArrangementSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventArrangement
        fields = ['id', 'arrangement_type', 'quantity', 'unit_price', 'notes']
        extra_kwargs = {'notes': {'max_length': 2000}}


class EventBeverageSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventBeverage
        fields = ['id', 'beverage_type', 'quantity', 'unit_price', 'notes']
        extra_kwargs = {'notes': {'max_length': 2000}}


class EventSerializer(serializers.ModelSerializer):
    constraint_override = EventConstraintOverrideSerializer(required=False)
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.none(), write_only=True, required=False
    )
    dish_comments = EventDishCommentSerializer(many=True, required=False)
    arrangements = EventArrangementSerializer(many=True, required=False)
    beverages = EventBeverageSerializer(many=True, required=False)

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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request:
            org = get_request_org(request)
            if org:
                dish_qs = Dish.objects.filter(organisation=org)
            else:
                dish_qs = Dish.objects.all()
            self.fields['dish_ids'].child_relation.queryset = dish_qs

    class Meta:
        model = Event
        fields = ['id', 'name', 'date', 'gents', 'ladies',
                  'big_eaters', 'big_eaters_percentage',
                  'dishes', 'dish_ids', 'based_on_template', 'notes',
                  'kitchen_instructions', 'banquet_instructions', 'setup_instructions',
                  'constraint_override', 'dish_comments', 'arrangements', 'beverages', 'created_at',
                  # Booking fields
                  'account', 'account_name',
                  'primary_contact', 'contact_name',
                  'venue', 'venue_name', 'venue_address',
                  'event_type', 'meal_type', 'service_style', 'booking_date', 'price_per_head',
                  'status', 'status_display', 'is_taxable',
                  # Timeline
                  'setup_time', 'guest_arrival_time', 'meal_time', 'end_time',
                  # Guest counts
                  'guaranteed_count', 'final_count', 'final_count_due',
                  # Nested
                  'source_quote_id', 'shifts', 'equipment_reservations', 'invoices']
        read_only_fields = ['created_at']
        extra_kwargs = {
            'notes': {'max_length': 5000},
            'kitchen_instructions': {'max_length': 5000},
            'banquet_instructions': {'max_length': 5000},
            'setup_instructions': {'max_length': 5000},
            'venue_address': {'max_length': 1000},
        }

    def get_source_quote_id(self, obj):
        quote = getattr(obj, 'source_quote', None)
        return quote.id if quote else None

    def create(self, validated_data):
        override_data = validated_data.pop('constraint_override', None)
        dishes = validated_data.pop('dishes', [])
        dish_comments_data = validated_data.pop('dish_comments', [])
        arrangements_data = validated_data.pop('arrangements', [])
        beverages_data = validated_data.pop('beverages', [])
        event = Event.objects.create(**validated_data)
        if dishes:
            event.dishes.set(dishes)
        if override_data:
            EventConstraintOverride.objects.create(event=event, **override_data)
        for dc in dish_comments_data:
            EventDishComment.objects.create(event=event, **dc)
        for arr in arrangements_data:
            EventArrangement.objects.create(event=event, **arr)
        for bev in beverages_data:
            EventBeverage.objects.create(event=event, **bev)
        return event

    def update(self, instance, validated_data):
        override_data = validated_data.pop('constraint_override', None)
        dishes = validated_data.pop('dishes', None)
        dish_comments_data = validated_data.pop('dish_comments', None)
        arrangements_data = validated_data.pop('arrangements', None)
        beverages_data = validated_data.pop('beverages', None)

        old_status = instance.status
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
        if arrangements_data is not None:
            # Replace all arrangements
            instance.arrangements.all().delete()
            for arr in arrangements_data:
                EventArrangement.objects.create(event=instance, **arr)
        if beverages_data is not None:
            # Replace all beverages
            instance.beverages.all().delete()
            for bev in beverages_data:
                EventBeverage.objects.create(event=instance, **bev)

        # Auto-calculate portions when status changes to confirmed
        # and event has dishes but no existing dish_comments
        new_status = instance.status
        if (new_status == 'confirmed' and old_status != 'confirmed'
                and instance.dishes.exists()
                and not instance.dish_comments.exists()
                and dish_comments_data is None):
            from calculator.engine.calculator import calculate_portions
            result = calculate_portions(
                dish_ids=list(instance.dishes.values_list('id', flat=True)),
                guests={'gents': instance.gents, 'ladies': instance.ladies},
                org=instance.organisation,
            )
            for p in result['portions']:
                EventDishComment.objects.create(
                    event=instance,
                    dish_id=p['dish_id'],
                    portion_grams=p['grams_per_person'],
                )

        return instance
