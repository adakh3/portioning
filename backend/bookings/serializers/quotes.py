from rest_framework import serializers

from bookings.models import Quote, QuoteLineItem
from bookings.models.choices import EventTypeOption
from dishes.models import Dish
from users.mixins import get_request_org


class QuoteLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuoteLineItem
        fields = [
            'id', 'quote', 'category', 'description',
            'quantity', 'unit', 'unit_price', 'is_taxable',
            'line_total', 'sort_order',
            'menu_item', 'equipment_item', 'labor_role',
            'created_at',
        ]
        read_only_fields = ['line_total', 'created_at']
        extra_kwargs = {
            'quote': {'required': False},
            'description': {'max_length': 500},
        }


class QuoteSerializer(serializers.ModelSerializer):
    line_items = QuoteLineItemSerializer(many=True, read_only=True)
    account_name = serializers.CharField(source='account.name', read_only=True)
    contact_name = serializers.SerializerMethodField()
    contact_email = serializers.SerializerMethodField()
    contact_phone = serializers.SerializerMethodField()
    venue_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    is_editable = serializers.BooleanField(read_only=True)
    lead_name = serializers.SerializerMethodField()
    event_id = serializers.SerializerMethodField()

    food_total = serializers.SerializerMethodField()

    # Menu fields
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.none(),
        write_only=True, required=False,
    )
    dish_names = serializers.SerializerMethodField()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request:
            org = get_request_org(request)
            if org:
                self.fields['dish_ids'].child_relation.queryset = Dish.objects.filter(organisation=org)
            else:
                self.fields['dish_ids'].child_relation.queryset = Dish.objects.all()

    class Meta:
        model = Quote
        fields = [
            'id', 'lead', 'lead_name', 'account', 'account_name',
            'primary_contact', 'contact_name', 'contact_email', 'contact_phone',
            'version', 'status', 'status_display', 'is_editable',
            'event_date', 'venue', 'venue_name', 'venue_address', 'guest_count',
            'price_per_head', 'food_total',
            'event_type', 'meal_type', 'booking_date', 'service_style', 'valid_until',
            'subtotal', 'tax_rate', 'tax_amount', 'total',
            'dishes', 'dish_ids', 'dish_names', 'based_on_template',
            'notes', 'internal_notes',
            'sent_at', 'accepted_at',
            'event', 'event_id',
            'line_items', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'status', 'subtotal', 'tax_amount', 'total',
            'sent_at', 'accepted_at', 'event',
            'created_at', 'updated_at',
        ]
        extra_kwargs = {
            'notes': {'max_length': 5000},
            'internal_notes': {'max_length': 5000},
            'venue_address': {'max_length': 1000},
        }

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

    def get_lead_name(self, obj):
        try:
            if obj.lead:
                lead = obj.lead
                et_label = (
                    EventTypeOption.objects.filter(
                        value=lead.event_type, organisation=obj.organisation,
                    ).values_list('label', flat=True).first()
                    or lead.event_type
                )
                return f"{lead.contact_name} — {et_label}"
        except Exception:
            return None
        return None

    def get_dish_names(self, obj):
        return list(obj.dishes.values_list('name', flat=True))

    def create(self, validated_data):
        dishes = validated_data.pop('dishes', [])
        quote = super().create(validated_data)
        if dishes:
            quote.dishes.set(dishes)
        # Recalculate totals if price_per_head was set
        if quote.price_per_head:
            quote.recalculate_totals()
        return quote

    def update(self, instance, validated_data):
        dishes = validated_data.pop('dishes', None)
        needs_recalc = 'price_per_head' in validated_data or 'guest_count' in validated_data or 'tax_rate' in validated_data
        quote = super().update(instance, validated_data)
        if dishes is not None:
            quote.dishes.set(dishes)
        if needs_recalc:
            quote.recalculate_totals()
        return quote
