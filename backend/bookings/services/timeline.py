"""One source of truth for *what* a booking's timeline contains.

A booking can describe its day two ways:

* the four legacy columns (`setup_time`, `guest_arrival_time`, `meal_time`,
  `end_time`) — full datetimes, still on the model, still the fallback; or
* ``BookingTimelineEntry`` rows — an ordered, org-labelled run-of-show.

The rule, in one place so no surface can disagree: **entries win when there are
any, otherwise the legacy fields, never both.** A booking with no entries renders
exactly as it did before entries existed, and existing bookings are never
migrated into entries — they simply have none.

**Additional meals are merged in, never copied.** A `BookingMeal` carries its own
`meal_time` (along with its price and menu), so the meal stays the single source
and appears here as a row nobody can edit from the timeline. Copying it into an
entry would give one meal two times, free to drift apart silently.

Each surface still owns its own wording for the legacy slots (the PDF says
"Setup Time:", the sign page says "Setup"), which is why the legacy labels are
passed in rather than fixed here.
"""

# The legacy columns, in the order a day runs.
LEGACY_FIELDS = ('setup_time', 'guest_arrival_time', 'meal_time', 'end_time')


class TimelineRow:
    """One line of a booking's day, whatever it came from.

    ``value`` is a ``time`` for a run-of-show entry and a ``datetime`` for a
    legacy slot or an additional meal; ``format_timeline_value`` renders either.
    ``date`` is the day it falls on when that isn't the booking's event date —
    a load-in the afternoon before — and ``None`` when it is.
    """

    __slots__ = ('label', 'value', 'date', 'source')

    def __init__(self, label, value, date=None, source='entry'):
        self.label = label
        self.value = value
        self.date = date
        self.source = source          # 'entry' | 'legacy' | 'meal'

    # Tuple-like, so the existing `for label, value in booking_timeline(...)`
    # call sites keep working unchanged.
    def __iter__(self):
        return iter((self.label, self.value))

    def __eq__(self, other):
        if isinstance(other, TimelineRow):
            return (self.label, self.value, self.date, self.source) == \
                   (other.label, other.value, other.date, other.source)
        return (self.label, self.value) == other

    def __repr__(self):
        return f'TimelineRow({self.label!r}, {self.value!r}, {self.date!r}, {self.source!r})'


def _sort_key(row, event_date):
    """Chronological across days: a row's own date, else the event date."""
    value = row.value
    if hasattr(value, 'date'):  # datetime — carries its own day
        return (value.date(), value.time())
    day = row.date or event_date
    return (day, value)


def booking_timeline(booking, legacy_labels, include_meals=True):
    """The booking's day as ``[TimelineRow]``, in display order.

    ``legacy_labels`` maps each legacy field name to that surface's wording.
    Rows unpack as ``(label, value)`` so older call sites are unaffected.
    """
    entries = list(booking.timeline_entries.all())

    if not entries:
        # Legacy booking: the four slots, and ONLY the four slots. Additional
        # meals are deliberately not merged here — that would change the
        # rendered timeline of every existing booking with a timed meal,
        # including quotes a client has already signed. A booking joins the new
        # model by getting a run-of-show, not by us rewriting its documents.
        return [
            TimelineRow(legacy_labels[field], getattr(booking, field), None, 'legacy')
            for field in LEGACY_FIELDS
            if getattr(booking, field, None)
        ]

    rows = [TimelineRow(e.label, e.time, e.date, 'entry') for e in entries]

    if include_meals:
        meals = [
            TimelineRow(m.label or 'Additional meal', m.meal_time, None, 'meal')
            for m in booking.additional_meals.all()
            if m.meal_time
        ]
        if meals:
            # Only re-sort once meals are in the mix. Without them the caterer's
            # own `sort_order` is the order, and re-sorting would quietly
            # override a row they deliberately dragged somewhere.
            rows += meals
            event_date = getattr(booking, 'event_date', None)
            if event_date:
                rows.sort(key=lambda r: _sort_key(r, event_date))

    return rows


def format_timeline_value(value, time_format='24h'):
    """Render a timeline value honouring the org's 12h/24h preference.

    A legacy slot or an additional meal keeps its full date+time wording (both
    have always had one); a run-of-show entry is a time, so it shows the time
    alone — its day, when it differs, is rendered by the surface.
    """
    if value is None:
        return ''
    twelve = time_format == '12h'
    if hasattr(value, 'date'):  # datetime — a legacy slot or a meal
        return value.strftime('%d %b %Y, %I:%M %p' if twelve else '%d %b %Y, %H:%M')
    if not twelve:
        return value.strftime('%H:%M')
    # Unpadded hour ("5:00 PM", not "05:00 PM") to match how the frontend's
    # formatTime writes the same entry in-app — the sign page shows this string.
    return value.strftime('%I:%M %p').lstrip('0')


def format_timeline_row(row, time_format='24h', date_format='%d %b'):
    """A row's time as a surface should print it, with its day when that differs
    from the booking's event date ("14:00 (23 Dec)")."""
    shown = format_timeline_value(row.value, time_format)
    if row.date:
        return f'{shown} ({row.date.strftime(date_format)})'
    return shown
