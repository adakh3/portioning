from django.test import TestCase
from rest_framework.test import APIClient


class TestAPI(TestCase):
    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.client = APIClient()

    def test_list_dishes(self):
        res = self.client.get('/api/dishes/')
        self.assertEqual(res.status_code, 200)
        self.assertGreater(len(res.json()), 0)

    def test_list_categories(self):
        res = self.client.get('/api/categories/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreater(len(data), 0)
        self.assertIn('pool', data[0])
        self.assertIn('unit', data[0])
        self.assertIn('baseline_budget_grams', data[0])

    def test_list_menus(self):
        res = self.client.get('/api/menus/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreater(len(data), 0)
        self.assertIn('dish_count', data[0])

    def test_menu_detail(self):
        from menus.models import MenuTemplate
        menu = MenuTemplate.objects.first()
        res = self.client.get(f'/api/menus/{menu.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('portions', res.json())

    def test_calculate_endpoint(self):
        from dishes.models import Dish
        dish_ids = list(Dish.objects.filter(is_active=True).values_list('id', flat=True)[:5])
        res = self.client.post('/api/calculate/', {
            'dish_ids': dish_ids,
            'guests': {'gents': 40, 'ladies': 40},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn('portions', data)
        self.assertIn('totals', data)
        self.assertEqual(len(data['portions']), len(dish_ids))
        # Protein total present
        self.assertIn('protein_per_person_grams', data['totals'])

    def test_calculate_with_override(self):
        from dishes.models import Dish
        dish_ids = list(
            Dish.objects.filter(is_active=True, category__pool='protein')
            .values_list('id', flat=True)
        )
        res = self.client.post('/api/calculate/', {
            'dish_ids': dish_ids,
            'guests': {'gents': 50, 'ladies': 50},
            'constraint_overrides': {
                'max_total_food_per_person_grams': 400,
            },
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertLessEqual(res.json()['totals']['food_per_gent_grams'], 410)

    def test_list_events(self):
        res = self.client.get('/api/events/')
        self.assertEqual(res.status_code, 200)

    def test_create_event(self):
        from dishes.models import Dish
        dish_ids = list(Dish.objects.filter(is_active=True).values_list('id', flat=True)[:3])
        res = self.client.post('/api/events/', {
            'name': 'Test Event',
            'date': '2026-03-15',
            'gents': 50,
            'ladies': 50,
            'dish_ids': dish_ids,
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()['name'], 'Test Event')

    def test_menu_preview(self):
        from menus.models import MenuTemplate
        menu = MenuTemplate.objects.first()
        res = self.client.get(f'/api/menus/{menu.id}/preview/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        # Correct shape
        self.assertIn('portions', data)
        self.assertIn('totals', data)
        self.assertIn('warnings', data)
        self.assertIn('adjustments_applied', data)
        self.assertEqual(data['source'], 'template')
        # Portions match stored snapshot
        from menus.models import MenuDishPortion
        stored = MenuDishPortion.objects.filter(menu=menu).select_related('dish')
        for sp in stored:
            match = [p for p in data['portions'] if p['dish_id'] == sp.dish.id]
            self.assertEqual(len(match), 1)
            self.assertEqual(match[0]['grams_per_gent'], round(sp.portion_grams, 1))
        # Totals are summed correctly
        expected_per_person = round(sum(p['grams_per_person'] for p in data['portions']), 1)
        self.assertEqual(data['totals']['food_per_person_grams'], expected_per_person)
        # Protein total present
        self.assertIn('protein_per_person_grams', data['totals'])

    def test_menu_preview_not_found(self):
        res = self.client.get('/api/menus/99999/preview/')
        self.assertEqual(res.status_code, 404)

    def test_baselines_single_dish_values(self):
        """Category baselines should reflect single-dish calibration."""
        from dishes.models import DishCategory
        curry = DishCategory.objects.get(name='curry')
        bbq = DishCategory.objects.get(name='dry_barbecue')
        rice = DishCategory.objects.get(name='rice')
        dessert = DishCategory.objects.get(name='dessert')
        self.assertEqual(curry.baseline_budget_grams, 160)
        self.assertEqual(bbq.baseline_budget_grams, 180)
        self.assertEqual(rice.baseline_budget_grams, 100)
        self.assertEqual(dessert.baseline_budget_grams, 80)

    def test_redistribution_curry_rice_only(self):
        """Curry + rice only: absent BBQ+sides budget redistributed."""
        from dishes.models import Dish
        curry_dish = Dish.objects.filter(category__name='curry', is_active=True).first()
        rice_dish = Dish.objects.filter(category__name='rice', is_active=True).first()
        res = self.client.post('/api/calculate/', {
            'dish_ids': [curry_dish.id, rice_dish.id],
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        portions = {p['category']: p['grams_per_gent'] for p in data['portions']}
        # With growth_rate=0.2, redistribution_fraction=0.7:
        # Curry=160, Rice=100, absent BBQ=180. Redistributed = 180*0.7 = 126g
        # Curry: 160 + 126*(160/260) ≈ 237.5g, Rice: 100 + 126*(100/260) ≈ 148.5g
        self.assertGreater(portions['Curry'], 220)
        self.assertGreater(portions['Rice'], 130)
        # Total protein pool should be around 386g (under 590 ceiling)
        protein_total = sum(p['grams_per_gent'] for p in data['portions'] if p['pool'] == 'protein')
        self.assertLessEqual(protein_total, 590)
        # Should have redistribution adjustment
        adj_text = ' '.join(data['adjustments_applied'])
        self.assertIn('was spread across', adj_text)

    def test_redistribution_bbq_curry_rice(self):
        """BBQ + curry + rice: all 3 protein categories present, no redistribution.
        Protein pool baselines: curry=160, BBQ=180, rice=100 = 440g."""
        from dishes.models import Dish
        bbq_dish = Dish.objects.filter(category__name='dry_barbecue', is_active=True).first()
        curry_dish = Dish.objects.filter(category__name='curry', is_active=True).first()
        rice_dish = Dish.objects.filter(category__name='rice', is_active=True).first()
        res = self.client.post('/api/calculate/', {
            'dish_ids': [bbq_dish.id, curry_dish.id, rice_dish.id],
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        portions = {p['category']: p['grams_per_gent'] for p in data['portions']}
        # All 3 protein categories present → no absent budget → 440g total
        self.assertAlmostEqual(portions['Dry / Barbecue'], 180, delta=5)
        self.assertAlmostEqual(portions['Curry'], 160, delta=5)
        self.assertAlmostEqual(portions['Rice'], 100, delta=5)
        protein_total = sum(p['grams_per_gent'] for p in data['portions'] if p['pool'] == 'protein')
        self.assertAlmostEqual(protein_total, 440, delta=5)

    def test_full_menu_no_redistribution(self):
        """All 3 protein categories + accompaniment: no absent budget in protein pool.
        Sides is now in accompaniment pool, so protein pool = curry+BBQ+rice = 440g."""
        from dishes.models import Dish
        bbq_dish = Dish.objects.filter(category__name='dry_barbecue', is_active=True).first()
        curry_dish = Dish.objects.filter(category__name='curry', is_active=True).first()
        rice_dish = Dish.objects.filter(category__name='rice', is_active=True).first()
        sides_dish = Dish.objects.filter(category__name='sides', is_active=True).first()
        res = self.client.post('/api/calculate/', {
            'dish_ids': [bbq_dish.id, curry_dish.id, rice_dish.id, sides_dish.id],
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        protein_total = sum(p['grams_per_gent'] for p in data['portions'] if p['pool'] == 'protein')
        # Protein pool: 160+180+100 = 440g (sides is in accompaniment pool now)
        self.assertAlmostEqual(protein_total, 440, delta=5)
        # Sides should be in accompaniment pool (with absent veg_curry budget partially redistributed)
        sides_portions = [p for p in data['portions'] if p['pool'] == 'accompaniment']
        self.assertEqual(len(sides_portions), 1)
        # Sides baseline=60 + absent veg_curry(80)*0.7 = 60 + 56 = 116g
        self.assertAlmostEqual(sides_portions[0]['grams_per_gent'], 116, delta=5)

    def test_warning_no_curry(self):
        """Warning when menu has no curry."""
        from dishes.models import Dish
        bbq_dish = Dish.objects.filter(category__name='dry_barbecue', is_active=True).first()
        rice_dish = Dish.objects.filter(category__name='rice', is_active=True).first()
        res = self.client.post('/api/calculate/', {
            'dish_ids': [bbq_dish.id, rice_dish.id],
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        warnings = res.json()['warnings']
        self.assertTrue(any('no curry' in w.lower() for w in warnings))

    def test_warning_no_rice(self):
        """Warning when menu has no rice."""
        from dishes.models import Dish
        curry_dish = Dish.objects.filter(category__name='curry', is_active=True).first()
        bbq_dish = Dish.objects.filter(category__name='dry_barbecue', is_active=True).first()
        res = self.client.post('/api/calculate/', {
            'dish_ids': [curry_dish.id, bbq_dish.id],
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        warnings = res.json()['warnings']
        self.assertTrue(any('no rice' in w.lower() for w in warnings))

    def test_veg_curry_in_accompaniment_pool(self):
        """Veg curry dishes should be in accompaniment pool, not protein."""
        from dishes.models import Dish
        veg_curry = Dish.objects.filter(category__name='veg_curry', is_active=True).first()
        curry_dish = Dish.objects.filter(category__name='curry', is_active=True).first()
        rice_dish = Dish.objects.filter(category__name='rice', is_active=True).first()
        res = self.client.post('/api/calculate/', {
            'dish_ids': [curry_dish.id, rice_dish.id, veg_curry.id],
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        # Veg curry should be in accompaniment pool
        veg_portions = [p for p in data['portions'] if p['pool'] == 'accompaniment']
        self.assertEqual(len(veg_portions), 1)
        self.assertEqual(veg_portions[0]['category'], 'Veg Curry')
        # Protein pool should not contain veg curry
        protein_portions = [p for p in data['portions'] if p['pool'] == 'protein']
        for p in protein_portions:
            self.assertNotEqual(p['category'], 'Veg Curry')

    def test_accompaniment_pool_independent(self):
        """Accompaniment pool allocates independently from protein pool."""
        from dishes.models import Dish
        curry_dish = Dish.objects.filter(category__name='curry', is_active=True).first()
        rice_dish = Dish.objects.filter(category__name='rice', is_active=True).first()
        veg_curry = Dish.objects.filter(category__name='veg_curry', is_active=True).first()
        sides_dish = Dish.objects.filter(category__name='sides', is_active=True).first()
        res = self.client.post('/api/calculate/', {
            'dish_ids': [curry_dish.id, rice_dish.id, veg_curry.id, sides_dish.id],
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        # Accompaniment pool: veg_curry(80) + sides(60) = 140g (under 150 ceiling)
        acc_total = sum(p['grams_per_gent'] for p in data['portions'] if p['pool'] == 'accompaniment')
        self.assertAlmostEqual(acc_total, 140, delta=10)
        self.assertLessEqual(acc_total, 150)
        # Protein pool unaffected by accompaniment dishes
        protein_total = sum(p['grams_per_gent'] for p in data['portions'] if p['pool'] == 'protein')
        self.assertLessEqual(protein_total, 590)

    def test_veg_curry_only_gets_redistribution(self):
        """Veg curry only (no sides): absent sides budget redistributed in accompaniment pool."""
        from dishes.models import Dish
        veg_curry = Dish.objects.filter(category__name='veg_curry', is_active=True).first()
        res = self.client.post('/api/calculate/', {
            'dish_ids': [veg_curry.id],
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        acc_portions = [p for p in data['portions'] if p['pool'] == 'accompaniment']
        self.assertEqual(len(acc_portions), 1)
        # Veg curry baseline 80 + absent sides 60*0.7 = 80 + 42 = 122g
        self.assertAlmostEqual(acc_portions[0]['grams_per_gent'], 122, delta=5)
