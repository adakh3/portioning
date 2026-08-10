"""Price a draft booking without saving it — the live preview's only source.

The frontend used to re-implement the money rules so totals could update as you
type, and the two implementations drifted: a tax rate read as a fraction in one
mode and a percentage in another, add-ons summed one way on quotes and another on
events, four copies of the percent/fraction conversion. Every divergence is a
number the customer saw that the invoice did not agree with.

This endpoint ends that by making the thing on screen the engine's own output.
It is a pure read: no writes, no side effects, nothing snapshotted.
"""
from decimal import Decimal

from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.services.totals import PricingInput, price_booking
from users.mixins import get_request_org


class PricingPreviewView(APIView):
    """POST /api/pricing/preview — what this draft would cost, priced by the engine.

    Takes the booking-shaped payload the save takes and answers with the same
    `PricingResult` a save would store. Deliberately tolerant about what it accepts:
    a draft is half-typed by definition, and a preview that 400s while someone is
    mid-keystroke is worse than one that prices a blank field as nothing.

    It is NOT a validator. The save path validates and recomputes on its own, so a
    wrong preview can never become a stored number — the worst a bad payload can do
    here is show a wrong figure that the next keystroke corrects.
    """

    def post(self, request):
        org = get_request_org(request)
        data = request.data or {}

        guest_count = _as_int(data.get('guest_count'))
        # Filtered once, here, because EVERY reader below assumes dict rows —
        # `_segments` prices them and `_warnings` validates them, and it was the
        # validator that answered 500 to `{"guest_counts": ["nope"]}`.
        raw_counts = [r for r in _as_list(data.get('guest_counts')) if isinstance(r, dict)]
        segments = _segments(org, guest_count, raw_counts)

        result = price_booking(PricingInput(
            price_per_head=data.get('price_per_head'),
            guest_count=guest_count,
            segments=tuple(segments),
            meals=tuple(_meals(_as_list(data.get('additional_meals')), segments)),
            line_items=tuple(_lines(_as_list(data.get('line_items')))),
            # Tax is a GATE times a RATE, and the caller states both — see
            # `_tax_rate`. Nothing is inferred here, because inferring either half
            # is how an event-shaped draft came to preview no tax at all.
            tax_rate=_tax_rate(data),
            service_charge_pct=_as_decimal(data.get('service_charge_pct')),
            service_charge_taxable=_as_bool(data.get('service_charge_taxable')),
            gratuity_pct=_as_decimal(data.get('gratuity_pct')),
        ))
        return Response({
            **result.to_dict(),
            'warnings': _warnings(org, guest_count, raw_counts, data),
        })


def _warnings(org, guest_count, raw_counts, data):
    """Why this draft would be REFUSED if saved, if it would be.

    The preview prices what the engine would compute, honestly — including drafts
    the save path rejects. A breakdown of 999 kids on a 10-guest booking previews
    $49,950 and then 400s on save, so without this the card confidently shows a
    number that cannot exist.

    A warning rather than an error status on purpose. The endpoint must not fail
    mid-keystroke — half-typed is the normal state of a draft — so the caller gets
    the figures AND the reason they will not stick, and decides how loudly to say
    so. Same text as the save path's own rejection (`guest_counts_error`), because
    two wordings for one rule is how they drift.
    """
    from events.models import guest_counts_error

    problems = []
    problem = guest_counts_error(org, guest_count, raw_counts)
    if problem:
        problems.append(problem)
    problems.extend(_tax_contract_problems(data))
    return problems


def _tax_contract_problems(data):
    """A caller that says "taxable" and sends no rate has a bug, not a draft.

    Tax here is a gate times a rate, and the caller owns both. When the gate is on
    and the rate is missing the honest answer is zero — which looks exactly like a
    tax-free booking and is how an event-shaped draft quietly previewed no tax at
    all for a while. Priced as zero either way (a preview must never fail
    mid-keystroke), but said out loud, so the next caller that forgets finds out on
    the first request instead of in a customer's invoice.
    """
    if not _as_bool(data.get('is_taxable')):
        return []
    if data.get('tax_rate') not in (None, ''):
        return []
    return ['No tax rate is set for this booking, so tax is shown as zero.']


def _segments(org, guest_count, raw_counts):
    """The rows a save WOULD store, priced as the engine will price them.

    Shares `derive_segment_rows` with the write path, so the breakdown on screen —
    including the derived remainder in the default segment — is the breakdown that
    gets persisted. Deriving it separately here is exactly how the two would drift.
    """
    from events.models import segments_for_preview
    return segments_for_preview(org, guest_count, raw_counts)


def _meals(raw_meals, segments):
    """Each meal priced by the count the SAVE would give it, not the one sent.

    An audience-scoped meal ("everyone", "guests", a named segment) doesn't own its
    head count — the booking's segments do, and the save re-derives it on write
    (`sync_audience_meal_counts`). Taking the client's number on trust meant the
    preview agreed with the save only for as long as the browser kept computing the
    same rule, which is precisely the duplicated math this epic exists to delete.
    An `everyone` meal on 100 guests plus 5 out-of-count vendors is 105 covers here
    and 105 covers on save, because both ask the same function.

    `custom` keeps its typed count — that is what custom means.
    """
    from events.models import MealAudience, derive_meal_count_from_rows

    for meal in (raw_meals or ()):
        if not isinstance(meal, dict):
            continue
        derived = derive_meal_count_from_rows(
            meal.get('audience') or MealAudience.CUSTOM,
            meal.get('audience_segment'),
            segments,
        )
        yield {
            'label': meal.get('label') or '',
            'price_per_head': meal.get('price_per_head'),
            'guest_count': _as_int(meal.get('guest_count')) if derived is None else derived,
        }


def _lines(raw_lines):
    for line in (raw_lines or ()):
        if not isinstance(line, dict):
            continue
        yield {
            'category': line.get('category') or '',
            'unit': line.get('unit') or '',
            'quantity': line.get('quantity'),
            'unit_price': line.get('unit_price'),
            'description': line.get('description') or '',
            'sort_order': _as_int(line.get('sort_order')),
        }


def _as_bool(value, default=True):
    """A JSON boolean, honestly read.

    `bool("false")` is True, and this gate decides whether a customer is charged
    tax — so a caller that stringifies its booleans would be silently taxed rather
    than silently untaxed. Neither is acceptable; both are guessed values on a
    number someone pays. Anything that is not recognisably a boolean falls back to
    the documented default.
    """
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ('true', '1', 'yes'):
            return True
        if lowered in ('false', '0', 'no', ''):
            return False
    return default


def _tax_rate(data):
    """The EFFECTIVE rate — 0 when the booking isn't taxable.

    One convention, decided here: a fraction (0.0875 = 8.75%), the same thing the
    column stores. The frontend had four copies of the percent/fraction conversion
    and disagreed with itself about which one a given screen was holding.

    Both halves come from the caller and neither is guessed. A missing rate under an
    ON gate prices as zero AND raises a warning (`_tax_contract_problems`) rather
    than being quietly filled in from the org default — a preview that invents a
    rate is a preview that disagrees with the save.
    """
    if not _as_bool(data.get('is_taxable')):
        return Decimal('0')
    return _as_decimal(data.get('tax_rate'))


def _as_list(value):
    """A list, or an empty one — never something that explodes on iteration.

    A JSON body is whatever the caller sent. `{"guest_counts": 42}` made the loop
    below raise TypeError and the endpoint answer 500, which is precisely what its
    docstring promises cannot happen: a draft that is being typed must never error.
    A string is refused too — iterating one yields characters, which then fail as
    dicts a few lines later.
    """
    return value if isinstance(value, (list, tuple)) else []


def _as_int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _as_decimal(value):
    """A rate as a Decimal, with anything unusable becoming zero — a half-typed
    field must price as nothing, not raise."""
    if value in (None, ''):
        return Decimal('0')
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal('0')
