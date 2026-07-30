"""One source of truth for *which* timeline a booking shows.

A booking can describe its day two ways:

* the four legacy columns (`setup_time`, `guest_arrival_time`, `meal_time`,
  `end_time`) — full datetimes, still on the model, still the fallback; or
* ``BookingTimelineEntry`` rows — an ordered, org-labelled run-of-show.

The rule, in one place so no surface can disagree: **entries win when there are
any, otherwise the legacy fields, never both.** A booking with no entries renders
exactly as it did before entries existed, and existing bookings are never
migrated into entries — they simply have none.

Each surface still owns its own wording for the legacy slots (the PDF says
"Setup Time:", the sign page says "Setup"), which is why the legacy labels are
passed in rather than fixed here.
"""

# The legacy columns, in the order a day runs.
LEGACY_FIELDS = ('setup_time', 'guest_arrival_time', 'meal_time', 'end_time')


def booking_timeline(booking, legacy_labels):
    """``[(label, value)]`` for the booking, in display order.

    ``legacy_labels`` maps each legacy field name to that surface's wording.
    ``value`` is a ``datetime`` for a legacy slot and a ``time`` for an entry —
    both format with ``strftime``; use ``format_timeline_value`` to get it right.
    """
    entries = list(booking.timeline_entries.all())
    if entries:
        return [(e.label, e.time) for e in entries]
    return [
        (legacy_labels[field], getattr(booking, field))
        for field in LEGACY_FIELDS
        if getattr(booking, field, None)
    ]


def format_timeline_value(value, time_format='24h'):
    """Render a timeline value honouring the org's 12h/24h preference.

    A legacy slot keeps its full date+time wording (it always had one); an entry
    is a time on the event day, so it shows the time alone.
    """
    if value is None:
        return ''
    twelve = time_format == '12h'
    if hasattr(value, 'date'):  # datetime — a legacy slot
        return value.strftime('%d %b %Y, %I:%M %p' if twelve else '%d %b %Y, %H:%M')
    return value.strftime('%I:%M %p' if twelve else '%H:%M')
