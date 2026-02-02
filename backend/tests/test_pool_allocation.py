"""Tests for the pool-based allocation engine."""
from django.test import TestCase
from calculator.engine.models import DishInput
from calculator.engine.baseline import establish_category_budgets, apply_pool_ceiling, split_by_popularity


def make_dish(id, name, category_id, category_name, baseline_budget=190, min_per_dish=70,
              popularity=1.0, pool='protein'):
    return DishInput(
        id=id, name=name, category_id=category_id, category_name=category_name,
        protein_type="none", default_portion_grams=100,
        popularity=popularity, cost_per_gram=0.003, is_vegetarian=False,
        pool=pool, baseline_budget_grams=baseline_budget,
        min_per_dish_grams=min_per_dish,
    )


class TestBaselineEstablishment(TestCase):
    """Test that category budgets follow max(baseline, n * min_per_dish)."""

    def test_single_curry_uses_baseline(self):
        dishes = [make_dish(1, "Mutton Qorma", 10, "Curry")]
        budgets, _ = establish_category_budgets(dishes)
        self.assertEqual(budgets[10], 190)

    def test_two_curries_still_baseline(self):
        """2 * 70 = 140 < 190 → baseline wins."""
        dishes = [make_dish(i, f"Curry {i}", 10, "Curry") for i in range(1, 3)]
        budgets, _ = establish_category_budgets(dishes)
        self.assertEqual(budgets[10], 190)

    def test_three_curries_expands(self):
        """3 * 70 = 210 > 190 → expanded."""
        dishes = [make_dish(i, f"Curry {i}", 10, "Curry") for i in range(1, 4)]
        budgets, adj = establish_category_budgets(dishes)
        self.assertEqual(budgets[10], 210)
        self.assertTrue(any("budget increased" in a for a in adj))

    def test_bbq_baseline(self):
        """BBQ with baseline 330, min 100."""
        dishes = [make_dish(1, "BBQ 1", 20, "BBQ", baseline_budget=330, min_per_dish=100)]
        budgets, _ = establish_category_budgets(dishes)
        self.assertEqual(budgets[20], 330)

    def test_bbq_three_dishes_still_baseline(self):
        """3 BBQ * 100 = 300 < 330 → baseline wins."""
        dishes = [make_dish(i, f"BBQ {i}", 20, "BBQ", baseline_budget=330, min_per_dish=100)
                  for i in range(1, 4)]
        budgets, _ = establish_category_budgets(dishes)
        self.assertEqual(budgets[20], 330)

    def test_bbq_four_dishes_expands(self):
        """4 BBQ * 100 = 400 > 330 → expanded."""
        dishes = [make_dish(i, f"BBQ {i}", 20, "BBQ", baseline_budget=330, min_per_dish=100)
                  for i in range(1, 5)]
        budgets, adj = establish_category_budgets(dishes)
        self.assertEqual(budgets[20], 400)


class TestCeilingEnforcement(TestCase):
    """Test that pool ceilings proportionally reduce all categories."""

    def test_standard_menu_no_compression(self):
        """BBQ(330) + curry(190) + rice(70) = 590 = ceiling → no reduction."""
        dishes = [
            make_dish(1, "Curry", 10, "Curry"),
            make_dish(2, "BBQ", 20, "BBQ", baseline_budget=330, min_per_dish=100),
            make_dish(3, "Rice", 30, "Rice", baseline_budget=70, min_per_dish=70),
        ]
        budgets = {10: 190, 20: 330, 30: 70}
        reduced, scale, adj = apply_pool_ceiling(budgets, 590, dishes)
        self.assertEqual(scale, 1.0)
        self.assertEqual(len(adj), 0)

    def test_with_sides_over_ceiling(self):
        """BBQ(330) + curry(190) + rice(70) + sides(60) = 650 > 590."""
        dishes = [
            make_dish(1, "Curry", 10, "Curry"),
            make_dish(2, "BBQ", 20, "BBQ", baseline_budget=330, min_per_dish=100),
            make_dish(3, "Rice", 30, "Rice", baseline_budget=70, min_per_dish=70),
            make_dish(4, "Sides", 40, "Sides", baseline_budget=60, min_per_dish=30),
        ]
        budgets = {10: 190, 20: 330, 30: 70, 40: 60}
        reduced, scale, adj = apply_pool_ceiling(budgets, 590, dishes)

        expected_scale = 590 / 650
        self.assertAlmostEqual(scale, expected_scale, places=3)
        self.assertAlmostEqual(sum(reduced.values()), 590.0, places=1)

    def test_curry_only_no_compression(self):
        """Curry only: 190 < 590 → no reduction."""
        dishes = [make_dish(1, "Curry", 10, "Curry")]
        budgets = {10: 190}
        _, scale, _ = apply_pool_ceiling(budgets, 590, dishes)
        self.assertEqual(scale, 1.0)


class TestPopularitySplit(TestCase):
    """Test within-category popularity-based splitting."""

    def test_equal_popularity_equal_split(self):
        dishes = [
            make_dish(1, "A", 10, "Curry", popularity=1.0),
            make_dish(2, "B", 10, "Curry", popularity=1.0),
        ]
        budgets = {10: 190}
        portions, _ = split_by_popularity(dishes, budgets, 0.3)
        self.assertAlmostEqual(portions[1], 95, places=1)
        self.assertAlmostEqual(portions[2], 95, places=1)

    def test_popular_gets_more(self):
        dishes = [
            make_dish(1, "Popular", 10, "Curry", popularity=1.5),
            make_dish(2, "Less", 10, "Curry", popularity=0.5),
        ]
        budgets = {10: 190}
        portions, _ = split_by_popularity(dishes, budgets, 0.3)
        self.assertGreater(portions[1], portions[2])
        self.assertAlmostEqual(portions[1] + portions[2], 190, places=1)

    def test_floors_respected(self):
        dishes = [
            make_dish(1, "Star", 10, "Curry", popularity=100.0),
            make_dish(2, "Dud", 10, "Curry", popularity=0.001),
        ]
        budgets = {10: 190}
        portions, _ = split_by_popularity(dishes, budgets, 1.0)
        self.assertGreaterEqual(portions[2], 70)


class TestIntegrationWithSeedData(TestCase):
    """Integration tests using seeded data — Majestic Celebration verification."""

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_data', verbosity=0)

    def test_majestic_celebration_protein_pool(self):
        """Majestic Celebration: BBQ(2)+curry(2)+rice(1).
        With growth_rate=0.2:
        BBQ(2): 180*(1+0.2*1)=216, curry(2): 160*(1+0.2*1)=192, rice(1): 100
        All 3 protein categories present → no redistribution.
        Total = 508g (under 590 ceiling)."""
        from dishes.models import Dish
        from calculator.engine.calculator import calculate_portions

        menu_dishes = ['Mutton Seekh Kabab', 'Chicken Tandoori Boti',
                       'Mutton Qorma', 'Lahori Chicken Karahi', 'Matka Biryani']
        dish_ids = list(
            Dish.objects.filter(name__in=menu_dishes, is_active=True)
            .values_list('id', flat=True)
        )

        result = calculate_portions(
            dish_ids=dish_ids,
            guests={'gents': 50, 'ladies': 50},
        )

        protein_total = sum(
            p['grams_per_gent'] for p in result['portions']
            if p['pool'] == 'protein'
        )
        # BBQ=216, curry=192, rice=100 = 508g
        self.assertAlmostEqual(protein_total, 508, delta=5)

    def test_heritage_elegance_over_allocated(self):
        """Heritage Elegance: over-allocated menu → engine compresses to ~590g."""
        from dishes.models import Dish
        from calculator.engine.calculator import calculate_portions

        menu_dishes = ['Whole Mutton Roast', 'Chicken Boti Tikka', 'Seekh Kabab',
                       'Mutton Qorma', 'Chicken Qorma', 'Chicken Biryani']
        dish_ids = list(
            Dish.objects.filter(name__in=menu_dishes, is_active=True)
            .values_list('id', flat=True)
        )

        result = calculate_portions(
            dish_ids=dish_ids,
            guests={'gents': 50, 'ladies': 50},
        )

        protein_total = sum(
            p['grams_per_gent'] for p in result['portions']
            if p['pool'] == 'protein'
        )
        # 3 BBQ (330) + 2 curry (190) + 1 rice (70) = 590, at ceiling
        self.assertLessEqual(protein_total, 595)
        self.assertGreater(protein_total, 550)

    def test_no_protein_in_output(self):
        """Verify protein columns are not in API output."""
        from dishes.models import Dish
        from calculator.engine.calculator import calculate_portions

        curry = Dish.objects.filter(category__name='curry', is_active=True).first()
        result = calculate_portions(
            dish_ids=[curry.id],
            guests={'gents': 50, 'ladies': 50},
        )
        self.assertNotIn('protein_per_gent_grams', result['totals'])
        self.assertNotIn('protein_grams_per_gent', result['portions'][0])
