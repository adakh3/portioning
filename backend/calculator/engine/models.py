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
class GuestMix:
    gents: int = 0
    ladies: int = 0

    @property
    def total(self):
        return self.gents + self.ladies


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
