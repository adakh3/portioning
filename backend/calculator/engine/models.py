"""Dataclasses for calculation pipeline I/O."""
from dataclasses import dataclass, field


@dataclass
class DishInput:
    id: int
    name: str
    category_id: int
    category_name: str
    protein_type: str
    default_portion_grams: float
    popularity: float
    cost_per_gram: float
    is_vegetarian: bool
    protein_is_additive: bool = False
    pool: str = 'protein'
    unit: str = 'kg'
    baseline_budget_grams: float = 0.0
    min_per_dish_grams: float = 0.0
    fixed_portion_grams: float = None


@dataclass
class Segment:
    """One named guest bucket entering the engine as plain data (no ORM).

    ``portion_multiplier`` scales food vs the base (1.0). ``counts_toward_total``
    distinguishes in-count segments (Adults, Kids) from additional covers
    (Vendor meals) — portions are computed over ALL covers regardless; the flag
    only matters for count validation/display upstream.
    """
    name: str
    count: int = 0
    portion_multiplier: float = 1.0
    counts_toward_total: bool = True


@dataclass
class GuestMix:
    """Legacy two-segment (gents/ladies) guest mix.

    Retained as a thin adapter so existing callers can keep passing
    ``{'gents': N, 'ladies': M}``; ``to_segments`` expands it to the general
    N-segment form the engine now works in. Gents is the base (multiplier 1.0);
    ladies scales by the org's ladies multiplier.
    """
    gents: int = 0
    ladies: int = 0

    @property
    def total(self):
        return self.gents + self.ladies

    def to_segments(self, ladies_multiplier=1.0):
        return [
            Segment('gents', self.gents, 1.0, True),
            Segment('ladies', self.ladies, ladies_multiplier, True),
        ]


@dataclass
class ResolvedConstraints:
    max_total_food_per_person_grams: float = 1000.0
    min_portion_per_dish_grams: float = 30.0
    category_min_portions: dict = field(default_factory=dict)
    category_max_portions: dict = field(default_factory=dict)
    category_max_totals: dict = field(default_factory=dict)


@dataclass
class DishResult:
    dish_id: int
    dish_name: str
    category: str
    protein_type: str
    grams_per_gent: float
    grams_per_lady: float
    total_grams: float
    cost_per_gent: float
    total_cost: float


@dataclass
class CalculationResult:
    portions: list
    totals: dict
    warnings: list = field(default_factory=list)
    adjustments_applied: list = field(default_factory=list)
