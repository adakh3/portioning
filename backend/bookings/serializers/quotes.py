from rest_framework import serializers

from bookings.models import Quote, BookingLineItem
from bookings.serializers.leads import _get_event_type_labels
from bookings.serializers.meals import BookingMealSerializer, replace_meals
from dishes.models import Dish
from dishes.ordering import dish_ids_in_added_order, dish_names_in_added_order
from users.mixins import get_request_org
from users.serializer_mixins import OrgScopedModelSerializer


class BookingLineItemSerializer(OrgScopedModelSerializer):
    # Writable so the parent serializer can match existing rows on a nested save
    # (default `id` is read-only). Unused by the standalone line-item endpoints,
    # which take the id from the URL.
    id = serializers.IntegerField(required=False)

    class Meta:
        model = BookingLineItem
        fields = [
            'id', 'quote', 'event', 'variant', 'category', 'description',
            'quantity', 'unit', 'unit_price',
            'line_total', 'sort_order',
            'menu_item', 'equipment_item', 'labor_role',
            'created_at',
        ]
        read_only_fields = ['line_total', 'created_at']
        extra_kwargs = {
            'quote': {'required': False},
            'event': {'required': False},
            'description': {'max_length': 500, 'required': False, 'allow_blank': True},
        }


# Back-compat alias (the standalone /quotes/<id>/items/ endpoints import this name).
QuoteLineItemSerializer = BookingLineItemSerializer


class QuoteSerializer(OrgScopedModelSerializer):
    line_items = BookingLineItemSerializer(many=True, required=False)
    account_name = serializers.SerializerMethodField()
    contact_name = serializers.SerializerMethodField()
    contact_email = serializers.SerializerMethodField()
    contact_phone = serializers.SerializerMethodField()
    venue_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True, default=None)
    is_editable = serializers.BooleanField(read_only=True)
    lead_name = serializers.SerializerMethodField()
    event_id = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    assigned_to_name = serializers.SerializerMethodField()

    food_total = serializers.SerializerMethodField()

    # Menu fields
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.none(),
        write_only=True, required=False,
    )
    dish_names = serializers.SerializerMethodField()
    # Additional meals — same shared booking field as events.
    additional_meals = BookingMealSerializer(many=True, required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request and 'dish_ids' in self.fields:
            org = get_request_org(request)
            dish_qs = Dish.objects.filter(organisation=org) if org else Dish.objects.none()
            self.fields['dish_ids'].child_relation.queryset = dish_qs
            if 'additional_meals' in self.fields:
                self.fields['additional_meals'].child.fields['dish_ids'].child_relation.queryset = dish_qs

    class Meta:
        model = Quote
        fields = [
            'id', 'lead', 'lead_name',
            'primary_contact', 'contact_name', 'contact_email', 'contact_phone',
            'is_b2b', 'account', 'account_name',
            'version', 'status', 'status_display', 'is_editable',
            'event_date', 'venue', 'venue_name', 'venue_address',
            'product', 'product_name', 'guest_count',
            'gents', 'ladies', 'big_eaters', 'big_eaters_percentage',
            'price_per_head', 'food_total',
            'event_type', 'meal_type', 'booking_date', 'service_style', 'valid_until',
            'setup_time', 'guest_arrival_time', 'meal_time', 'end_time',
            'is_taxable', 'subtotal', 'tax_rate', 'tax_amount', 'total',
            'dishes', 'dish_ids', 'dish_names', 'based_on_template',
            'additional_meals',
            'notes', 'internal_notes',
            'sent_at', 'accepted_at',
            'event', 'event_id',
            'created_by', 'created_by_name',
            'assigned_to', 'assigned_to_name',
            'line_items', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'status', 'subtotal', 'tax_amount', 'total',
            'sent_at', 'accepted_at', 'event',
            'created_by',
            'created_at', 'updated_at',
        ]
        extra_kwargs = {
            'notes': {'max_length': 5000},
            'internal_notes': {'max_length': 5000},
            'venue_address': {'max_length': 1000},
        }

    def validate(self, attrs):
        attrs = super().validate(attrs)
        is_b2b = attrs.get('is_b2b', getattr(self.instance, 'is_b2b', False))
        account = attrs.get('account', getattr(self.instance, 'account', None))
        if is_b2b and not account:
            raise serializers.ValidationError(
                {'account': 'A business is required for a B2B quote.'}
            )
        return attrs

    def get_account_name(self, obj):
        return obj.account.name if obj.account_id else None

    def get_food_total(self, obj):
        try:
            val = obj.food_total
            return str(val) if val is not None else '0.00'
        except Exception:
            return None

    def get_contact_name(self, obj):
        return obj.primary_contact.name if obj.primary_contact else None

    def get_contact_email(self, obj):
        return obj.primary_contact.email if obj.primary_contact else None

    def get_contact_phone(self, obj):
        return obj.primary_contact.phone if obj.primary_contact else None

    def get_venue_name(self, obj):
        return obj.venue.name if obj.venue else None

    def get_event_id(self, obj):
        return obj.event_id

    def get_created_by_name(self, obj):
        u = obj.created_by
        if not u:
            return None
        return (u.get_full_name() or "").strip() or u.email

    def get_assigned_to_name(self, obj):
        u = obj.assigned_to
        if not u:
            return None
        return (u.get_full_name() or "").strip() or u.email

    def get_lead_name(self, obj):
        try:
            if obj.lead:
                lead = obj.lead
                et_label = _get_event_type_labels(obj.organisation_id).get(lead.event_type, lead.event_type)
                return f"{lead.contact_name} — {et_label}"
        except Exception:
            return None
        return None

    def get_dish_names(self, obj):
        return dish_names_in_added_order(obj)

    def to_representation(self, instance):
        # Present dishes in the order they were added, not Dish's alphabetical default.
        data = super().to_representation(instance)
        if 'dishes' in data:
            data['dishes'] = dish_ids_in_added_order(instance)
        return data

    @staticmethod
    def _save_line_items(quote, items_data):
        """Reconcile nested line items in one pass: update rows by id, create
        rows without an id, delete existing rows absent from the payload."""
        existing = {li.id: li for li in quote.line_items.all()}
        keep_ids = set()
        for item in items_data:
            item_id = item.get('id')
            fields = {k: v for k, v in item.items() if k not in ('id', 'quote')}
            if item_id and item_id in existing:
                li = existing[item_id]
                for k, v in fields.items():
                    setattr(li, k, v)
                li.save()  # recomputes line_total + quote totals
                keep_ids.add(item_id)
            else:
                BookingLineItem.objects.create(quote=quote, **fields)
        for li_id, li in existing.items():
            if li_id not in keep_ids:
                li.delete()

    def create(self, validated_data):
        dishes = validated_data.pop('dishes', [])
        line_items_data = validated_data.pop('line_items', None)
        meals_data = validated_data.pop('additional_meals', None)
        quote = super().create(validated_data)
        if dishes:
            quote.dishes.set(dishes)
        if line_items_data:
            self._save_line_items(quote, line_items_data)
        if meals_data is not None:
            replace_meals('quote', quote, meals_data)
        quote.recalculate_totals()
        return quote

    def update(self, instance, validated_data):
        dishes = validated_data.pop('dishes', None)
        line_items_data = validated_data.pop('line_items', None)
        meals_data = validated_data.pop('additional_meals', None)
        quote = super().update(instance, validated_data)
        if dishes is not None:
            quote.dishes.set(dishes)
        if line_items_data is not None:
            self._save_line_items(quote, line_items_data)
        if meals_data is not None:
            replace_meals('quote', quote, meals_data)
        quote.recalculate_totals()
        return quote


QUOTE_LIST_EXCLUDE = {'line_items', 'dishes', 'dish_ids', 'dish_names', 'additional_meals'}


class QuoteListSerializer(QuoteSerializer):
    """Lighter serializer for list views — excludes line_items and dish fields."""

    class Meta(QuoteSerializer.Meta):
        fields = [f for f in QuoteSerializer.Meta.fields if f not in QUOTE_LIST_EXCLUDE]
