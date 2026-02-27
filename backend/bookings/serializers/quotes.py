from rest_framework import serializers

from bookings.models import Quote, QuoteLineItem
from dishes.models import Dish


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
        extra_kwargs = {'quote': {'required': False}}


class QuoteSerializer(serializers.ModelSerializer):
    line_items = QuoteLineItemSerializer(many=True, read_only=True)
    account_name = serializers.CharField(source='account.name', read_only=True)
    contact_name = serializers.CharField(source='primary_contact.name', read_only=True, default=None)
    contact_email = serializers.CharField(source='primary_contact.email', read_only=True, default=None)
    contact_phone = serializers.CharField(source='primary_contact.phone', read_only=True, default=None)
    venue_name = serializers.CharField(source='venue.name', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    is_editable = serializers.BooleanField(read_only=True)
    lead_name = serializers.SerializerMethodField()
    event_id = serializers.IntegerField(source='event.id', read_only=True, default=None)

    food_total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    # Menu fields
    dish_ids = serializers.PrimaryKeyRelatedField(
        many=True, source='dishes', queryset=Dish.objects.all(),
        write_only=True, required=False,
    )
    dish_names = serializers.SerializerMethodField()

    class Meta:
        model = Quote
        fields = [
            'id', 'lead', 'lead_name', 'account', 'account_name',
            'primary_contact', 'contact_name', 'contact_email', 'contact_phone',
            'version', 'status', 'status_display', 'is_editable',
            'event_date', 'venue', 'venue_name', 'venue_address', 'guest_count',
            'price_per_head', 'food_total',
            'event_type', 'service_style', 'valid_until',
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

    def get_lead_name(self, obj):
        if obj.lead:
            lead = obj.lead
            return f"{lead.contact_name} — {lead.get_event_type_display()}"
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
