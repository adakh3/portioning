from rest_framework import serializers
from .models import Event, EventConstraintOverride, EventDishComment, EventMeal, EventMealDishComment, EventPayment
from dishes.models import Dish
from staff.serializers import ShiftSerializer
from equipment.serializers import EquipmentReservationSerializer
from bookings.serializers.finance import InvoiceSerializer
from bookings.serializers.quotes import BookingLineItemSerializer
from bookings.models import BookingLineItem
from users.mixins import get_request_org
from users.serializer_mixins import OrgScopedModelSerializer


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


class EventMealDishCommentSerializer(serializers.ModelSerializer):
    dish_id = serializers.PrimaryKeyRelatedField(source='dish', queryset=Dish.objects.none())
    dish_name = serializers.CharField(source='dish.name', read_only=True)

    class Meta:
        model = EventMealDishComment
        fields = ['dish_id', 'dish_name', 'comment', 'portion_grams']
        extra_kwargs = {'comment': {'max_length': 2000}}


class EventMealSerializer(serializers.ModelSerializer):
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.none(), write_only=True, required=False
    )
    dish_comments = EventMealDishCommentSerializer(many=True, required=False)

    class Meta:
        model = EventMeal
        fields = ['id', 'label', 'guest_count', 'price_per_head', 'dishes', 'dish_ids',
                  'based_on_template', 'meal_time', 'notes', 'dish_comments']
        extra_kwargs = {'notes': {'max_length': 5000}}


class EventPaymentSerializer(OrgScopedModelSerializer):
    """A client payment recorded against an event (advance / part / full)."""
    received_by_name = serializers.SerializerMethodField()
    method_display = serializers.CharField(source='get_method_display', read_only=True)

    class Meta:
        model = EventPayment
        fields = [
            'id', 'event', 'amount', 'payment_date',
            'method', 'method_display', 'received_by', 'received_by_name',
            'reference', 'notes', 'created_at',
        ]
        read_only_fields = ['created_at']
        extra_kwargs = {
            'event': {'required': False},  # set from the URL in the view
            'notes': {'max_length': 5000},
        }

    def get_received_by_name(self, obj):
        u = obj.received_by
        return f"{u.first_name} {u.last_name}".strip() or u.email if u else None


class EventSerializer(OrgScopedModelSerializer):
    constraint_override = EventConstraintOverrideSerializer(required=False)
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.none(), write_only=True, required=False
    )
    dish_comments = EventDishCommentSerializer(many=True, required=False)
    line_items = BookingLineItemSerializer(many=True, required=False)
    additional_meals = EventMealSerializer(many=True, required=False)

    # Read-only computed fields
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)
    contact_name = serializers.CharField(source='primary_contact.name', read_only=True, default=None)
    venue_name = serializers.CharField(source='venue.name', read_only=True, default=None)
    product_name = serializers.CharField(source='product.name', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source_quote_id = serializers.SerializerMethodField()
    assigned_to_name = serializers.SerializerMethodField()

    # Nested read-only relations
    shifts = ShiftSerializer(many=True, read_only=True)
    equipment_reservations = EquipmentReservationSerializer(many=True, read_only=True)
    invoices = InvoiceSerializer(many=True, read_only=True)
    # Client payment tracking (advances / part / full)
    payments = EventPaymentSerializer(many=True, read_only=True)
    amount_paid = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    balance_due = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    payment_status = serializers.CharField(read_only=True)

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
            self.fields['additional_meals'].child.fields['dish_ids'].child_relation.queryset = dish_qs

    def validate(self, attrs):
        attrs = super().validate(attrs)
        is_b2b = attrs.get('is_b2b', getattr(self.instance, 'is_b2b', False))
        account = attrs.get('account', getattr(self.instance, 'account', None))
        if is_b2b and not account:
            raise serializers.ValidationError(
                {'account': 'A business is required for a B2B event.'}
            )
        return attrs

    def get_assigned_to_name(self, obj):
        u = obj.assigned_to
        return f"{u.first_name} {u.last_name}".strip() if u else None

    class Meta:
        model = Event
        fields = ['id', 'name', 'date', 'gents', 'ladies',
                  'big_eaters', 'big_eaters_percentage',
                  'dishes', 'dish_ids', 'based_on_template', 'notes',
                  'kitchen_instructions', 'banquet_instructions', 'setup_instructions',
                  'constraint_override', 'dish_comments', 'line_items', 'created_at',
                  # Booking fields
                  'primary_contact', 'contact_name',
                  'is_b2b', 'account', 'account_name',
                  'venue', 'venue_name', 'venue_address',
                  'product', 'product_name',
                  'assigned_to', 'assigned_to_name',
                  'event_type', 'meal_type', 'service_style', 'booking_date', 'price_per_head',
                  'status', 'status_display', 'is_taxable', 'tax_rate',
                  'subtotal', 'tax_amount', 'total',
                  # Timeline
                  'setup_time', 'guest_arrival_time', 'meal_time', 'end_time',
                  # Guest counts
                  'guaranteed_count', 'final_count', 'final_count_due',
                  # Nested
                  'additional_meals',
                  'source_quote_id', 'shifts', 'equipment_reservations', 'invoices',
                  # Client payments
                  'payments', 'amount_paid', 'balance_due', 'payment_status']
        read_only_fields = ['created_at', 'subtotal', 'tax_amount', 'total']
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
        line_items_data = validated_data.pop('line_items', [])
        meals_data = validated_data.pop('additional_meals', [])
        # Default the tax rate to the org's standard rate so a taxable event taxes
        # consistently with quotes / the rest of the app.
        if 'tax_rate' not in validated_data and validated_data.get('organisation'):
            from bookings.models import OrgSettings
            validated_data['tax_rate'] = OrgSettings.for_org(validated_data['organisation']).default_tax_rate
        event = Event.objects.create(**validated_data)
        if dishes:
            event.dishes.set(dishes)
        if override_data:
            EventConstraintOverride.objects.create(event=event, **override_data)
        for dc in dish_comments_data:
            EventDishComment.objects.create(event=event, **dc)
        self._save_line_items(event, line_items_data)
        for meal in meals_data:
            self._create_meal(event, meal)
        event.recalculate_totals()  # food + meals + line items + tax (shared engine)
        return event

    def update(self, instance, validated_data):
        override_data = validated_data.pop('constraint_override', None)
        dishes = validated_data.pop('dishes', None)
        dish_comments_data = validated_data.pop('dish_comments', None)
        line_items_data = validated_data.pop('line_items', None)
        meals_data = validated_data.pop('additional_meals', None)

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
        if line_items_data is not None:
            self._save_line_items(instance, line_items_data)

        if meals_data is not None:
            instance.additional_meals.all().delete()
            for meal in meals_data:
                self._create_meal(instance, meal)

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

        instance.recalculate_totals()  # food + meals + line items + tax (shared engine)
        return instance

    @staticmethod
    def _save_line_items(event, items_data):
        """Replace the event's add-on line items. Each BookingLineItem.save()
        recomputes its line_total."""
        event.line_items.all().delete()
        for item in items_data:
            fields = {k: v for k, v in item.items() if k not in ('id', 'quote', 'event')}
            BookingLineItem.objects.create(event=event, **fields)

    @staticmethod
    def _create_meal(event, meal_data):
        dishes = meal_data.pop('dishes', [])
        dish_comments = meal_data.pop('dish_comments', [])
        meal = EventMeal.objects.create(event=event, **meal_data)
        if dishes:
            meal.dishes.set(dishes)
        for dc in dish_comments:
            EventMealDishComment.objects.create(meal=meal, **dc)
        return meal


EVENT_LIST_EXCLUDE = {
    'shifts', 'equipment_reservations', 'invoices',
    'dish_comments', 'constraint_override',
    'dish_ids', 'line_items', 'additional_meals',
    # computed name needs a per-row fetch; the list keeps the cheap assigned_to pk
    'assigned_to_name',
    # payment detail + balance read event.payments per row — detail-view only
    'payments', 'amount_paid', 'balance_due', 'payment_status',
}


class EventListSerializer(serializers.ModelSerializer):
    """Lighter serializer for event list views."""
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)
    contact_name = serializers.CharField(source='primary_contact.name', read_only=True, default=None)
    venue_name = serializers.CharField(source='venue.name', read_only=True, default=None)
    product_name = serializers.CharField(source='product.name', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source_quote_id = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [f for f in EventSerializer.Meta.fields if f not in EVENT_LIST_EXCLUDE]
        read_only_fields = ['created_at']

    def get_source_quote_id(self, obj):
        quote = getattr(obj, 'source_quote', None)
        return quote.id if quote else None
