"""Shared serializer for a booking's timeline entries (the event-day run-of-show),
used by BOTH the Quote and Event serializers. Lives in `bookings` (not `events`)
for the same reason `meals.py` does — so quotes can nest entries without an
events→bookings→events import cycle.
"""
from rest_framework import serializers

from events.models import BookingTimelineEntry


class BookingTimelineEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = BookingTimelineEntry
        fields = ['id', 'time', 'label', 'sort_order']
        # `sort_order` is assigned from the payload's order on save, never sent by
        # the client — so what you see in the editor is what persists.
        read_only_fields = ['id', 'sort_order']
        extra_kwargs = {'label': {'max_length': 100}}


def replace_timeline_entries(parent_field, parent_obj, entries_data):
    """Replace a booking's timeline entries. ``parent_field`` is 'quote' or 'event'.

    Delete-all + recreate, the same nested-write semantics as additional meals —
    which is also what makes reordering and removal work with no diffing: the
    client sends the rows in the order it shows them, and their position in the
    payload becomes `sort_order`.

    An empty list is meaningful: it clears the timeline, and the booking falls
    back to its four legacy time fields.
    """
    parent_obj.timeline_entries.all().delete()
    for index, data in enumerate(entries_data):
        fields = {k: v for k, v in data.items() if k != 'sort_order'}
        BookingTimelineEntry.objects.create(
            **{parent_field: parent_obj}, sort_order=index, **fields,
        )
