"""Single source of truth for booking totals — used by BOTH quotes and events.

Do not re-implement this math anywhere else (serializers, views, models): call
`compute_booking_totals`. See docs/CODE_MAINTENANCE.md.
"""
import re
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

TWO_PLACES = Decimal('0.01')


def round2(x):
    """2-dp HALF_UP — matches the frontend `round2` (Math.round is half-up), not
    Decimal's default HALF_EVEN, so the two engines agree to the cent.

    **Public on purpose.** Every stored money value must round through here: a bare
    ``.quantize(Decimal('0.01'))`` is HALF_EVEN and silently disagrees with the live
    preview on an exact half-cent (1.50 × $0.03 stored $0.04 while the screen said
    $0.05 — REL-462 Bug 2).

    ``+ Decimal('0')`` normalises negative zero: rounding a tiny negative (or
    multiplying a negative subtotal by a zero rate) yields ``Decimal('-0.00')``,
    which renders as "-$0.00" on a customer-facing card. `parse_segment_rate` has
    always done this for the same reason; doing it here covers every money value the
    engine produces rather than the one field somebody remembered.
    """
    return Decimal(x).quantize(TWO_PLACES, rounding=ROUND_HALF_UP) + Decimal('0')


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
        return round2(o)
    mult = _usable_rate(price_multiplier)
    if mult is None:
        mult = Decimal('1')
    base = _usable_rate(price_per_head) or Decimal('0')
    return round2(base * mult)


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
    return round2(total)


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


def _item_amount(item):
    """One line's signed contribution to the subtotal.

    Accepts a model instance or anything else exposing ``line_total``, a mapping
    carrying that key, or a bare Decimal. Widened so the engine can hand its own
    priced rows straight in: they used to be wrapped in a private class whose only
    purpose was to grow a ``.line_total`` attribute, and then unwrapped again.
    """
    if isinstance(item, Decimal):
        return item
    value = item.get('line_total') if isinstance(item, dict) else getattr(item, 'line_total', None)
    return Decimal(value or 0)


@dataclass(frozen=True)
class BookingTotals:
    taxable_subtotal: Decimal
    non_taxable_subtotal: Decimal
    subtotal: Decimal
    # The base the two percentage charges were ACTUALLY taken on. Published rather
    # than left implicit so no caller re-derives `max(subtotal, 0)` for itself: a
    # second copy of that rule means a surface can print "20% service charge on $X"
    # where $X does not multiply out to the amount beside it.
    charge_base: Decimal
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

    items_total = sum((_item_amount(item) for item in line_items), Decimal('0.00'))
    subtotal = food_total + items_total
    # Percentage charges are taken on the subtotal but never on a NEGATIVE one: an
    # over-large discount used to flip the service charge and gratuity negative too,
    # which compounded the error instead of bounding it (a -$95,000 subtotal produced
    # a -$19,000 "service charge"). A charge on nothing is nothing. The save path
    # rejects a negative subtotal outright; this keeps the live preview — and any row
    # already stored that way — from showing a negative charge.
    charge_base = max(subtotal, Decimal('0.00'))
    # round2 (HALF_UP), not a bare .quantize (Decimal defaults to HALF_EVEN): on a
    # .005 boundary the two rounding modes differ by a cent, and the frontend mirror
    # uses Math.round, which is half-up. Tax of 5% on 100.10 is exactly 5.005 — the
    # preview said 5.01 and the saved value was 5.00, so the total changed under the
    # user on save. segment_food_total already used round2 for this exact reason.
    service_charge = round2(charge_base * service_charge_pct / 100)
    # The tax base is clamped the same way: tax on a negative subtotal is NEGATIVE
    # tax (5% of -100 rendered as "-5.00" in the preview), and no authority pays a
    # caterer for granting discounts. Tax on nothing is nothing.
    tax_base = charge_base + (service_charge if service_charge_taxable else Decimal('0.00'))
    tax_amount = round2(tax_base * tax_rate)
    gratuity = round2(charge_base * gratuity_pct / 100)
    total = subtotal + service_charge + tax_amount + gratuity

    return BookingTotals(
        # The taxable/non-taxable split is gone — everything in the subtotal is taxed.
        # Fields kept (taxable_subtotal == subtotal) so existing callers don't break.
        taxable_subtotal=subtotal,
        non_taxable_subtotal=Decimal('0.00'),
        subtotal=subtotal,
        charge_base=charge_base,
        service_charge=service_charge,
        tax_base=tax_base,
        tax_amount=tax_amount,
        gratuity=gratuity,
        total=total,
    )


# ════════════════════════════════════════════════════════════════════════════
# Pricing engine v2 — raw inputs in, every printable number out (REL-463)
# ════════════════════════════════════════════════════════════════════════════
#
# `compute_booking_totals` above takes PRE-CHEWED inputs: a `food_total` someone
# else summed, and line items whose `line_total` someone else computed. That left
# real arithmetic scattered across the surfaces — meals math duplicated verbatim in
# `Quote.food_total` and `Event.food_total`, line math in `BookingLineItem.save`,
# and the quote PDF inventing its own pre-tax total. Every fragment is a place the
# printed number can disagree with the stored one.
#
# `price_booking` below takes RAW material and returns every number any surface
# prints, so no caller ever needs arithmetic of its own. The pieces above are
# unchanged and still do the work — this widens the front door, it does not
# re-derive the math (existing stored totals must stay byte-identical).


LINE_UNIT_PER_GUEST = 'per_guest'
LINE_CATEGORY_DISCOUNT = 'discount'


def _line_number(value):
    """A line item's quantity or price as a Decimal, with junk becoming zero.

    Differs from `_usable_rate` in exactly one way, deliberately: a **negative is
    kept**. That one refuses a negative so a bad segment rate falls back to full
    price instead of paying the customer to attend; a line item is the opposite,
    because a discount is routinely typed as a negative price and the frontend
    passes those straight through.

    Everything else it screens the SAME way, and for the same reasons:

    * **one spelling of a number.** Strings go through `RATE_RE`, not straight to
      `Decimal`. `Decimal` accepts `"1_000"` and Unicode digits (`"١٢٣"`, `"５"`)
      while JS `Number` returns NaN for all of them — so without this a line posted
      as `1_000` bills $1,000 on the invoice and $0 in the live preview. Skipping
      the screen was justified as "mirroring `Number(x) || 0`", but it did the
      opposite of that.
    * **a magnitude bound.** `Decimal('1e400').is_finite()` is True in Python (it
      is JS that gives Infinity), so an unbounded value reaches `round2`, whose
      `quantize` raises `InvalidOperation` — a 500 on a pricing request rather than
      a priced line. This is the front door for raw input; it must not throw.
    """
    if value is None or value == '' or isinstance(value, bool):
        return Decimal('0')
    if isinstance(value, str):
        match = RATE_RE.match(value)
        if not match:
            return Decimal('0')
        sign, digits = match.groups()
        d = -Decimal(digits) if sign == '-' else Decimal(digits)
    else:
        try:
            d = Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            return Decimal('0')
    if not d.is_finite() or abs(d) > MAX_USABLE_RATE:
        return Decimal('0')
    return d


def line_item_total(unit, category, quantity, unit_price, guest_count=0):
    """What one add-on line is worth — the single definition of line-item math.

    Mirrors `lineItemTotal` in frontend/lib/quoteTotals.ts branch for branch:
    `per_guest` = price × guest_count (quantity ignored); `discount` = −|qty × price|;
    everything else (`each`, `flat`, `per_hour`) = qty × price.

    Branch ORDER is load-bearing and matches the mirror: `per_guest` is tested before
    `discount`, so a per-guest line in the discount category prices as a positive
    per-head charge. Pinned by a golden case rather than left to chance.

    Rounds HALF_UP via `round2`. The discount branch rounds the **magnitude** and
    applies the sign afterwards, as the frontend does — rounding −42.425 half-up
    would give −42.42 and quietly shrink the discount the customer was promised.
    """
    price = _line_number(unit_price)
    if unit == LINE_UNIT_PER_GUEST:
        return round2(price * Decimal(int(guest_count or 0)))
    qty = _line_number(quantity)
    if category == LINE_CATEGORY_DISCOUNT:
        return -round2(abs(qty * price))
    return round2(qty * price)


def meal_rows(meals):
    """Itemized additional-meal lines — ``[{label, count, rate, amount}]``.

    Each meal is rounded on its own (`round2(rate × count)`) and the amounts are
    summed, exactly as `mealsFood` does on the frontend. A meal priced at nothing —
    or with nobody eating — is left out entirely rather than printed as a zero row.

    **A meal is a charge, so a negative rate or a negative count is refused, not
    summed.** The old `food_total` loop this replaced added the raw value under a
    plain `if price and count`, so a negative `price_per_head` reduced the food
    total — but the frontend mirror never did (`if (price > 0 && count)`), which
    means that behaviour was a live parity break, not a feature to preserve. A
    per-head credit belongs in a `discount` line item, where both engines agree on
    the sign. Pinned in both engines by the shared `meal_cases`.
    """
    rows = []
    for meal in meals or ():
        rate = _usable_rate(meal.get('price_per_head')) or Decimal('0')
        count = int(meal.get('guest_count') or 0)
        if rate <= 0 or count <= 0:
            continue
        rows.append({
            'label': meal.get('label') or '',
            'count': count,
            'rate': round2(rate),
            'amount': round2(rate * count),
        })
    return rows


@dataclass(frozen=True)
class PricingInput:
    """Everything needed to price a booking, and nothing from the ORM.

    `segments` is exactly what `events.models.resolve_booking_segments` returns —
    dicts of ``{name, count, price_multiplier, price_override, counts_toward_total}``.
    `meals` are ``{label, price_per_head, guest_count}`` and `line_items` are
    ``{category, unit, quantity, unit_price, description, sort_order}``.

    `tax_rate` is the EFFECTIVE fraction (0.08 = 8%) — pass 0 when the booking isn't
    taxable, exactly as the models already decide. `service_charge_pct` and
    `gratuity_pct` are percentages (20 = 20%).
    """
    price_per_head: object = None
    guest_count: int = 0
    segments: tuple = ()
    meals: tuple = ()
    line_items: tuple = ()
    tax_rate: object = Decimal('0')
    service_charge_pct: object = Decimal('0')
    service_charge_taxable: bool = True
    gratuity_pct: object = Decimal('0')


@dataclass(frozen=True)
class PricingResult:
    """Every money number a surface could need, computed once.

    Grouped rather than flat so a caller can hand a whole section to a renderer:
    `food` for the menu block, `lines` for the add-ons block, `totals` for the
    summary, `rates` echoed so a document can print "20% service charge" without
    reaching back to the booking.
    """
    food: dict
    lines: dict
    totals: dict
    rates: dict

    def to_dict(self):
        """JSON-safe — every Decimal becomes a string, never a float.

        A float would reintroduce the very drift this engine exists to remove, so
        the wire format keeps numbers as text and lets the reader parse them exactly.

        **Money is rounded to cents; RATES ARE NOT.** `tax_rate` is a 4-dp fraction
        (`DecimalField(decimal_places=4)`), so quantizing it as though it were money
        turned 8.25% into `0.08` — and the rates block exists precisely so a document
        can print the rate without reaching back to the booking. That document would
        have printed "8% tax" beside a tax amount computed at 8.25%: two numbers on
        one customer-facing page that cannot both be true.
        """
        def walk(v, is_money=True):
            if isinstance(v, dict):
                return {k: walk(x, is_money) for k, x in v.items()}
            if isinstance(v, (list, tuple)):
                return [walk(x, is_money) for x in v]
            if isinstance(v, Decimal):
                return str(round2(v)) if is_money else str(v)
            return v

        return {
            'food': walk(self.food),
            'lines': walk(self.lines),
            'totals': walk(self.totals),
            # Rates keep their own precision — see above.
            'rates': walk(self.rates, is_money=False),
        }


def priced_line(raw, guest_count=0):
    """One raw line echoed back with its computed ``line_total``.

    A plain dict: `compute_booking_totals` reads the key directly (see
    `_item_amount`), so nothing needs wrapping in an object and unwrapping again.
    """
    return {
        'category': raw.get('category') or '',
        'unit': raw.get('unit') or '',
        'quantity': raw.get('quantity'),
        'unit_price': raw.get('unit_price'),
        'description': raw.get('description') or '',
        'sort_order': raw.get('sort_order') or 0,
        'line_total': line_item_total(
            raw.get('unit') or '', raw.get('category') or '',
            raw.get('quantity'), raw.get('unit_price'), guest_count,
        ),
    }


def price_booking(data: PricingInput) -> PricingResult:
    """Price a booking from raw inputs — the one place booking money is computed.

    Pipeline: menu food per segment → additional meals → food total → add-on lines →
    subtotal → service charge → tax → gratuity → total. Every intermediate a surface
    might print is returned, including `pre_tax_total` (subtotal + service charge),
    which the quote PDF used to derive for itself.

    A pure function of its input: no ORM, no I/O, no clock.
    """
    menu_food = segment_food_total(data.price_per_head, data.segments)
    food_rows = segment_food_rows(data.price_per_head, data.segments)
    rows = meal_rows(data.meals)
    meals_food = round2(sum((r['amount'] for r in rows), Decimal('0.00')))
    food_total = round2(menu_food + meals_food)

    priced = [priced_line(raw, data.guest_count) for raw in (data.line_items or ())]
    add_ons_subtotal = round2(
        sum((line['line_total'] for line in priced), Decimal('0.00')))

    totals = compute_booking_totals(
        food_total, priced, data.tax_rate,
        service_charge_pct=data.service_charge_pct,
        service_charge_taxable=data.service_charge_taxable,
        gratuity_pct=data.gratuity_pct,
    )

    return PricingResult(
        food={
            'menu_food': menu_food,
            'food_rows': food_rows,
            'meal_rows': rows,
            'meals_food': meals_food,
            'food_total': food_total,
        },
        lines={
            'items': priced,
            'add_ons_subtotal': add_ons_subtotal,
        },
        totals={
            'subtotal': totals.subtotal,
            # Surfaced from the engine, not re-derived here: a second copy of the
            # max(subtotal, 0) rule is a second thing to forget to update.
            'charge_base': totals.charge_base,
            'service_charge': totals.service_charge,
            # The number the quote PDF used to invent for itself.
            'pre_tax_total': totals.subtotal + totals.service_charge,
            'tax_base': totals.tax_base,
            'tax_amount': totals.tax_amount,
            'gratuity': totals.gratuity,
            'total': totals.total,
        },
        rates={
            'tax_rate': Decimal(data.tax_rate or 0),
            'service_charge_pct': Decimal(data.service_charge_pct or 0),
            'service_charge_taxable': bool(data.service_charge_taxable),
            'gratuity_pct': Decimal(data.gratuity_pct or 0),
        },
    )
