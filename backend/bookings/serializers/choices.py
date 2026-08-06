from rest_framework import serializers

from bookings.models.choices import (
    EventTypeOption, SourceOption, ServiceStyleOption, LeadStatusOption,
    LostReasonOption, MealTypeOption, TimelinePresetOption,
)


class ChoiceOptionSerializer(serializers.ModelSerializer):
    class Meta:
        fields = ['id', 'value', 'label', 'sort_order', 'is_active']
        # `value` is the stored key (on leads/events/etc.); generated server-side
        # from the label on create, never edited after (renaming the label is safe).
        read_only_fields = ['value']


class EventTypeOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = EventTypeOption


class SourceOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = SourceOption


class ServiceStyleOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = ServiceStyleOption
        # `guests_choose` decides whether a booking in this style can offer the
        # guest a choice of dish. Read by the booking pages as well as Settings —
        # the Menu card must never offer a flag this API would then ignore.
        fields = ['id', 'value', 'label', 'sort_order', 'is_active', 'guests_choose']
        read_only_fields = ['value']


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


class TimelinePresetOptionSerializer(ChoiceOptionSerializer):
    class Meta(ChoiceOptionSerializer.Meta):
        model = TimelinePresetOption
        # The two extra columns make these rows the org's standard-day template
        # as well as its label vocabulary.
        fields = ['id', 'value', 'label', 'sort_order', 'is_active',
                  'in_standard_day', 'standard_day_offset_minutes']
        read_only_fields = ['value']
