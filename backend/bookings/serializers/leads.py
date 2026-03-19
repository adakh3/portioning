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


# Org-aware caches for choice lookups: {org_id: {value: label}}
_event_type_cache = {}
_lead_status_cache = {}


def _get_event_type_labels(org_id):
    if org_id not in _event_type_cache:
        _event_type_cache[org_id] = dict(
            EventTypeOption.objects.filter(organisation_id=org_id).values_list('value', 'label')
        )
    return _event_type_cache[org_id]


def _get_lead_status_labels(org_id):
    if org_id not in _lead_status_cache:
        _lead_status_cache[org_id] = dict(
            LeadStatusOption.objects.filter(organisation_id=org_id).values_list('value', 'label')
        )
    return _lead_status_cache[org_id]


class LeadSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)
    status_display = serializers.SerializerMethodField()
    event_type_display = serializers.SerializerMethodField()
    product_name = serializers.CharField(source='product.name', read_only=True, default=None)
    assigned_to_name = serializers.SerializerMethodField()
    lost_reason_option_display = serializers.CharField(
        source='lost_reason_option.label', read_only=True, default=None,
    )
    won_event_name = serializers.SerializerMethodField()
    quotes = LeadQuoteSummarySerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Lead
        fields = [
            'id', 'account', 'account_name',
            'contact_name', 'contact_email', 'contact_phone',
            'source', 'event_date', 'lead_date', 'guest_estimate',
            'budget',
            'event_type', 'event_type_display',
            'meal_type', 'service_style', 'notes',
            'product', 'product_name',
            'assigned_to', 'assigned_to_name',
            'created_by', 'created_by_name',
            'status', 'status_display',
            'won_quote', 'won_event', 'won_event_name',
            'lost_reason_option', 'lost_reason_option_display', 'lost_notes',
            'contacted_at', 'qualified_at', 'proposal_sent_at', 'won_at', 'lost_at',
            'created_at', 'updated_at',
            'quotes',
        ]
        read_only_fields = [
            'status', 'won_quote', 'won_event', 'created_by',
            'contacted_at', 'qualified_at', 'proposal_sent_at', 'won_at', 'lost_at',
            'created_at', 'updated_at',
        ]
        extra_kwargs = {
            'notes': {'max_length': 5000},
            'lost_notes': {'max_length': 2000},
        }

    def get_created_by_name(self, obj):
        if obj.created_by:
            return f"{obj.created_by.first_name} {obj.created_by.last_name}".strip() or obj.created_by.email
        return None

    def get_status_display(self, obj):
        return _get_lead_status_labels(obj.organisation_id).get(obj.status, obj.status)

    def get_event_type_display(self, obj):
        return _get_event_type_labels(obj.organisation_id).get(obj.event_type, obj.event_type)

    def get_won_event_name(self, obj):
        if obj.won_event:
            return obj.won_event.name
        return None

    def get_assigned_to_name(self, obj):
        if obj.assigned_to:
            return f"{obj.assigned_to.first_name} {obj.assigned_to.last_name}".strip() or obj.assigned_to.email
        return None


class LeadListSerializer(LeadSerializer):
    """Lighter serializer for list/Kanban views — excludes nested quotes."""

    class Meta(LeadSerializer.Meta):
        fields = [f for f in LeadSerializer.Meta.fields if f != 'quotes']
