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
        segments = _segments(org, guest_count, _as_list(data.get('guest_counts')))

        result = price_booking(PricingInput(
            price_per_head=data.get('price_per_head'),
            guest_count=guest_count,
            segments=tuple(segments),
            meals=tuple(_meals(_as_list(data.get('additional_meals')))),
            line_items=tuple(_lines(_as_list(data.get('line_items')))),
            # The caller sends the rate it holds; taxability is the caller's switch,
            # exactly as on the save path (`Quote.recalculate_totals`).
            tax_rate=_tax_rate(data),
            service_charge_pct=_as_decimal(data.get('service_charge_pct')),
            service_charge_taxable=bool(data.get('service_charge_taxable', True)),
            gratuity_pct=_as_decimal(data.get('gratuity_pct')),
        ))
        return Response(result.to_dict())


def _segments(org, guest_count, raw_counts):
    """The rows a save WOULD store, priced as the engine will price them.

    Shares `derive_segment_rows` with the write path, so the breakdown on screen —
    including the derived remainder in the default segment — is the breakdown that
    gets persisted. Deriving it separately here is exactly how the two would drift.
    """
    from events.models import segments_for_preview
    return segments_for_preview(org, guest_count, raw_counts)


def _meals(raw_meals):
    for meal in (raw_meals or ()):
        if not isinstance(meal, dict):
            continue
        yield {
            'label': meal.get('label') or '',
            'price_per_head': meal.get('price_per_head'),
            'guest_count': _as_int(meal.get('guest_count')),
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


def _tax_rate(data):
    """The EFFECTIVE rate — 0 when the booking isn't taxable.

    One convention, decided here: a fraction (0.0875 = 8.75%), the same thing the
    column stores. The frontend had four copies of the percent/fraction conversion
    and disagreed with itself about which one a given screen was holding.
    """
    if not data.get('is_taxable', True):
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
