from rest_framework import serializers

from bookings.models.choices import (
    EventTypeOption, SourceOption, ServiceStyleOption, LeadStatusOption,
    LostReasonOption, MealTypeOption,
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
        # `value` is the stored key on leads — generated server-side from the
        # label on create, never edited afterwards (renaming the label is safe).
        fields = ['id', 'value', 'label', 'color', 'sort_order', 'is_active',
                  'is_default', 'is_won', 'is_lost']
        read_only_fields = ['value']


class LostReasonOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = LostReasonOption


class MealTypeOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = MealTypeOption
