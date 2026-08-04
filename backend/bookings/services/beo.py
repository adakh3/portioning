"""What goes ON a BEO — the data shaping, kept out of the renderer (REL-444).

``bookings/pdf_beo.py`` turns these into flowables and does nothing else, so the
rules that are easy to get wrong — which covers are vendors, whether a re-issue
counts as a revision, whether the entrée tallies have landed — are plain functions
with plain return values that a test can pin down without reading a PDF.

Everything here is read-only except :func:`record_beo_issue`, which is the one
place the revision counter moves.
"""
from django.db import transaction
from django.utils import timezone


def record_beo_issue(event, now=None):
    """Stamp a BEO download onto the event; return ``(revision, revised_at)``.

    The counter answers one question for the kitchen: *is the sheet in my hand the
    current one?* So it only moves when the answer can change for someone who
    already has a copy:

    * never issued (``beo_revision == 0``) → **Rev 1**, no revised-at stamp; a first
      issue is not a revision of anything;
    * re-issued while **unsigned** → unchanged. The booking is still being drafted
      and nobody downstream is working from it yet, so bumping on every preview
      would burn through revision numbers and make them meaningless (AC2);
    * re-issued **after the client signed** → +1, stamped with the time. This is the
      case the counter exists for: the terms are fixed, copies are out, and a change
      has to announce itself.

    Signed-ness is read from the event, which is where a signature is canonical
    (a quote's signature lands on its event — see ``bookings/views/public_sign.py``).

    The read-modify-write is locked so two people hitting *Download* at the same
    moment can't both issue "Rev 3".
    """
    with transaction.atomic():
        fresh = type(event).objects.select_for_update().get(pk=event.pk)
        if fresh.beo_revision == 0:
            fresh.beo_revision = 1
            fresh.save(update_fields=['beo_revision'])
        elif fresh.latest_signature is not None:
            fresh.beo_revision += 1
            fresh.beo_revised_at = now or timezone.now()
            fresh.save(update_fields=['beo_revision', 'beo_revised_at'])
        revision, revised_at = fresh.beo_revision, fresh.beo_revised_at
    # Keep the caller's instance honest — it is the one about to be rendered.
    event.beo_revision, event.beo_revised_at = revision, revised_at
    return revision, revised_at


def beo_guest_breakdown(event):
    """The guest numbers a BEO leads with, split the way the kitchen counts them.

    In-count segments (Adults, Kids) make the headline number; segments flagged
    ``counts_toward_total=False`` (vendor/crew meals) are **additional covers** —
    real plates to cook, deliberately outside the guest count. Empty segments are
    dropped so the block lists what's actually being served.
    """
    from events.models import resolve_booking_segments
    segments = resolve_booking_segments(event)
    in_count = [(s['name'], s['count']) for s in segments if s['counts_toward_total'] and s['count']]
    additional = [(s['name'], s['count']) for s in segments if not s['counts_toward_total'] and s['count']]
    return {
        'in_count': in_count,
        'in_count_total': sum(c for _, c in in_count),
        'additional': additional,
        'additional_total': sum(c for _, c in additional),
    }


def beo_vendor_meals(event):
    """Vendor/crew covers for the BEO's "Vendor meals" block — ``[]`` when there
    are none, and the renderer then omits the block entirely (AC6).

    There is **no vendor flag** anywhere in the model, so this reads the two signals
    that actually exist, in priority order:

    1. an additional meal aimed at a segment that doesn't count toward the guest
       total — the vendors are being fed something of their own, so the block can
       say what and when;
    2. an additional-covers row in the guest counts with no meal of its own — the
       vendors eat the main menu, so only the number is known.

    A free-text meal label is deliberately **not** a signal: "Vendor lunch" typed
    into a custom-count meal proves nothing about who eats it, and guessing from
    wording would put phantom covers on the sheet the kitchen cooks to.
    """
    from dishes.ordering import dish_display_names_in_added_order
    from events.models import MealAudience

    rows = []
    served_segments = set()
    for meal in event.additional_meals.all():
        if meal.audience != MealAudience.SEGMENT or meal.audience_segment_id is None:
            continue
        segment = meal.audience_segment
        if segment.counts_toward_total:
            continue
        served_segments.add(segment.pk)
        rows.append({
            'name': segment.name,
            'count': meal.guest_count or 0,
            'label': meal.label or '',
            'served': dish_display_names_in_added_order(meal),
            'time': meal.meal_time,
        })

    for row in event.guest_counts.all():
        # Skip a segment already described by its own meal above — otherwise the
        # same vendors would be listed twice, once with a menu and once without.
        if (row.segment.counts_toward_total or not row.count
                or row.segment.pk in served_segments):
            continue
        rows.append({
            'name': row.segment.name, 'count': row.count,
            'label': '', 'served': [], 'time': None,
        })
    return rows


def beo_choice_tallies(event):
    """Per-course menu-choice tallies, keyed by course id (AC7).

    ``{course_id: {'course_name', 'rows': [(dish_name, count_or_None)], 'recorded'}}``.
    ``recorded`` is False while the client still owes us the numbers — the renderer
    then prints the pending line instead of a breakdown of nulls.

    Grouped by course rather than hardcoded to the entrée: REL-419 made a choice
    something **any** course can offer (a choice of dessert is as real as a choice
    of main), and each course's tallies add up to the guarantee on their own.
    Dishes keep menu add-order, so the block reads down in the same order as the
    course it sits under.
    """
    from dishes.ordering import dish_ids_in_added_order
    from events.models import choice_groups

    groups = choice_groups(event)
    if not groups:
        return {}
    counts = {r.dish_id: r.choice_count for r in event.dish_comments.all() if r.is_choice}
    names = dict(event.dishes.values_list('id', 'name'))
    order = {dish_id: i for i, dish_id in enumerate(dish_ids_in_added_order(event))}
    out = {}
    for group in groups:
        dish_ids = sorted(group['dish_ids'], key=lambda d: order.get(d, len(order)))
        out[group['course_id']] = {
            'course_name': group['course_name'] or '',
            'rows': [(names.get(dish_id, ''), counts.get(dish_id)) for dish_id in dish_ids],
            'recorded': any(counts.get(dish_id) is not None for dish_id in dish_ids),
        }
    return out
