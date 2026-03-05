from rest_framework import serializers

from bookings.models import Lead, Quote
from bookings.models.leads import ProductLine
from bookings.models.choices import EventTypeOption, LeadStatusOption


class LeadQuoteSummarySerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Quote
        fields = ['id', 'status', 'status_display', 'total', 'created_at']
        read_only_fields = fields


class ProductLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductLine
        fields = ['id', 'name', 'is_active']
        read_only_fields = ['id']


# Cache for choice lookups (populated once per process)
_event_type_cache = None
_lead_status_cache = None


def _get_event_type_labels():
    global _event_type_cache
    if _event_type_cache is None:
        _event_type_cache = dict(EventTypeOption.objects.values_list('value', 'label'))
    return _event_type_cache


def _get_lead_status_labels():
    global _lead_status_cache
    if _lead_status_cache is None:
        _lead_status_cache = dict(LeadStatusOption.objects.values_list('value', 'label'))
    return _lead_status_cache


class LeadSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)
    status_display = serializers.SerializerMethodField()
    event_type_display = serializers.SerializerMethodField()
    product_name = serializers.CharField(source='product.name', read_only=True, default=None)
    assigned_to_name = serializers.SerializerMethodField()
    quotes = LeadQuoteSummarySerializer(many=True, read_only=True)

    class Meta:
        model = Lead
        fields = [
            'id', 'account', 'account_name',
            'contact_name', 'contact_email', 'contact_phone',
            'source', 'event_date', 'lead_date', 'guest_estimate',
            'budget',
            'event_type', 'event_type_display',
            'service_style', 'notes',
            'product', 'product_name',
            'assigned_to', 'assigned_to_name',
            'status', 'status_display',
            'converted_to_quote', 'lost_reason',
            'contacted_at', 'qualified_at', 'converted_at', 'lost_at',
            'created_at', 'updated_at',
            'quotes',
        ]
        read_only_fields = [
            'status', 'converted_to_quote',
            'contacted_at', 'qualified_at', 'converted_at', 'lost_at',
            'created_at', 'updated_at',
        ]

    def get_status_display(self, obj):
        return _get_lead_status_labels().get(obj.status, obj.status)

    def get_event_type_display(self, obj):
        return _get_event_type_labels().get(obj.event_type, obj.event_type)

    def get_assigned_to_name(self, obj):
        if obj.assigned_to:
            return f"{obj.assigned_to.first_name} {obj.assigned_to.last_name}".strip() or obj.assigned_to.email
        return None
