"""Single source of truth for booking totals — used by BOTH quotes and events.

Do not re-implement this math anywhere else (serializers, views, models): call
`compute_booking_totals`. See docs/CODE_MAINTENANCE.md.
"""
import re
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

TWO_PLACES = Decimal('0.01')


def _round2(x):
    """2-dp HALF_UP — matches the frontend `round2` (Math.round is half-up), not
    Decimal's default HALF_EVEN, so the two engines agree to the cent."""
    return Decimal(x).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


# Nothing priceable is worth more than this per cover. Bounding here (not just in
# the API validator) keeps ``segment_effective_rate`` the unconditional guard its
# docstring claims to be: ``Decimal('1e400').is_finite()`` is True — unlike JS,
# where it's Infinity — so without a magnitude bound, ``quantize`` raises the very
# InvalidOperation this was written to eliminate.
MAX_USABLE_RATE = Decimal('99999999.99')

# The ONE accepted spelling of a money string, shared with the API validator
# (events.models.parse_segment_rate imports this) and mirrored by RATE_RE in
# frontend/lib/quoteTotals.ts. `[0-9]` not `\d`: Python's `\d` is Unicode-aware and
# would match "١٢٣"/"５", which Decimal parses and JS Number does not.
RATE_RE = re.compile(r'^\s*(-?)([0-9]+(?:\.[0-9]+)?)\s*$')


def _usable_rate(value):
    """A finite, non-negative, in-range Decimal, or ``None`` when the value can't be
    used as money. ``None`` means "fall back", never "free" (REL-449).

    Strings must match ``RATE_RE`` rather than going straight to ``Decimal``: the two
    parsers accept different languages, and every disagreement is money one engine
    charges and the other doesn't. ``Decimal`` takes ``"1_000"`` (Python separators)
    and Unicode digits like ``"١٢٣"``/``"５"``; JS ``Number`` takes none of those but
    turns ``"  "``, ``false`` and ``[]`` into ``0``. Insisting on one plain spelling
    on both sides closes both halves.
    """
    if value is None or value == '' or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        try:
            d = Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            return None
    elif isinstance(value, str):
        if not RATE_RE.match(value):
            return None
        d = Decimal(value.strip())
    else:
        return None
    if not d.is_finite() or d < 0 or d > MAX_USABLE_RATE:
        return None
    return d


def segment_effective_rate(price_per_head, price_multiplier, override=None):
    """The per-cover price for a segment, rounded to cents. A per-segment
    ``override`` (a flat/custom per-head set on the booking) wins; otherwise it's
    ``round(price_per_head × price_multiplier)`` (e.g. Kids at 0.5 → $5.00).

    Always **finite and non-negative** (REL-449). Bad input is refused at the API
    (see ``guest_counts_error``), so nothing here should ever be junk — but a rate
    is money, and this also has to hold for rows already in the database.

    Unusable input **falls back; it never makes a cover free.** An unusable override
    is ignored (the segment reverts to its multiplier), and an unusable multiplier
    reverts to ``1.0`` — full price. Flooring to zero instead would turn a bad
    config value into a silent discount, which is the failure mode a caterer would
    never spot. The one thing that is always refused is a negative, which would
    otherwise pay the customer to attend.
    """
    o = _usable_rate(override)
    if o is not None:
        return _round2(o)
    mult = _usable_rate(price_multiplier)
    if mult is None:
        mult = Decimal('1')
    base = _usable_rate(price_per_head) or Decimal('0')
    return _round2(base * mult)


def segment_food_total(price_per_head, segments):
    """Per-head food cost across a booking's guest segments.

    Each segment is charged its **rounded per-cover rate** — a per-segment
    ``price_override`` if set, else ``round(base price × multiplier)`` — × count,
    summed over **all** segments (in-count Adults/Kids *and* additional covers
    Vendors; ``counts_toward_total`` only governs count validation/display, never
    pricing). Rounding per cover (not once on the aggregate) is what makes the
    itemized food lines sum **exactly** to this subtotal on every surface.

    ``segments`` is an iterable of plain dicts ``{'count', 'price_multiplier',
    'price_override'?}`` (extra keys ignored). With a single default segment at 1.0×
    and no override, this reduces **exactly** to the legacy ``price × guest_count``
    — so a booking with no breakdown, and a Gents/Ladies booking, keep their totals.
    """
    total = Decimal('0.00')
    for seg in segments:
        rate = segment_effective_rate(price_per_head, seg.get('price_multiplier'), seg.get('price_override'))
        total += rate * Decimal(seg.get('count', 0) or 0)
    return _round2(total)


def segment_food_rows(price_per_head, segments):
    """Itemized food lines — ``[{name, count, rate, amount}]`` where ``rate`` is the
    per-cover effective rate (override or ``round(price × multiplier)``) and
    ``amount = rate × count``, so ``count × rate = amount`` reads exactly and the
    amounts sum to ``segment_food_total``.

    Returns ``None`` when there is nothing worth itemizing — no food, fewer than two
    segments with a count, or every segment sharing **one** rate (a count-only
    booking, or a Gents/Ladies org whose segments are all 1.0×). Callers then render
    the single ``price/head × guests = total`` line, so those surfaces stay
    byte-identical (the owner's "only multi-rate breakdowns" decision).
    """
    rows, rates = [], set()
    for seg in segments:
        count = int(seg.get('count', 0) or 0)
        if count <= 0:
            continue
        rate = segment_effective_rate(price_per_head, seg.get('price_multiplier'), seg.get('price_override'))
        rows.append({'name': seg.get('name', ''), 'count': count,
                     'rate': rate, 'amount': rate * count})
        rates.add(rate)
    if not any(r['rate'] > 0 for r in rows) or len(rows) < 2 or len(rates) < 2:
        return None
    return rows


@dataclass(frozen=True)
class BookingTotals:
    taxable_subtotal: Decimal
    non_taxable_subtotal: Decimal
    subtotal: Decimal
    service_charge: Decimal
    tax_base: Decimal
    tax_amount: Decimal
    gratuity: Decimal
    total: Decimal


def compute_booking_totals(food_total, line_items, tax_rate,
                           service_charge_pct=0, service_charge_taxable=True,
                           gratuity_pct=0):
    """Compute booking totals: subtotal → service charge → tax → gratuity → total.

    - ``food_total``: Decimal — the food/menu cost (e.g. price_per_head × guests).
    - ``line_items``: iterable of objects each with ``.line_total`` (Decimal, already
      signed — discounts are negative).
    - ``tax_rate``: Decimal fraction (0.20 = 20%).
    - ``service_charge_pct`` / ``gratuity_pct``: **percentages** (20 = 20%), applied
      to the subtotal.
    - ``service_charge_taxable``: whether the service charge is added to the tax base.

    Pipeline: subtotal = food + items (discounts negative); service charge on the
    subtotal; tax on subtotal + (service charge if taxable); gratuity on the subtotal,
    **always post-tax and never taxed**; total = subtotal + service charge + tax +
    gratuity. Tax applies to the whole subtotal (no per-line split); the tax on/off
    decision lives at the caller (Quote passes its tax_rate; Event passes it only when
    taxable).

    All-percentages-zero reduces **exactly** to the pre-service-charge math
    (service_charge = gratuity = 0, tax_base = max(subtotal, 0)), which keeps every
    existing booking's stored totals unchanged — a saveable booking's subtotal is
    never negative.
    """
    food_total = Decimal(food_total or 0)
    tax_rate = Decimal(tax_rate or 0)
    service_charge_pct = Decimal(service_charge_pct or 0)
    gratuity_pct = Decimal(gratuity_pct or 0)

    items_total = sum((Decimal(item.line_total or 0) for item in line_items), Decimal('0.00'))
    subtotal = food_total + items_total
    # Percentage charges are taken on the subtotal but never on a NEGATIVE one: an
    # over-large discount used to flip the service charge and gratuity negative too,
    # which compounded the error instead of bounding it (a -$95,000 subtotal produced
    # a -$19,000 "service charge"). A charge on nothing is nothing. The save path
    # rejects a negative subtotal outright; this keeps the live preview — and any row
    # already stored that way — from showing a negative charge.
    charge_base = max(subtotal, Decimal('0.00'))
    # _round2 (HALF_UP), not a bare .quantize (Decimal defaults to HALF_EVEN): on a
    # .005 boundary the two rounding modes differ by a cent, and the frontend mirror
    # uses Math.round, which is half-up. Tax of 5% on 100.10 is exactly 5.005 — the
    # preview said 5.01 and the saved value was 5.00, so the total changed under the
    # user on save. segment_food_total already used _round2 for this exact reason.
    service_charge = _round2(charge_base * service_charge_pct / 100)
    # The tax base is clamped the same way: tax on a negative subtotal is NEGATIVE
    # tax (5% of -100 rendered as "-5.00" in the preview), and no authority pays a
    # caterer for granting discounts. Tax on nothing is nothing.
    tax_base = charge_base + (service_charge if service_charge_taxable else Decimal('0.00'))
    tax_amount = _round2(tax_base * tax_rate)
    gratuity = _round2(charge_base * gratuity_pct / 100)
    total = subtotal + service_charge + tax_amount + gratuity

    return BookingTotals(
        # The taxable/non-taxable split is gone — everything in the subtotal is taxed.
        # Fields kept (taxable_subtotal == subtotal) so existing callers don't break.
        taxable_subtotal=subtotal,
        non_taxable_subtotal=Decimal('0.00'),
        subtotal=subtotal,
        service_charge=service_charge,
        tax_base=tax_base,
        tax_amount=tax_amount,
        gratuity=gratuity,
        total=total,
    )
