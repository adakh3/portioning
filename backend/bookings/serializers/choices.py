from rest_framework import serializers

from bookings.models.choices import (
    EventTypeOption, SourceOption, ServiceStyleOption, LeadStatusOption,
    LostReasonOption,
)


class ChoiceOptionSerializer(serializers.ModelSerializer):
    class Meta:
        fields = ['id', 'value', 'label', 'sort_order', 'is_active']


class EventTypeOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = EventTypeOption


class SourceOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = SourceOption


class ServiceStyleOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = ServiceStyleOption


class LeadStatusOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = LeadStatusOption


class LostReasonOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = LostReasonOption
