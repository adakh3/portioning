from django.test import TestCase
from calculator.engine.checker import check_user_portions
from calculator.engine.models import DishInput, GuestMix, ResolvedConstraints


def _make_dish(id, name, category_id=1, category_name='Curry', pool='protein',
               **kwargs):
    defaults = dict(
        protein_type='chicken', default_portion_grams=100,
        popularity=1.0, cost_per_gram=0.01, is_vegetarian=False,
        unit='kg', baseline_budget_grams=200, min_per_dish_grams=30,
        fixed_portion_grams=None,
    )
    defaults.update(kwargs)
    return DishInput(
        id=id, name=name, category_id=category_id,
        category_name=category_name, pool=pool, **defaults,
    )


class TestCheckUserPortions(TestCase):
    """Unit tests for the check_user_portions pure function."""

    def setUp(self):
        self.dishes = [
            _make_dish(1, 'Chicken Curry', category_id=1, category_name='Curry'),
            _make_dish(2, 'Lamb Biryani', category_id=1, category_name='Curry'),
            _make_dish(3, 'Rice', category_id=2, category_name='Rice',
                       pool='accompaniment', ),
        ]
        self.constraints = ResolvedConstraints(
            max_total_food_per_person_grams=800,
            min_portion_per_dish_grams=30,
        )
        self.pool_ceilings = {
            'protein': 500,
            'accompaniment': 200,
            'dessert': 150,
        }
        self.guest_mix = GuestMix(gents=50, ladies=50)

    def test_valid_portions_no_violations(self):
        """Portions within all constraints produce 0 violations."""
        user_portions = {1: 150, 2: 150, 3: 100}
        result = check_user_portions(
            user_portions=user_portions,
            dishes=self.dishes,
            constraints=self.constraints,
            pool_ceilings=self.pool_ceilings,
            guest_mix=self.guest_mix,
        )
        self.assertEqual(len(result['violations']), 0)
        self.assertEqual(len(result['user_portions_expanded']), 3)
        self.assertIn('totals', result)

    def test_pool_ceiling_exceeded(self):
        """Protein pool total exceeding ceiling produces pool_ceiling violation."""
        user_portions = {1: 300, 2: 300, 3: 100}  # 600 > 500
        result = check_user_portions(
            user_portions=user_portions,
            dishes=self.dishes,
            constraints=self.constraints,
            pool_ceilings=self.pool_ceilings,
            guest_mix=self.guest_mix,
        )
        pool_violations = [v for v in result['violations'] if v['type'] == 'pool_ceiling']
        self.assertEqual(len(pool_violations), 1)
        self.assertEqual(pool_violations[0]['pool'], 'protein')
        self.assertEqual(pool_violations[0]['severity'], 'error')

    def test_below_minimum_violation(self):
        """Portion below category minimum produces below_minimum violation."""
        user_portions = {1: 10, 2: 150, 3: 100}  # 10 < 30
        result = check_user_portions(
            user_portions=user_portions,
            dishes=self.dishes,
            constraints=self.constraints,
            pool_ceilings=self.pool_ceilings,
            guest_mix=self.guest_mix,
        )
        min_violations = [v for v in result['violations'] if v['type'] == 'below_minimum']
        self.assertTrue(len(min_violations) >= 1)
        self.assertEqual(min_violations[0]['dish_id'], 1)

    def test_max_total_food_exceeded(self):
        """Total food exceeding global cap produces max_total_food violation."""
        user_portions = {1: 400, 2: 400, 3: 200}  # 1000 > 800
        result = check_user_portions(
            user_portions=user_portions,
            dishes=self.dishes,
            constraints=self.constraints,
            pool_ceilings=self.pool_ceilings,
            guest_mix=self.guest_mix,
        )
        food_violations = [v for v in result['violations'] if v['type'] == 'max_total_food']
        self.assertEqual(len(food_violations), 1)
        self.assertEqual(food_violations[0]['severity'], 'error')

    def test_comparison_deltas_computed(self):
        """user_portions_expanded contains correct grams per person."""
        user_portions = {1: 200, 2: 100, 3: 80}
        result = check_user_portions(
            user_portions=user_portions,
            dishes=self.dishes,
            constraints=self.constraints,
            pool_ceilings=self.pool_ceilings,
            guest_mix=self.guest_mix,
        )
        expanded = {r['dish_id']: r for r in result['user_portions_expanded']}
        # Without big_eaters (mult=1.0), ladies_mult=1.0 by default
        # grams_per_person should equal the user input
        self.assertEqual(expanded[1]['grams_per_person'], 200)
        self.assertEqual(expanded[2]['grams_per_person'], 100)

    def test_big_eaters_expansion(self):
        """Big eaters multiplier is applied correctly."""
        user_portions = {1: 100, 2: 100, 3: 100}
        result = check_user_portions(
            user_portions=user_portions,
            dishes=self.dishes,
            constraints=self.constraints,
            pool_ceilings=self.pool_ceilings,
            guest_mix=self.guest_mix,
            big_eaters=True,
            big_eaters_percentage=20.0,
        )
        expanded = {r['dish_id']: r for r in result['user_portions_expanded']}
        # 100 * 1.2 = 120
        self.assertEqual(expanded[1]['grams_per_gent'], 120)

    def test_qty_dishes_skip_gram_minimum(self):
        """Qty-unit dishes (e.g. naan) should not trigger the 30g minimum."""
        dishes_with_bread = self.dishes + [
            _make_dish(4, 'Naan', category_id=3, category_name='Bread',
                       pool='service', unit='qty', ),
        ]
        user_portions = {1: 150, 2: 150, 3: 100, 4: 1}  # 1 naan
        result = check_user_portions(
            user_portions=user_portions,
            dishes=dishes_with_bread,
            constraints=self.constraints,
            pool_ceilings=self.pool_ceilings,
            guest_mix=self.guest_mix,
        )
        min_violations = [v for v in result['violations'] if v['type'] == 'below_minimum']
        naan_violations = [v for v in min_violations if v['dish_id'] == 4]
        self.assertEqual(len(naan_violations), 0,
                         "Qty-unit dish should not get gram-based minimum violation")

    def test_qty_dishes_excluded_from_food_total(self):
        """Qty-unit dishes should not count toward the global food gram cap."""
        dishes_with_bread = self.dishes + [
            _make_dish(4, 'Naan', category_id=3, category_name='Bread',
                       pool='service', unit='qty', ),
        ]
        # Just under the 800g cap for weight-based dishes
        user_portions = {1: 300, 2: 300, 3: 190, 4: 2}
        result = check_user_portions(
            user_portions=user_portions,
            dishes=dishes_with_bread,
            constraints=self.constraints,
            pool_ceilings=self.pool_ceilings,
            guest_mix=self.guest_mix,
        )
        food_violations = [v for v in result['violations'] if v['type'] == 'max_total_food']
        self.assertEqual(len(food_violations), 0,
                         "Qty-unit dish should not push total over food cap")

    def test_category_max_total_exceeded(self):
        """Category total cap produces category_total violation."""
        self.constraints.category_max_totals[1] = 250  # Curry category cap
        user_portions = {1: 200, 2: 200, 3: 100}  # Curry total = 400 > 250
        result = check_user_portions(
            user_portions=user_portions,
            dishes=self.dishes,
            constraints=self.constraints,
            pool_ceilings=self.pool_ceilings,
            guest_mix=self.guest_mix,
        )
        cat_violations = [v for v in result['violations'] if v['type'] == 'category_total']
        self.assertEqual(len(cat_violations), 1)


class TestCheckPortionsAPI(TestCase):
    """Integration tests for the /api/check-portions/ endpoint."""

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_data', verbosity=0)

    def _get_dish_ids(self, pool='protein', count=3):
        from dishes.models import Dish
        return list(
            Dish.objects.filter(is_active=True, category__pool=pool)
            .values_list('id', flat=True)[:count]
        )

    def test_valid_request(self):
        """Valid check-portions request returns comparison data."""
        dish_ids = self._get_dish_ids()
        user_portions = [{'dish_id': d, 'grams_per_person': 100} for d in dish_ids]
        resp = self.client.post('/api/check-portions/', data={
            'dish_ids': dish_ids,
            'guests': {'gents': 50, 'ladies': 50},
            'user_portions': user_portions,
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn('violations', body)
        self.assertIn('comparison', body)
        self.assertIn('engine_portions', body)
        self.assertEqual(len(body['comparison']), len(dish_ids))

    def test_missing_portion_dish_returns_400(self):
        """Missing a dish in user_portions returns 400."""
        dish_ids = self._get_dish_ids()
        user_portions = [{'dish_id': dish_ids[0], 'grams_per_person': 100}]
        resp = self.client.post('/api/check-portions/', data={
            'dish_ids': dish_ids,
            'guests': {'gents': 50, 'ladies': 50},
            'user_portions': user_portions,
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_extra_dish_returns_400(self):
        """Extra dish in user_portions not in dish_ids returns 400."""
        dish_ids = self._get_dish_ids(count=2)
        user_portions = [
            {'dish_id': d, 'grams_per_person': 100} for d in dish_ids
        ] + [{'dish_id': 99999, 'grams_per_person': 50}]
        resp = self.client.post('/api/check-portions/', data={
            'dish_ids': dish_ids,
            'guests': {'gents': 50, 'ladies': 50},
            'user_portions': user_portions,
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)
