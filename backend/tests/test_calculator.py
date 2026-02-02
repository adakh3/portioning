from django.test import TestCase
from calculator.engine.calculator import calculate_portions, _select_budget_profile


class TestCalculatorIntegration(TestCase):
    """Integration tests that use seeded DB data."""

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_data', verbosity=0)

    def test_basic_calculation(self):
        """Calculate with a few protein dishes → valid structure."""
        from dishes.models import Dish
        dish_ids = list(
            Dish.objects.filter(is_active=True, category__pool='protein')
            .values_list('id', flat=True)[:5]
        )

        result = calculate_portions(
            dish_ids=dish_ids,
            guests={'gents': 50, 'ladies': 50},
        )
        self.assertIn('portions', result)
        self.assertIn('totals', result)
        self.assertIn('warnings', result)
        self.assertIn('adjustments_applied', result)
        self.assertEqual(len(result['portions']), len(dish_ids))
        self.assertGreater(result['totals']['food_per_gent_grams'], 0)
        # Protein columns should NOT be in output
        self.assertNotIn('protein_per_gent_grams', result['totals'])
        self.assertNotIn('protein_grams_per_gent', result['portions'][0])

    def test_empty_dishes(self):
        """No dishes → empty result with warning."""
        result = calculate_portions(
            dish_ids=[9999],
            guests={'gents': 10, 'ladies': 0},
        )
        self.assertEqual(len(result['portions']), 0)
        self.assertTrue(len(result['warnings']) > 0)

    def test_constraint_override(self):
        """Event override for max food should be respected."""
        from dishes.models import Dish
        dish_ids = list(
            Dish.objects.filter(is_active=True, category__pool='protein')
            .values_list('id', flat=True)
        )

        result = calculate_portions(
            dish_ids=dish_ids,
            guests={'gents': 50, 'ladies': 50},
            constraint_overrides={'max_total_food_per_person_grams': 400.0},
        )
        self.assertLessEqual(result['totals']['food_per_gent_grams'], 410.0)

    def test_service_dishes_fixed(self):
        """Service pool dishes get fixed portions."""
        from dishes.models import Dish
        salad = Dish.objects.filter(category__name='salad', is_active=True).first()
        bread = Dish.objects.filter(category__name='bread', is_active=True).first()
        if not salad or not bread:
            self.skipTest("Need salad and bread dishes seeded")

        result = calculate_portions(
            dish_ids=[salad.id, bread.id],
            guests={'gents': 50, 'ladies': 50},
        )
        portions_by_name = {p['dish_name']: p for p in result['portions']}
        self.assertAlmostEqual(portions_by_name[salad.name]['grams_per_gent'], 50.0, places=1)
        self.assertAlmostEqual(portions_by_name[bread.name]['grams_per_gent'], 1.0, places=1)

    def test_salad_category_max(self):
        """3 salads at 50g each should be capped at 100g total."""
        from dishes.models import Dish
        salads = list(Dish.objects.filter(category__name='salad', is_active=True)[:3])
        if len(salads) < 3:
            self.skipTest("Need 3+ salad dishes seeded")

        result = calculate_portions(
            dish_ids=[s.id for s in salads],
            guests={'gents': 50, 'ladies': 50},
        )
        salad_total = sum(
            p['grams_per_gent'] for p in result['portions']
            if p['category'] == 'Salad'
        )
        self.assertLessEqual(salad_total, 101)  # tolerance for rounding

    def test_dessert_pool_separate(self):
        """Dessert dishes use dessert pool, not protein pool."""
        from dishes.models import Dish
        dessert = Dish.objects.filter(category__name='dessert', is_active=True).first()
        curry = Dish.objects.filter(category__name='curry', is_active=True).first()
        if not dessert or not curry:
            self.skipTest("Need dessert and curry dishes seeded")

        result = calculate_portions(
            dish_ids=[dessert.id, curry.id],
            guests={'gents': 50, 'ladies': 50},
        )
        portions_by_name = {p['dish_name']: p for p in result['portions']}
        self.assertEqual(portions_by_name[dessert.name]['pool'], 'dessert')
        self.assertEqual(portions_by_name[curry.name]['pool'], 'protein')

    def test_mixed_pool_calculation(self):
        """Menu with protein + dessert + service all produce correct results."""
        from dishes.models import Dish
        curry = Dish.objects.filter(category__name='curry', is_active=True).first()
        rice = Dish.objects.filter(category__name='rice', is_active=True).first()
        dessert = Dish.objects.filter(category__name='dessert', is_active=True).first()
        salad = Dish.objects.filter(category__name='salad', is_active=True).first()

        if not all([curry, rice, dessert, salad]):
            self.skipTest("Need curry, rice, dessert, salad dishes seeded")

        result = calculate_portions(
            dish_ids=[curry.id, rice.id, dessert.id, salad.id],
            guests={'gents': 50, 'ladies': 50},
        )
        pools = {p['pool'] for p in result['portions']}
        self.assertIn('protein', pools)
        self.assertIn('dessert', pools)
        self.assertIn('service', pools)


class TestBudgetProfileSelection(TestCase):

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_data', verbosity=0)

    def _cat_ids(self, *names):
        from dishes.models import DishCategory
        return list(DishCategory.objects.filter(name__in=names).values_list('id', flat=True))

    def test_standard_profile_default(self):
        """Standard profile is selected as default."""
        cat_ids = self._cat_ids('dessert')
        profile = _select_budget_profile(cat_ids)
        self.assertTrue(profile.is_default)
        self.assertEqual(profile.name, 'Standard')

    def test_exact_match_grand(self):
        """All protein + dessert categories select Grand profile."""
        cat_ids = self._cat_ids('curry', 'dry_barbecue', 'rice', 'dessert')
        profile = _select_budget_profile(cat_ids)
        self.assertEqual(profile.name, 'Grand')

    def test_profile_ceiling_override_logged(self):
        """When a profile raises the ceiling, it should appear in adjustments."""
        from dishes.models import Dish
        # Grand profile matches curry + bbq + rice + dessert and raises ceiling to 700g
        curry = Dish.objects.filter(category__name='curry', is_active=True).first()
        bbq = Dish.objects.filter(category__name='dry_barbecue', is_active=True).first()
        rice = Dish.objects.filter(category__name='rice', is_active=True).first()
        dessert = Dish.objects.filter(category__name='dessert', is_active=True).first()

        result = calculate_portions(
            dish_ids=[curry.id, bbq.id, rice.id, dessert.id],
            guests={'gents': 50, 'ladies': 0},
        )
        ceiling_adjustments = [a for a in result['adjustments_applied'] if 'limit raised' in a]
        self.assertEqual(len(ceiling_adjustments), 1)
        self.assertIn('700', ceiling_adjustments[0])

    def test_default_profile_no_ceiling_adjustment(self):
        """Default profile (no ceiling override) should not produce an adjustment."""
        from dishes.models import Dish
        curry = Dish.objects.filter(category__name='curry', is_active=True).first()
        rice = Dish.objects.filter(category__name='rice', is_active=True).first()

        result = calculate_portions(
            dish_ids=[curry.id, rice.id],
            guests={'gents': 50, 'ladies': 0},
        )
        ceiling_adjustments = [a for a in result['adjustments_applied'] if 'limit raised' in a or 'limit lowered' in a]
        self.assertEqual(len(ceiling_adjustments), 0)
