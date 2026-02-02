from django.test import TestCase
from calculator.engine.models import DishInput
from calculator.engine.baseline import establish_category_budgets, apply_pool_ceiling, split_by_popularity


def make_dish(id, name, category_id, category_name, baseline_budget=190, min_per_dish=70,
              popularity=1.0, pool='protein', fixed_portion=None):
    return DishInput(
        id=id, name=name, category_id=category_id, category_name=category_name,
        protein_type="none", default_portion_grams=100,
        popularity=popularity, cost_per_gram=0.003, is_vegetarian=True,
        pool=pool, baseline_budget_grams=baseline_budget,
        min_per_dish_grams=min_per_dish, fixed_portion_grams=fixed_portion,
    )


class TestEstablishCategoryBudgets(TestCase):
    def test_single_dish_uses_baseline(self):
        """1 curry → max(190, 1*70) = 190g baseline."""
        dishes = [make_dish(1, "Curry A", 10, "Curry")]
        budgets, adj = establish_category_budgets(dishes)
        self.assertEqual(budgets[10], 190.0)

    def test_two_dishes_still_baseline(self):
        """2 curries → max(190, 2*70=140) = 190g, baseline wins."""
        dishes = [make_dish(i, f"Curry {i}", 10, "Curry") for i in range(1, 3)]
        budgets, adj = establish_category_budgets(dishes)
        self.assertEqual(budgets[10], 190.0)

    def test_three_dishes_expands(self):
        """3 curries → max(190, 3*70=210) = 210g, expanded."""
        dishes = [make_dish(i, f"Curry {i}", 10, "Curry") for i in range(1, 4)]
        budgets, adj = establish_category_budgets(dishes)
        self.assertEqual(budgets[10], 210.0)
        self.assertTrue(any("budget increased" in a for a in adj))

    def test_multiple_categories(self):
        """Curry (190) + BBQ (330) + Rice (70)."""
        dishes = [
            make_dish(1, "Curry", 10, "Curry", baseline_budget=190, min_per_dish=70),
            make_dish(2, "BBQ", 20, "BBQ", baseline_budget=330, min_per_dish=100),
            make_dish(3, "Rice", 30, "Rice", baseline_budget=70, min_per_dish=70),
        ]
        budgets, adj = establish_category_budgets(dishes)
        self.assertEqual(budgets[10], 190.0)
        self.assertEqual(budgets[20], 330.0)
        self.assertEqual(budgets[30], 70.0)


class TestGrowthModel(TestCase):
    """Test the per-dish budget growth model."""

    def test_single_dish_no_growth(self):
        """1 dish: growth formula = baseline * (1 + 0.2 * 0) = baseline."""
        dishes = [make_dish(1, "Curry A", 10, "Curry", baseline_budget=160)]
        budgets, adj = establish_category_budgets(dishes, growth_rate=0.2)
        self.assertEqual(budgets[10], 160.0)

    def test_two_dishes_grows_budget(self):
        """2 dishes: 160 * (1 + 0.2 * 1) = 192g."""
        dishes = [make_dish(i, f"Curry {i}", 10, "Curry", baseline_budget=160)
                  for i in range(1, 3)]
        budgets, adj = establish_category_budgets(dishes, growth_rate=0.2)
        self.assertAlmostEqual(budgets[10], 192.0)
        self.assertTrue(any("budget grew" in a for a in adj))

    def test_three_dishes_grows_budget(self):
        """3 dishes: 160 * (1 + 0.2 * 2) = 224g."""
        dishes = [make_dish(i, f"Curry {i}", 10, "Curry", baseline_budget=160)
                  for i in range(1, 4)]
        budgets, adj = establish_category_budgets(dishes, growth_rate=0.2)
        self.assertAlmostEqual(budgets[10], 224.0)

    def test_growth_still_respects_min_floor(self):
        """Many dishes where min_total > grown budget → min_total wins."""
        # 5 dishes: grown = 160 * (1 + 0.2 * 4) = 288g, min_total = 5 * 70 = 350g
        dishes = [make_dish(i, f"Curry {i}", 10, "Curry", baseline_budget=160)
                  for i in range(1, 6)]
        budgets, adj = establish_category_budgets(dishes, growth_rate=0.2)
        self.assertAlmostEqual(budgets[10], 350.0)
        self.assertTrue(any("budget increased" in a for a in adj))

    def test_partial_redistribution(self):
        """Absent budget only partially redistributes with fraction=0.7."""
        dishes = [make_dish(1, "Curry", 10, "Curry", baseline_budget=160)]
        pool_baselines = {10: 160, 20: 180}  # cat 20 absent (BBQ)
        budgets, adj = establish_category_budgets(
            dishes, pool_baselines, redistribution_fraction=0.7)
        # absent_budget = 180 * 0.7 = 126, all goes to curry
        self.assertAlmostEqual(budgets[10], 160 + 126, places=1)

    def test_full_redistribution_backward_compat(self):
        """redistribution_fraction=1.0 gives old behavior."""
        dishes = [make_dish(1, "Curry", 10, "Curry", baseline_budget=160)]
        pool_baselines = {10: 160, 20: 180}
        budgets, adj = establish_category_budgets(
            dishes, pool_baselines, redistribution_fraction=1.0)
        self.assertAlmostEqual(budgets[10], 160 + 180, places=1)

    def test_zero_growth_rate_backward_compat(self):
        """growth_rate=0.0 gives old max(baseline, min_total) behavior."""
        dishes = [make_dish(i, f"Curry {i}", 10, "Curry", baseline_budget=160)
                  for i in range(1, 3)]
        budgets, adj = establish_category_budgets(dishes, growth_rate=0.0)
        # 2 dishes: max(160, 140) = 160 (old behavior)
        self.assertEqual(budgets[10], 160.0)


class TestApplyPoolCeiling(TestCase):
    def test_no_reduction_under_ceiling(self):
        """Curry(190) + Rice(70) = 260 < 590 ceiling → no change."""
        dishes = [
            make_dish(1, "Curry", 10, "Curry"),
            make_dish(2, "Rice", 20, "Rice", baseline_budget=70, min_per_dish=70),
        ]
        budgets = {10: 190, 20: 70}
        reduced, scale, adj = apply_pool_ceiling(budgets, 590, dishes)
        self.assertEqual(scale, 1.0)
        self.assertEqual(reduced[10], 190)
        self.assertEqual(len(adj), 0)

    def test_proportional_reduction(self):
        """Over ceiling → proportional scale down."""
        dishes = [
            make_dish(1, "Curry", 10, "Curry"),
            make_dish(2, "BBQ", 20, "BBQ", baseline_budget=330, min_per_dish=100),
            make_dish(3, "Rice", 30, "Rice", baseline_budget=70, min_per_dish=70),
            make_dish(4, "Sides", 40, "Sides", baseline_budget=60, min_per_dish=30),
        ]
        # 190+330+70+60 = 650 > 590
        budgets = {10: 190, 20: 330, 30: 70, 40: 60}
        reduced, scale, adj = apply_pool_ceiling(budgets, 590, dishes)

        self.assertAlmostEqual(scale, 590 / 650, places=3)
        self.assertAlmostEqual(sum(reduced.values()), 590.0, places=1)
        self.assertTrue(len(adj) > 0)


class TestSplitByPopularity(TestCase):
    def test_equal_split_no_popularity(self):
        """Strength=0 → equal split."""
        dishes = [
            make_dish(1, "A", 10, "Curry", popularity=2.0),
            make_dish(2, "B", 10, "Curry", popularity=0.5),
        ]
        budgets = {10: 190}
        portions, adj = split_by_popularity(dishes, budgets, 0.0)
        self.assertAlmostEqual(portions[1], 95.0)
        self.assertAlmostEqual(portions[2], 95.0)

    def test_popularity_shifts_portions(self):
        """Strength > 0 → popular dish gets more."""
        dishes = [
            make_dish(1, "Popular", 10, "Curry", popularity=1.5),
            make_dish(2, "Less", 10, "Curry", popularity=0.5),
        ]
        budgets = {10: 190}
        portions, adj = split_by_popularity(dishes, budgets, 0.3)
        self.assertGreater(portions[1], portions[2])
        self.assertAlmostEqual(portions[1] + portions[2], 190.0, places=1)

    def test_min_per_dish_enforced(self):
        """Very unpopular dish still gets min_per_dish."""
        dishes = [
            make_dish(1, "Popular", 10, "Curry", popularity=10.0),
            make_dish(2, "Unpopular", 10, "Curry", popularity=0.01),
        ]
        budgets = {10: 190}
        portions, adj = split_by_popularity(dishes, budgets, 1.0)
        self.assertGreaterEqual(portions[2], 70.0)

    def test_scaled_min_per_dish(self):
        """Scale factor reduces effective min_per_dish."""
        dishes = [
            make_dish(1, "Popular", 10, "Curry", popularity=10.0),
            make_dish(2, "Unpopular", 10, "Curry", popularity=0.01),
        ]
        budgets = {10: 190}
        portions, adj = split_by_popularity(dishes, budgets, 1.0, scale_factor=0.5)
        # min_per_dish = 70 * 0.5 = 35
        self.assertGreaterEqual(portions[2], 35.0)
