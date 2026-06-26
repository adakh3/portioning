"""Pure commission math — no Django/ORM dependencies (mirrors calculator/engine).

The org admin picks one of two models:

- ``flat``        — one rate applied to all won revenue in the period.
- ``accelerated`` — marginal bands keyed to target attainment. Revenue between
  one band's threshold and the next earns that band's rate. Crossing target
  makes each additional unit of revenue worth more, which is the motivator.

Bands are expressed as *attainment thresholds* (percent of target). A band
starting at ``min_attainment_pct`` begins, in revenue terms, at
``(min_attainment_pct / 100) * target``. The last band is open-ended.

All inputs/outputs are ``Decimal``. Callers round for display.
"""
from decimal import Decimal

FLAT = "flat"
ACCELERATED = "accelerated"


def _d(value):
    return value if isinstance(value, Decimal) else Decimal(str(value or 0))


def compute_commission(revenue, target, *, model, flat_rate, bands):
    """Return the commission breakdown for one period.

    revenue   total won revenue in the period
    target    the rep's target for the period (may be 0 / None)
    model     FLAT or ACCELERATED
    flat_rate percent (e.g. Decimal('5') == 5%), used when model == FLAT
    bands     iterable of (min_attainment_pct, rate) for ACCELERATED, any order

    Returns dict:
        commission       total commission (Decimal)
        attainment_pct   revenue / target * 100 (0 when target <= 0)
        breakdown        list of {from_pct, to_pct, rate, revenue_in_band, commission}
    """
    # Clamp to non-negative — revenue/target are never negative in practice
    # (won_quote.total >= 0), so this just hardens against bad config/data.
    revenue = max(Decimal(0), _d(revenue))
    target = max(Decimal(0), _d(target))
    attainment = (revenue / target * 100) if target > 0 else Decimal(0)

    # Flat — also the safe fallback when there are no bands or no target to
    # measure attainment against (accelerated is meaningless without a target).
    if model != ACCELERATED or not bands or target <= 0:
        rate = _d(flat_rate)
        commission = revenue * rate / 100
        return {
            "commission": commission,
            "attainment_pct": attainment,
            "breakdown": [
                {
                    "from_pct": Decimal(0),
                    "to_pct": None,
                    "rate": rate,
                    "revenue_in_band": revenue,
                    "commission": commission,
                }
            ],
        }

    sorted_bands = sorted(((_d(p), _d(r)) for p, r in bands), key=lambda b: b[0])

    commission = Decimal(0)
    breakdown = []
    for i, (min_pct, rate) in enumerate(sorted_bands):
        band_start = min_pct / 100 * target
        next_pct = sorted_bands[i + 1][0] if i + 1 < len(sorted_bands) else None
        band_end = (next_pct / 100 * target) if next_pct is not None else None

        if revenue <= band_start:
            continue
        upper = revenue if band_end is None else min(revenue, band_end)
        revenue_in_band = upper - band_start
        if revenue_in_band <= 0:
            continue

        band_commission = revenue_in_band * rate / 100
        commission += band_commission
        breakdown.append(
            {
                "from_pct": min_pct,
                "to_pct": next_pct,
                "rate": rate,
                "revenue_in_band": revenue_in_band,
                "commission": band_commission,
            }
        )

    return {"commission": commission, "attainment_pct": attainment, "breakdown": breakdown}
