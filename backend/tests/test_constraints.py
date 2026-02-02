from django.test import TestCase
from calculator.engine.models import DishInput, ResolvedConstraints
from calculator.engine.constraints import enforce_category_constraints, enforce_global_constraints


def make_dish(id, name, category_id, category_name, **kw):
    return DishInput(
        id=id, name=name, category_id=category_id, category_name=category_name,
        protein_type=kw.get("protein_type", "none"),
        default_portion_grams=100,
        popularity=1.0, cost_per_gram=0.003, is_vegetarian=True,
        pool='protein', baseline_budget_grams=190, min_per_dish_grams=70,
    )


class TestCategoryConstraints(TestCase):
    def test_category_total_cap(self):
        """3 salads at 50g each = 150g > 100g cap → scaled down."""
        dishes = [
            DishInput(id=i, name=f"Salad {i}", category_id=50, category_name="Salad",
                      protein_type="none", default_portion_grams=50, popularity=1.0, cost_per_gram=0.001, is_vegetarian=True,
                      pool='service', baseline_budget_grams=0, min_per_dish_grams=0,
                      fixed_portion_grams=50)
            for i in range(1, 4)
        ]
        portions = {1: 50, 2: 50, 3: 50}
        constraints = ResolvedConstraints(
            category_max_totals={50: 100},
            category_min_portions={50: 30},
        )

        portions, adj = enforce_category_constraints(portions, dishes, constraints)
        total = sum(portions.values())
        self.assertAlmostEqual(total, 100.0, places=0)
        # Each should be at least 30g (min)
        for d in dishes:
            self.assertGreaterEqual(portions[d.id], 30.0)

    def test_no_cap_when_under(self):
        """2 salads at 50g = 100g, exactly at cap → no change."""
        dishes = [
            DishInput(id=i, name=f"Salad {i}", category_id=50, category_name="Salad",
                      protein_type="none", default_portion_grams=50, popularity=1.0, cost_per_gram=0.001, is_vegetarian=True,
                      pool='service', baseline_budget_grams=0, min_per_dish_grams=0,
                      fixed_portion_grams=50)
            for i in range(1, 3)
        ]
        portions = {1: 50, 2: 50}
        constraints = ResolvedConstraints(category_max_totals={50: 100})

        portions, adj = enforce_category_constraints(portions, dishes, constraints)
        self.assertEqual(portions[1], 50)
        self.assertEqual(portions[2], 50)
        self.assertEqual(len(adj), 0)


class TestGlobalConstraints(TestCase):
    def test_global_food_cap(self):
        """Total > max food → all portions scaled down."""
        dishes = [
            make_dish(1, "A", 10, "Curry"),
            make_dish(2, "B", 20, "Rice"),
        ]
        portions = {1: 400.0, 2: 400.0}
        constraints = ResolvedConstraints(max_total_food_per_person_grams=700)

        portions, warnings, adj = enforce_global_constraints(portions, dishes, constraints)
        total = sum(portions.values())
        self.assertAlmostEqual(total, 700.0, places=0)
        self.assertTrue(len(warnings) > 0)

    def test_no_warnings_when_within_limits(self):
        """Everything within limits → no warnings."""
        dishes = [make_dish(1, "A", 10, "Curry")]
        portions = {1: 100.0}
        constraints = ResolvedConstraints()

        portions, warnings, adj = enforce_global_constraints(portions, dishes, constraints)
        self.assertEqual(len(warnings), 0)

    def test_floor_conflict_warning(self):
        """When cap forces portion below min → warning emitted."""
        dishes = [make_dish(i, f"D{i}", 10, "Curry") for i in range(1, 26)]
        portions = {d.id: 28.0 for d in dishes}
        constraints = ResolvedConstraints(
            max_total_food_per_person_grams=700,
            min_portion_per_dish_grams=30,
        )

        portions, warnings, adj = enforce_global_constraints(portions, dishes, constraints)
        floor_warnings = [w for w in warnings if "Cannot satisfy" in w]
        self.assertTrue(len(floor_warnings) > 0)
