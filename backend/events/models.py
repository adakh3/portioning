import re
import uuid
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone
from users.managers import TenantManager
from users.model_mixins import OrgScopedModel

# Reuse the invoice-side payment methods so client-payment recording is
# consistent app-wide. Safe import: bookings.models.finance imports no events.
from bookings.models.finance import PaymentMethod


def resolve_legacy_segments(organisation, guest_count, gents, ladies, has_split):
    """Build the N-segment guest mix for a booking that has no per-segment
    ``BookingGuestCount`` rows, from its legacy gents/ladies columns.

    - A real gents/ladies split → two segments (counts from the columns).
    - No split (count-first) → the whole ``guest_count`` under the org's default
      segment (``GuestSegment.is_default``; falling back to the legacy
      ``OrgSettings.default_guest_profile`` name if the org defines no segments).

    Each segment's multiplier/flags come from the org's ``rules.GuestSegment``
    definitions (1.0 / in-count when the org has no matching segment).
    """
    from bookings.models import OrgSettings

    # Reverse relation (not GuestSegment.objects.filter) so a caller that
    # prefetched ``organisation__guest_segments`` (list views, via food_total)
    # hits the cache instead of one query per booking.
    by_name = {s.name.lower(): s for s in organisation.guest_segments.all()}

    def as_segment(name, count):
        seg = by_name.get(name.lower())
        return {
            'name': seg.name if seg else name,
            'count': count,
            'portion_multiplier': seg.portion_multiplier if seg else 1.0,
            'price_multiplier': float(seg.price_multiplier) if seg else 1.0,
            'price_override': None,  # legacy/no-rows bookings have no per-segment override
            'counts_toward_total': seg.counts_toward_total if seg else True,
        }

    if has_split:
        return [as_segment(name, count)
                for name, count in (('gents', gents), ('ladies', ladies)) if count]

    default = next((s for s in by_name.values() if s.is_default), None)
    if default is not None:
        return [as_segment(default.name, guest_count)]
    # Org defines no segments — honour the legacy default-guest-profile name.
    name = OrgSettings.for_org(organisation).default_guest_profile
    return [as_segment(name, guest_count)]


def sync_legacy_guest_counts(booking, organisation, gents, ladies, guest_count):
    """Dual-write: mirror a booking's legacy gents/ladies columns into
    ``BookingGuestCount`` rows during the transition (columns stay the frontend's
    write target; rows become the read source).

    Only the org's Gents/Ladies segments are touched — any other segments (US
    meal-type buckets) are left untouched. A real split writes/updates the two
    rows; no split (count-first) clears them so the read path uses the default
    segment. No-ops when the org hasn't defined those segments (the read path
    then falls back to the columns directly).
    """
    from rules.models import GuestSegment

    has_split = bool((gents or ladies) and gents + ladies == guest_count)
    parent = {'event': booking} if isinstance(booking, Event) else {'quote': booking}
    for name, count in (('gents', gents), ('ladies', ladies)):
        seg = GuestSegment.objects.filter(
            organisation=organisation, name__iexact=name,
        ).first()
        if seg is None:
            continue
        if has_split and count:
            BookingGuestCount.objects.update_or_create(
                segment=seg, defaults={'count': count}, **parent,
            )
        else:
            BookingGuestCount.objects.filter(segment=seg, **parent).delete()


# A per-head rate is stored as DecimalField(max_digits=10, decimal_places=2), so
# anything from 0 to 99,999,999.99 fits. Beyond that the DB write itself fails.
MAX_SEGMENT_RATE = Decimal('99999999.99')
TWO_PLACES_RATE = Decimal('0.01')

# The ONE accepted spelling of a rate — imported from the money engine, not
# redefined, so the API validator and the maths can never drift apart. Deliberately
# far narrower than what ``Decimal`` will swallow; see its definition in
# bookings.services.totals for why.
from bookings.services.totals import RATE_RE as _RATE_RE  # noqa: E402


def parse_segment_rate(raw):
    """``(Decimal | None, error | None)`` for a submitted per-segment rate (REL-449).

    The single place that decides what a per-head override may be — and what it is
    worth — shared by the API validator and the write path so they can never
    disagree. ``None``/blank is "no override" and is valid. Anything else must be a
    plainly-written, non-negative amount that fits the column, and is returned
    **already quantized to cents, HALF_UP**.

    Quantizing here is the point, not a detail. The column is ``decimal_places=2``,
    so Django rounds on write using HALF_EVEN — the opposite of the HALF_UP both
    engines are deliberately aligned on. A rate of ``12.345`` previewed as ``12.35``
    and stored as ``12.34``, so the saved booking was a cent lighter than the quote
    the customer saw. Rounding to the stored precision *before* anyone prices
    anything keeps the preview and the saved total the same number.

    Before this, ``Decimal(str(raw))`` was called straight on the payload: ``"abc"``
    and ``"1e400"`` raised ``InvalidOperation`` out of the serializer as an unhandled
    **500**, and a negative rate sailed through to make the food total negative —
    caught, if at all, only by the subtotal guard, which then blamed discounts that
    didn't exist.
    """
    if raw is None or raw == '':
        return None, None
    if isinstance(raw, bool):  # True would otherwise read as 1
        return None, 'must be a number'
    if isinstance(raw, (int, float, Decimal)):
        text = f'{raw:f}' if isinstance(raw, Decimal) else repr(raw)
    elif isinstance(raw, str):
        text = raw
    else:
        return None, 'must be a number'
    match = _RATE_RE.match(text)
    if not match:
        return None, 'must be a number'
    sign, digits = match.groups()
    value = Decimal(digits)
    if sign == '-' and value != 0:
        return None, 'cannot be negative'
    if value > MAX_SEGMENT_RATE:
        return None, f'cannot be more than {MAX_SEGMENT_RATE}'
    # Quantize to the stored precision, HALF_UP, and normalise -0 to 0 so nothing
    # can render "$-0.00" on a customer-facing quote.
    return value.quantize(TWO_PLACES_RATE, rounding=ROUND_HALF_UP) + Decimal('0'), None


def guest_counts_error(organisation, guest_count, raw_counts):
    """Validation guard for a submitted breakdown: return an error message when the
    explicit **in-count** segments sum to more than ``guest_count`` (a negative
    remainder), or when any row's per-head rate isn't a usable amount, else
    ``None``. Additional-cover segments (``counts_toward_total=False``, e.g.
    Vendors) are ignored for the count check — they never reconcile against the
    count — but their **rate** is still validated.
    """
    if not raw_counts:
        return None
    segs = {s.name.lower(): s for s in organisation.guest_segments.all()}
    in_count = 0
    for row in raw_counts:
        seg = segs.get((row.get('segment') or '').lower())
        if seg is not None and seg.counts_toward_total:
            in_count += int(row.get('count') or 0)
    # The count check stays FIRST, as it always was — adding the rate check must not
    # silently change which error a caterer sees for a payload that fails both.
    if in_count > (guest_count or 0):
        return (f'The breakdown ({in_count}) is more than the guest count '
                f'({guest_count or 0}).')
    for row in raw_counts:
        seg = segs.get((row.get('segment') or '').lower())
        # Only rows that would actually store a rate: `write_booking_segments` skips
        # an unknown segment and any row with count 0, so validating those would 400
        # on a value that was going to be discarded anyway.
        if seg is None or int(row.get('count') or 0) <= 0:
            continue
        # Name the segment in the message: "Kids price per head cannot be negative"
        # points at the box that's wrong, instead of the subtotal guard's phantom
        # discount (REL-449 AC1).
        _, rate_error = parse_segment_rate(row.get('price_per_head'))
        if rate_error:
            return f'{seg.name} price per head {rate_error}.'
    return None


def write_booking_segments(booking, raw_counts):
    """Persist a booking's per-segment breakdown (list of ``{'segment','count'}``)
    into ``BookingGuestCount`` rows (quote XOR event), replacing existing rows, and
    mirror any Gents/Ladies counts into the legacy columns so column-reading
    renderers (PDFs) stay correct. Data-driven — the gents/ladies mirror fires only
    when the org actually defines those segments, never by org type.
    """
    org = booking.organisation
    parent = {'event': booking} if isinstance(booking, Event) else {'quote': booking}
    segs = {s.name.lower(): s for s in org.guest_segments.all()}
    seen = []
    gents = ladies = 0
    for row in (raw_counts or []):
        name = (row.get('segment') or '').lower()
        seg = segs.get(name)
        if seg is None:
            continue
        count = int(row.get('count') or 0)
        if name == 'gents':
            gents = count
        elif name == 'ladies':
            ladies = count
        if count > 0:
            # Parse through the shared guard, so this path can't store what the API
            # validator rejects — and can't raise InvalidOperation as a 500 either.
            # An unusable value becomes "no override" (fall back to the multiplier)
            # rather than a stored rate nobody chose (REL-449 AC2).
            override, _ = parse_segment_rate(row.get('price_per_head'))
            # The default in-count segment (Adults) always uses the base price/head —
            # never an override — so the stored total can't diverge from the preview.
            # Guard here (not just the UI) so the raw API / AI-agent write path can't
            # set one either.
            if seg.is_default and seg.counts_toward_total:
                override = None
            BookingGuestCount.objects.update_or_create(
                segment=seg, defaults={'count': count, 'price_per_head': override}, **parent,
            )
            seen.append(seg.id)
    BookingGuestCount.objects.filter(**parent).exclude(segment_id__in=seen).delete()
    # Keep the legacy gents/ladies columns in sync (PDF/back-compat), only when the
    # org defines those segments and the values actually changed.
    if ('gents' in segs or 'ladies' in segs) and (booking.gents != gents or booking.ladies != ladies):
        booking.gents = gents
        booking.ladies = ladies
        booking.save(update_fields=['gents', 'ladies'])


def resolve_booking_segments(booking):
    """Segment mix for pricing **and** portioning a booking (quote XOR event).

    Count-first: per-segment ``BookingGuestCount`` rows when present; otherwise the
    legacy gents/ladies split; otherwise the whole ``guest_count`` under the org's
    default segment. Works for both ``Quote`` and ``Event`` (both expose
    ``guest_counts``, ``organisation``, ``guest_count``, ``gents``, ``ladies``).
    Each segment carries both its portion multiplier (kitchen) and price multiplier
    (billing), so the single resolver feeds `segment_food_total` and the engine.
    """
    # Use ``.all()`` (not ``.select_related``) so a caller that prefetched
    # ``guest_counts__segment`` (list views, via food_total) hits the cache
    # instead of an N+1; single-object callers pay only a couple of small queries.
    rows = [r for r in booking.guest_counts.all() if r.count]
    if rows:
        return [
            {'name': r.segment.name, 'count': r.count,
             'portion_multiplier': r.segment.portion_multiplier,
             'price_multiplier': float(r.segment.price_multiplier),
             # Per-booking per-head override (flat/custom rate); None → use multiplier.
             # The default segment never honours an override (matches the write guard).
             'price_override': (None if r.segment.is_default and r.segment.counts_toward_total
                                else (float(r.price_per_head) if r.price_per_head is not None else None)),
             'counts_toward_total': r.segment.counts_toward_total}
            for r in rows
        ]
    has_split = bool((booking.gents or booking.ladies)
                     and booking.gents + booking.ladies == booking.guest_count)
    return resolve_legacy_segments(
        booking.organisation, booking.guest_count, booking.gents, booking.ladies,
        has_split=has_split,
    )


def dish_comment_model(booking):
    """The per-dish side table for this booking kind — EventDishComment for an
    event, QuoteDishComment for a quote. Both carry the dish→course link."""
    return EventDishComment if isinstance(booking, Event) else QuoteDishComment


def resolve_booking_menu(booking):
    """The booking's menu grouped by course, for display (quote XOR event).

    Returns ``None`` when the booking defines no courses — the caller then renders
    the flat menu exactly as today (course-less byte-identical, REL-417 AC4).
    Otherwise returns an ordered list of ``{'course', 'dish_ids', 'dish_names'}``:
    the booking's courses in ``sort_order``, then a trailing unassigned group
    (``course=None``) for any dishes not assigned to a course (AC5). Dish order
    within a group follows add-order.
    """
    from dishes.ordering import dish_ids_in_added_order
    courses = list(booking.courses.all())
    if not courses:
        return None
    course_by_dish = {r.dish_id: r.course_id for r in booking.dish_comments.all() if r.course_id}
    ordered_ids = dish_ids_in_added_order(booking)
    names = dict(booking.dishes.values_list('id', 'name'))
    groups = []
    for course in courses:
        ids = [d for d in ordered_ids if course_by_dish.get(d) == course.id]
        groups.append({'course': course, 'dish_ids': ids, 'dish_names': [names.get(d, '') for d in ids]})
    unassigned = [d for d in ordered_ids if course_by_dish.get(d) is None]
    if unassigned:
        groups.append({'course': None, 'dish_ids': unassigned, 'dish_names': [names.get(d, '') for d in unassigned]})
    return groups


def write_booking_courses(booking, courses_data, dish_courses):
    """Replace a booking's courses and (re)assign dishes to them.

    ``courses_data`` is an ordered list of ``{'name','sort_order'}``;
    ``dish_courses`` maps ``dish_id -> course index`` (into ``courses_data``). Courses
    are replaced wholesale; each listed dish's per-dish row is upserted with its
    course (preserving any ``comment``/``portion_grams``); dishes not listed are
    unassigned. Idempotent given the same input. Never a batch over other bookings.
    """
    parent = {'event': booking} if isinstance(booking, Event) else {'quote': booking}
    Model = dish_comment_model(booking)
    booking.courses.all().delete()  # cascades cleared FKs to None via SET_NULL
    created = []
    for i, c in enumerate(courses_data or []):
        created.append(BookingCourse.objects.create(
            name=(c.get('name') or '').strip(), sort_order=c.get('sort_order', i), **parent,
        ))
    # Assign dishes to their course; clear the course on any row not re-listed.
    # Only dishes actually on the booking are assignable — a stale/foreign/removed
    # dish_id in the raw payload is ignored (never creates a stray or cross-org row).
    valid_dish_ids = set(booking.dishes.values_list('id', flat=True))
    assigned = {}
    for dish_id, idx in (dish_courses or {}).items():
        if idx is None or idx < 0 or idx >= len(created):
            continue
        did = int(dish_id)
        if did in valid_dish_ids:
            assigned[did] = created[idx]
    for dish_id, course in assigned.items():
        Model.objects.update_or_create(dish_id=dish_id, defaults={'course': course}, **parent)
    # Losing its course also drops the dish's choice flag (REL-419): a choice belongs
    # to a course — without one there is no group for it to be an alternative within,
    # and nothing for the finals tallies to add up against. Clearing it here keeps the
    # stored data honest; the readers ignore such a flag anyway (booking_offers_choices).
    Model.objects.filter(**parent).exclude(dish_id__in=assigned.keys()).update(
        course=None, is_choice=False, choice_count=None,
    )


def write_menu_choices(booking, menu_choices):
    """Replace which of a booking's dishes are offered as a menu choice (REL-419).

    A choice belongs to a course: the entrée is the usual one, but a plated dinner can
    just as well offer a choice of dessert, so nothing here is entrée-specific.

    ``menu_choices`` maps ``dish_id -> count or None``: every listed dish is flagged
    ``is_choice``; its value becomes ``choice_count`` (null at proposal time,
    a tally once finals land). Dishes not listed are un-flagged and their count
    cleared. Only dishes actually on the booking are accepted, so a stale/foreign
    dish_id in the raw payload is ignored — never a stray or cross-org row. Sums are
    never validated here: that check belongs to the finals panel alone (AC7/AC8).

    Raises ``ValueError`` on a payload that isn't ``{int-ish: int-ish or None}`` so the
    caller can turn it into a 400 — the raw client payload reaches this untyped.
    """
    parent = {'event': booking} if isinstance(booking, Event) else {'quote': booking}
    Model = dish_comment_model(booking)
    valid_dish_ids = set(booking.dishes.values_list('id', flat=True))
    if menu_choices is None:
        menu_choices = {}
    if not isinstance(menu_choices, dict):
        raise ValueError('menu_choices must be an object of {dish_id: count or null}.')
    wanted = {}
    for dish_id, count in menu_choices.items():
        try:
            did = int(dish_id)
            value = None if count is None else int(count)
        except (TypeError, ValueError):
            raise ValueError(
                'menu_choices must map a dish id to a whole number or null.'
            )
        if value is not None and value < 0:
            raise ValueError('A menu-choice tally cannot be negative.')
        if did in valid_dish_ids:
            wanted[did] = value
    for dish_id, count in wanted.items():
        Model.objects.update_or_create(
            dish_id=dish_id,
            defaults={'is_choice': True, 'choice_count': count},
            **parent,
        )
    Model.objects.filter(**parent).exclude(dish_id__in=wanted.keys()).update(
        is_choice=False, choice_count=None,
    )


def read_menu_choices(booking):
    """``{dish_id: count or None}`` for every dish flagged as a menu choice —
    the exact shape ``write_menu_choices`` accepts, so a read→write round-trip
    (including the quote→event conversion) is lossless."""
    return {
        str(r.dish_id): r.choice_count
        for r in booking.dish_comments.all() if r.is_choice
    }


# The service style that offers the guest a choice. A choice only exists on a plated
# dinner — on a buffet or family-style booking the guest picks at the line or the
# table, so there is nothing to offer in advance and nothing to tally.
PLATED_SERVICE_STYLE = 'plated'


def booking_offers_choices(booking):
    """Whether this booking's menu choices mean anything at all (REL-419).

    Gates every READ of the flags — the client-facing rendering and the finals sum
    alike — so a flag left behind by an earlier edit can never leak. Two ways that
    happens, both reachable: the booking is switched off plated (the Menu-choices card
    disappears, taking the only way to untick with it), or the dish is moved out of its
    course (a choice with no course has nothing to sum against). Ignoring such a flag
    on read is what makes those states harmless rather than a corrupt contract.
    """
    return (getattr(booking, 'service_style', '') or '') == PLATED_SERVICE_STYLE


def choice_groups(booking):
    """A booking's offered choices grouped BY COURSE (REL-419).

    Returns ``[{'course_id', 'course_name', 'dish_ids'}]`` in course order. Only
    courses that actually offer a choice appear, and only on a plated booking.

    Grouping is what makes the finals sum correct: each course's choices are offered
    to every guest, so each must add up to the guarantee **on its own**. Summing them
    together would demand 300 covers from a 150-guest booking that offers a choice of
    main *and* of dessert.

    A flagged dish with NO course is not a choice — there is no group for it to belong
    to, so it is skipped rather than forming a phantom group the finals panel would
    then demand tallies for.
    """
    if not booking_offers_choices(booking):
        return []
    rows = [r for r in booking.dish_comments.all() if r.is_choice and r.course_id]
    if not rows:
        return []
    by_course = {}
    for r in rows:
        by_course.setdefault(r.course_id, []).append(r.dish_id)
    order = {c.id: i for i, c in enumerate(booking.courses.all())}
    names = {c.id: c.name for c in booking.courses.all()}
    groups = [
        {'course_id': cid, 'course_name': names.get(cid), 'dish_ids': sorted(dish_ids)}
        for cid, dish_ids in by_course.items()
    ]
    # Course order, then the unassigned group (sorts last — no course to order by).
    groups.sort(key=lambda g: order.get(g['course_id'], len(order)))
    return groups


# How far ahead of the due date the finals reminder turns amber. Finals typically
# land 2–4 weeks out, so a fortnight is the point where chasing starts.
FINALS_DUE_SOON_DAYS = 14


def finals_status(event, today=None):
    """The event's finals state, DERIVED — never stored (REL-419 AC10).

    ``recorded`` once ``final_count`` is filled; otherwise, when a due date is set,
    ``overdue`` past it, ``due_soon`` inside the fortnight before it, and ``awaiting``
    while it is still comfortably ahead. ``None`` — no pill at all — for anything that
    can't be chased: an unconfirmed or cancelled booking, or one with no due date.

    Chasing stops once the event is under way (there is nothing left to ask the client
    for on the day), but a recorded guarantee keeps showing right through the event.
    """
    if event.status not in FINALS_STATUSES:
        return None
    if event.final_count is not None:
        return 'recorded'
    # Nothing left to chase once the event is under way.
    if event.status != EventStatus.CONFIRMED:
        return None
    due = event.final_count_due
    if not due:
        return None
    today = today or timezone.localdate()
    if due < today:
        return 'overdue'
    if (due - today).days <= FINALS_DUE_SOON_DAYS:
        return 'due_soon'
    return 'awaiting'


class MealAudience(models.TextChoices):
    CUSTOM = 'custom', 'Custom number'      # a hand-typed count (today's behaviour)
    EVERYONE = 'everyone', 'Everyone'       # every cover: guests + extra covers
    GUESTS = 'guests', 'Guests only'        # in-count segments only (no vendors/crew)
    SEGMENT = 'segment', 'Single segment'   # one org segment (``audience_segment``)


def derive_meal_guest_count(meal, segments):
    """The guest count an additional meal serves, derived from the booking's resolved
    ``segments`` (as returned by ``resolve_booking_segments``) by the meal's
    ``audience``:

    * ``everyone`` — every cover (all segments: guests + extra covers)
    * ``guests``   — in-count segments only (``counts_toward_total``)
    * ``segment``  — the single ``audience_segment`` (0 when it isn't in the mix)
    * ``custom``   — ``None`` (keep the hand-typed ``guest_count``)
    """
    audience = meal.audience
    if audience == MealAudience.EVERYONE:
        return sum(s['count'] for s in segments)
    if audience == MealAudience.GUESTS:
        return sum(s['count'] for s in segments if s['counts_toward_total'])
    if audience == MealAudience.SEGMENT:
        if meal.audience_segment_id is None:
            return 0
        name = meal.audience_segment.name
        return sum(s['count'] for s in segments if s['name'] == name)
    return None


def sync_audience_meal_counts(booking):
    """Dual-write each audience-scoped meal's ``guest_count`` from the booking's
    current segments, so every downstream consumer (totals, PDFs, sign page,
    serializers) keeps reading the stored ``guest_count`` unchanged. ``custom`` meals
    are left exactly as typed. Idempotent — writes only when the number changes.
    Called from ``recalculate_totals`` so meal counts stay correct whenever the
    booking's guests change (including at finals time)."""
    segments = resolve_booking_segments(booking)
    for meal in booking.additional_meals.all():
        derived = derive_meal_guest_count(meal, segments)
        if derived is not None and meal.guest_count != derived:
            meal.guest_count = derived
            meal.save(update_fields=['guest_count'])


class EventStatus(models.TextChoices):
    TENTATIVE = 'tentative', 'Tentative'
    CONFIRMED = 'confirmed', 'Confirmed'
    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'
    CANCELLED = 'cancelled', 'Cancelled'


# Statuses a booking must be in for finals to mean anything. `in_progress` and
# `completed` are here because an event auto-advances to them on its own day: gating
# on `confirmed` alone would make the recorded numbers — the ones the kitchen cooks
# to — vanish from the screen on exactly the morning they matter.
FINALS_STATUSES = (
    EventStatus.CONFIRMED, EventStatus.IN_PROGRESS, EventStatus.COMPLETED,
)


EVENT_STATUS_TRANSITIONS = {
    EventStatus.TENTATIVE: [EventStatus.CONFIRMED, EventStatus.CANCELLED],
    EventStatus.CONFIRMED: [EventStatus.IN_PROGRESS, EventStatus.CANCELLED],
    EventStatus.IN_PROGRESS: [EventStatus.COMPLETED, EventStatus.CANCELLED],
    EventStatus.COMPLETED: [],
    EventStatus.CANCELLED: [EventStatus.TENTATIVE],
}


class Event(OrgScopedModel, models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation',
        on_delete=models.CASCADE, related_name='events',
    )
    name = models.CharField(max_length=200)
    event_date = models.DateField()
    # Guest count is THE number: it drives all money math and every display.
    # gents/ladies is an optional split for kitchen portioning only — when set,
    # it must add up to guest_count (serializer-enforced); 0/0 = not specified.
    guest_count = models.IntegerField(
        default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    gents = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    ladies = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    big_eaters = models.BooleanField(default=False)
    big_eaters_percentage = models.FloatField(default=20.0, help_text="Percentage to increase all portions when big_eaters is on")
    dishes = models.ManyToManyField('dishes.Dish', blank=True)
    based_on_template = models.ForeignKey(
        'menus.MenuTemplate', null=True, blank=True, on_delete=models.SET_NULL
    )
    notes = models.TextField(blank=True)
    kitchen_instructions = models.TextField(blank=True, help_text='Cooking-specific notes for the kitchen team')
    banquet_instructions = models.TextField(blank=True, help_text='Front-of-house/service team notes')
    setup_instructions = models.TextField(blank=True, help_text='Logistics, table layout, client-provided items')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='created_events',
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='assigned_events',
        help_text='Salesperson who owns this event; drives commission attribution.',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    # Booking fields
    account = models.ForeignKey(
        'bookings.Account',
        on_delete=models.PROTECT, related_name='events',
        null=True, blank=True,
    )
    primary_contact = models.ForeignKey(
        'bookings.Contact', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='events',
    )
    is_b2b = models.BooleanField(
        default=False, help_text='Business booking — an account (company) is required',
    )
    venue = models.ForeignKey(
        'bookings.Venue', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='events',
    )
    venue_address = models.TextField(blank=True, help_text='Freeform address for ad-hoc locations')
    # Structured address parts for ad-hoc venues (additive; venue_address kept as-is).
    venue_city = models.CharField(max_length=100, blank=True)
    venue_state = models.CharField(max_length=100, blank=True)
    venue_zip = models.CharField(max_length=20, blank=True)
    product = models.ForeignKey(
        'bookings.ProductLine', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='events',
    )
    event_type = models.CharField(max_length=50, blank=True)
    meal_type = models.CharField(max_length=50, blank=True)
    service_style = models.CharField(max_length=50, blank=True)
    price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('9999999.99'))],
        help_text='Food/menu price per head',
    )
    booking_date = models.DateField(null=True, blank=True, help_text='Date the client confirmed/booked')
    status = models.CharField(max_length=20, choices=EventStatus.choices, default=EventStatus.TENTATIVE)
    is_taxable = models.BooleanField(default=False, help_text='Whether tax applies to this event')
    # Rate fields are user-editable, so they carry bounds: without them the API
    # accepted a NEGATIVE tax (a tax that pays the customer), a 150% tax, and
    # negative service charge / gratuity — each of which recomputed the totals and
    # rendered happily into a sendable PDF.
    tax_rate = models.DecimalField(
        max_digits=5, decimal_places=4, default=Decimal('0'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('1'))],
        help_text='Tax rate as a fraction (0.20 = 20%); applied only when is_taxable.',
    )
    # Money totals (food + add-on line items + tax) — computed by recalculate_totals
    # via the shared engine (bookings/services/totals.py), same as quotes.
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    # Service charge (snapshot % + stored amount) and gratuity — copied from
    # OrgSettings at creation; amounts stored by recalculate_totals. Default 0 so
    # existing rows and non-US orgs are unaffected.
    service_charge_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
        help_text='Service charge as a percentage of the subtotal')
    service_charge_taxable = models.BooleanField(default=True, help_text='Whether the service charge is added to the tax base')
    service_charge = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    gratuity_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
        help_text='Gratuity as a percentage of the subtotal (post-tax, never taxed)')
    gratuity = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))

    # Timeline
    setup_time = models.DateTimeField(null=True, blank=True)
    guest_arrival_time = models.DateTimeField(null=True, blank=True)
    meal_time = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(null=True, blank=True)

    # Guest counts
    guaranteed_count = models.IntegerField(null=True, blank=True)
    final_count = models.IntegerField(null=True, blank=True)
    final_count_due = models.DateField(null=True, blank=True)

    # BEO issue tracking (REL-444). The BEO is the day-of ops document; kitchen,
    # banquet and the venue all work from it, so they need to know *which* copy
    # they are holding. 0 = never issued; the first download makes it Rev 1, and
    # only a re-issue **after the client signed** counts as a revision (see
    # ``bookings/services/beo.py::record_beo_issue``) — before signing the document
    # is still being drafted, and bumping the number for every preview would make
    # the counter meaningless.
    beo_revision = models.IntegerField(default=0)
    beo_revised_at = models.DateTimeField(null=True, blank=True)

    # Unguessable token for the client-facing (unauthenticated) sign link —
    # used when a booking is created directly as an event (no quote). Only set
    # once the event is sent for signature. See bookings/views/public_sign.py.
    public_token = models.UUIDField(null=True, blank=True, unique=True, editable=False, db_index=True)

    class Meta:
        ordering = ['-event_date']

    def __str__(self):
        return f"{self.name} ({self.event_date})"

    def ensure_public_token(self):
        """Assign a client-link token if this event doesn't have one yet."""
        if not self.public_token:
            self.public_token = uuid.uuid4()
            self.save(update_fields=['public_token'])
        return self.public_token

    @property
    def finals_status(self):
        """Derived finals state (REL-419) — see ``finals_status()``. A property, not a
        column: the answer changes with the calendar, so storing it would go stale."""
        return finals_status(self)

    @property
    def latest_signature(self):
        return self.signatures.order_by('-signed_at').first()

    @property
    def has_guest_split(self):
        """True when a real gents/ladies split was entered (it adds up)."""
        return bool((self.gents or self.ladies)
                    and self.gents + self.ladies == self.guest_count)

    def portioning_guests(self):
        """N-segment guest mix for the portion calculator.

        Count-first resolution: per-segment ``BookingGuestCount`` rows when
        present; otherwise the legacy gents/ladies split; otherwise the whole
        ``guest_count`` under the org's default segment. Each segment carries its
        own portion multiplier, so the engine no longer hardcodes gents/ladies.
        """
        return {'segments': resolve_booking_segments(self)}

    @property
    def food_total(self):
        """Taxable food/menu cost: main menu priced per guest segment
        (``price_per_head × price_multiplier × count``, summed over all segments) +
        any additional meals (their own price_per_head × guest_count). With no
        breakdown this reduces to ``price_per_head × guest_count`` (see
        ``segment_food_total``)."""
        from bookings.services.totals import segment_food_total
        total = segment_food_total(self.price_per_head, resolve_booking_segments(self))
        for meal in self.additional_meals.all():
            if meal.price_per_head and meal.guest_count:
                total += meal.price_per_head * meal.guest_count
        return total.quantize(Decimal('0.01'))

    def recalculate_totals(self):
        # Shared engine — identical math to quotes. See bookings/services/totals.py.
        from bookings.services.totals import compute_booking_totals
        rate = self.tax_rate if self.is_taxable else Decimal('0')
        # Drop any prefetch cache first: a caller may have loaded this event via
        # prefetch_related('line_items'), and that cache predates rows added in the
        # same save — so line_items.all() would omit the just-added add-ons and the
        # stored subtotal would silently drop them.
        for rel in ('line_items', 'additional_meals'):
            getattr(self, '_prefetched_objects_cache', {}).pop(rel, None)
        # Keep audience-scoped meal counts current before pricing (dual-write).
        sync_audience_meal_counts(self)
        totals = compute_booking_totals(
            self.food_total, self.line_items.all(), rate,
            service_charge_pct=self.service_charge_pct,
            service_charge_taxable=self.service_charge_taxable,
            gratuity_pct=self.gratuity_pct,
        )
        self.subtotal = totals.subtotal
        self.service_charge = totals.service_charge
        self.tax_amount = totals.tax_amount
        self.gratuity = totals.gratuity
        self.total = totals.total
        self.save(update_fields=[
            'subtotal', 'service_charge', 'tax_amount', 'gratuity', 'total',
        ])

    # ── Client payment tracking (advances / part / full) ──
    # Read-only settlement view over the event's EventPayments. These record money
    # the client has paid against `total`; they do NOT change the event's price, so
    # they never touch recalculate_totals().
    @property
    def amount_paid(self):
        paid = self.payments.aggregate(total=models.Sum('amount'))['total']
        return (paid or Decimal('0.00')).quantize(Decimal('0.01'))

    @property
    def balance_due(self):
        return (self.total - self.amount_paid).quantize(Decimal('0.01'))

    @property
    def payment_status(self):
        """'unpaid' (nothing paid), 'partial' (some but < total), or 'paid'
        (paid >= total). A zero-total event with any payment counts as paid."""
        paid = self.amount_paid
        if paid <= Decimal('0.00'):
            return 'unpaid'
        if paid >= self.total:
            return 'paid'
        return 'partial'


class EventConstraintOverride(models.Model):
    event = models.OneToOneField(Event, on_delete=models.CASCADE, related_name='constraint_override')
    max_total_food_per_person_grams = models.FloatField(null=True, blank=True)
    min_portion_per_dish_grams = models.FloatField(null=True, blank=True)

    def __str__(self):
        return f"Overrides for {self.event.name}"


# EventArrangement / EventBeverage were replaced by the unified BookingLineItem
# (bookings/models/addons.py), which attaches priced add-ons to an event or a quote.


class BookingCourse(models.Model):
    """An ordered course on a quote OR an event (exactly one) — Starter / Entrée /
    Dessert. Courses are grouping only: the service style is booking-level, not
    per-course. Dishes are assigned to a course via the per-dish rows
    (EventDishComment / QuoteDishComment). Additive & optional: a booking with no
    courses renders exactly as before (implicit single course)."""
    quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.CASCADE, related_name='courses',
    )
    event = models.ForeignKey(
        Event, null=True, blank=True,
        on_delete=models.CASCADE, related_name='courses',
    )
    name = models.CharField(max_length=100)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'id']
        constraints = [
            models.CheckConstraint(
                name='bookingcourse_exactly_one_parent',
                condition=(
                    models.Q(quote__isnull=False, event__isnull=True)
                    | models.Q(quote__isnull=True, event__isnull=False)
                ),
            ),
        ]

    def __str__(self):
        return f"{self.name} for {self.event or self.quote}"


class EventDishComment(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='dish_comments')
    dish = models.ForeignKey('dishes.Dish', on_delete=models.CASCADE)
    comment = models.TextField(blank=True)
    portion_grams = models.FloatField(null=True, blank=True)
    # Course this dish belongs to (REL-417); null = unassigned (renders as today).
    course = models.ForeignKey(
        'events.BookingCourse', null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
    # Entrée-choice lifecycle (REL-419). `is_choice` is set at PROPOSAL time —
    # this dish is one of the entrées the guest may pick — and is priced per head
    # regardless of who picks what. `choice_count` is the tally that arrives with the
    # final guarantee weeks later; null until then, and never validated at quote time.
    is_choice = models.BooleanField(default=False)
    choice_count = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        unique_together = ('event', 'dish')

    def __str__(self):
        return f"{self.event.name} - {self.dish.name}"


class QuoteDishComment(models.Model):
    """Per-dish record for a quote — the mirror of EventDishComment (quotes had no
    per-dish table before REL-417). Carries the dish's course assignment plus an
    optional comment / portion, so course grouping works identically on quotes."""
    quote = models.ForeignKey('bookings.Quote', on_delete=models.CASCADE, related_name='dish_comments')
    dish = models.ForeignKey('dishes.Dish', on_delete=models.CASCADE)
    comment = models.TextField(blank=True)
    portion_grams = models.FloatField(null=True, blank=True)
    course = models.ForeignKey(
        'events.BookingCourse', null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
    # Mirrors EventDishComment (REL-419). On a quote only `is_choice` is ever
    # set — the tallies arrive at finals, on the event — but the column exists on both
    # so the flag survives the quote→event conversion through one shared code path.
    is_choice = models.BooleanField(default=False)
    choice_count = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        unique_together = ('quote', 'dish')

    def __str__(self):
        return f"{self.quote} - {self.dish.name}"


class BookingMeal(models.Model):
    """An additional meal on a quote OR an event (exactly one) — welcome drinks,
    breakfast, a second service — each with its own menu, price-per-head, time and
    notes. Mirrors BookingLineItem's quote-XOR-event parent, so a meal belongs to
    one booking and survives the quote→event conversion as a copy."""
    quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.CASCADE, related_name='additional_meals',
    )
    event = models.ForeignKey(
        Event, null=True, blank=True,
        on_delete=models.CASCADE, related_name='additional_meals',
    )
    label = models.CharField(max_length=100)
    # Who this meal serves. ``custom`` keeps guest_count as typed; the other audiences
    # derive it from the booking's segments (see derive_meal_guest_count) and it is
    # dual-written on save so downstream consumers keep reading guest_count.
    audience = models.CharField(
        max_length=20, choices=MealAudience.choices, default=MealAudience.CUSTOM,
    )
    audience_segment = models.ForeignKey(
        'rules.GuestSegment', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+', help_text='The single segment served when audience=segment.',
    )
    guest_count = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('9999999.99'))],
    )
    dishes = models.ManyToManyField('dishes.Dish', blank=True)
    based_on_template = models.ForeignKey(
        'menus.MenuTemplate', null=True, blank=True, on_delete=models.SET_NULL
    )
    meal_time = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['id']
        constraints = [
            models.CheckConstraint(
                name='bookingmeal_exactly_one_parent',
                condition=(
                    models.Q(quote__isnull=False, event__isnull=True)
                    | models.Q(quote__isnull=True, event__isnull=False)
                ),
            ),
        ]

    def __str__(self):
        return f"{self.label} for {self.event or self.quote}"


class BookingTimelineEntry(models.Model):
    """One moment in a booking's run-of-show — a time and a label ("18:30 Dinner
    service"). Belongs to a quote XOR an event, mirroring ``BookingMeal``, so it
    survives the quote→event conversion as a copy.

    Purely additive. The four legacy time fields (`setup_time`,
    `guest_arrival_time`, `meal_time`, `end_time`) stay on the booking and remain
    the fallback: a booking with **no** entries renders those exactly as it always
    did, and existing bookings are never auto-migrated into entries. Once a
    booking has at least one entry, the entries are what render.

    A plain ``TimeField``, not a datetime: a run-of-show is times on the event
    day, and storing only the time keeps it free of the UTC-offset drift the
    legacy datetime columns carry.
    """
    quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.CASCADE, related_name='timeline_entries',
    )
    event = models.ForeignKey(
        Event, null=True, blank=True,
        on_delete=models.CASCADE, related_name='timeline_entries',
    )
    time = models.TimeField()
    date = models.DateField(
        null=True, blank=True,
        help_text="The day this step happens on. Null means the booking's event "
                  "date, which is almost every step — set it only for the ones "
                  "that aren't, like a load-in the afternoon before.",
    )
    label = models.CharField(max_length=100)
    sort_order = models.IntegerField(
        default=0,
        help_text='Explicit run-of-show order — authoritative, so a caterer can '
                  'place a row where they want it rather than by the clock.',
    )

    class Meta:
        ordering = ['sort_order', 'time', 'id']
        verbose_name_plural = 'booking timeline entries'
        constraints = [
            models.CheckConstraint(
                name='timelineentry_exactly_one_parent',
                condition=(
                    models.Q(quote__isnull=False, event__isnull=True)
                    | models.Q(quote__isnull=True, event__isnull=False)
                ),
            ),
        ]

    def __str__(self):
        return f"{self.time:%H:%M} {self.label}"


class BookingMealDishComment(models.Model):
    meal = models.ForeignKey(BookingMeal, on_delete=models.CASCADE, related_name='dish_comments')
    dish = models.ForeignKey('dishes.Dish', on_delete=models.CASCADE)
    comment = models.TextField(blank=True)
    portion_grams = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = ('meal', 'dish')

    def __str__(self):
        return f"{self.meal.label} - {self.dish.name}"


class BookingGuestCount(models.Model):
    """How many guests of a given segment are on a booking (quote XOR event).

    Source of truth for per-segment guest counts — generalizes the old
    ``Event``/``Quote`` ``gents``/``ladies`` columns into arbitrary named
    :class:`rules.GuestSegment` s. Mirrors ``BookingMeal``'s quote-XOR-event
    parent so a booking's guest breakdown survives the quote→event conversion.
    """
    quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.CASCADE, related_name='guest_counts',
    )
    event = models.ForeignKey(
        Event, null=True, blank=True,
        on_delete=models.CASCADE, related_name='guest_counts',
    )
    segment = models.ForeignKey('rules.GuestSegment', on_delete=models.PROTECT, related_name='+')
    count = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(50000)])
    # Per-booking per-head price override for this segment. NULL → the rate falls
    # back to base price_per_head × the segment's price_multiplier. Lets a caterer
    # set a flat/custom per-segment rate on a booking (REL-415).
    price_per_head = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )

    class Meta:
        ordering = ['segment__sort_order', 'id']
        constraints = [
            models.CheckConstraint(
                name='bookingguestcount_exactly_one_parent',
                condition=(
                    models.Q(quote__isnull=False, event__isnull=True)
                    | models.Q(quote__isnull=True, event__isnull=False)
                ),
            ),
            models.UniqueConstraint(fields=['quote', 'segment'], name='uniq_quote_segment'),
            models.UniqueConstraint(fields=['event', 'segment'], name='uniq_event_segment'),
        ]

    def __str__(self):
        return f"{self.count} × {self.segment.name}"


class EventPayment(models.Model):
    """A payment the client has made against an event (advance / part / full).

    This is operational settlement tracking — recording money already received
    (cash, bank transfer, etc.) so ops can see paid-vs-owed against the event's
    ``total``. It is NOT the SaaS subscription billing (``payments`` app), and NOT
    a formal invoice/accounting ledger (see bookings.finance for that). Org scope
    is inherited via ``event.organisation``.
    """
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='payments',
    )
    amount = models.DecimalField(
        max_digits=10, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01')), MaxValueValidator(Decimal('9999999.99'))],
    )
    payment_date = models.DateField()
    method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='event_payments_received',
        help_text='Which team member took this payment.',
    )
    reference = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-payment_date', '-id']

    def __str__(self):
        return f"{self.amount} on {self.payment_date} ({self.get_method_display()})"
