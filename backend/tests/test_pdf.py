from django.test import TestCase
from rest_framework.test import APIClient

from calculator.pdf import generate_portion_pdf


class TestPDFGeneration(TestCase):
    def test_generates_valid_pdf_bytes(self):
        result = {
            'portions': [
                {
                    'dish_id': 1, 'dish_name': 'Mutton Seekh Kebab',
                    'category': 'Dry / Barbecue', 'protein_type': 'mutton',
                    'pool': 'protein', 'unit': 'grams',
                    'grams_per_person': 130, 'grams_per_gent': 130,
                    'grams_per_lady': 104, 'total_grams': 11700,
                    'cost_per_gent': 2.60, 'total_cost': 234.0,
                },
                {
                    'dish_id': 2, 'dish_name': 'Chicken Boti',
                    'category': 'Dry / Barbecue', 'protein_type': 'chicken',
                    'pool': 'protein', 'unit': 'grams',
                    'grams_per_person': 200, 'grams_per_gent': 200,
                    'grams_per_lady': 160, 'total_grams': 18000,
                    'cost_per_gent': 3.00, 'total_cost': 540.0,
                },
            ],
            'totals': {
                'food_per_gent_grams': 330, 'food_per_lady_grams': 264,
                'food_per_person_grams': 297, 'protein_per_person_grams': 297,
                'total_food_weight_grams': 29700, 'total_cost': 774.0,
            },
            'warnings': ['Menu has no rice — at least one rice dish is recommended.'],
            'adjustments_applied': ['Big eaters: all portions increased by 20%'],
        }
        pdf_bytes = generate_portion_pdf(
            result=result,
            menu_name='Test Menu',
            guests={'gents': 50, 'ladies': 50},
            event_date='2026-03-15',
        )
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))
        self.assertGreater(len(pdf_bytes), 100)

    def test_empty_portions(self):
        result = {
            'portions': [],
            'totals': {
                'food_per_gent_grams': 0, 'food_per_lady_grams': 0,
                'food_per_person_grams': 0, 'protein_per_person_grams': 0,
                'total_food_weight_grams': 0, 'total_cost': 0,
            },
            'warnings': ['No active dishes found for the given IDs.'],
            'adjustments_applied': [],
        }
        pdf_bytes = generate_portion_pdf(
            result=result,
            menu_name='Empty Menu',
            guests={'gents': 0, 'ladies': 0},
        )
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))

    def test_mixed_pools(self):
        result = {
            'portions': [
                {
                    'dish_id': 1, 'dish_name': 'Chicken Boti',
                    'category': 'Dry / Barbecue', 'protein_type': 'chicken',
                    'pool': 'protein', 'unit': 'grams',
                    'grams_per_person': 180, 'grams_per_gent': 180,
                    'grams_per_lady': 144, 'total_grams': 16200,
                    'cost_per_gent': 2.70, 'total_cost': 486.0,
                },
                {
                    'dish_id': 2, 'dish_name': 'Gulab Jamun',
                    'category': 'Dessert', 'protein_type': '',
                    'pool': 'dessert', 'unit': 'grams',
                    'grams_per_person': 80, 'grams_per_gent': 80,
                    'grams_per_lady': 64, 'total_grams': 7200,
                    'cost_per_gent': 1.00, 'total_cost': 180.0,
                },
                {
                    'dish_id': 3, 'dish_name': 'Naan Bread',
                    'category': 'Service', 'protein_type': '',
                    'pool': 'service', 'unit': 'qty',
                    'grams_per_person': 2, 'grams_per_gent': 2,
                    'grams_per_lady': 2, 'total_grams': 200,
                    'cost_per_gent': 0.50, 'total_cost': 100.0,
                },
            ],
            'totals': {
                'food_per_gent_grams': 262, 'food_per_lady_grams': 210,
                'food_per_person_grams': 236, 'protein_per_person_grams': 162,
                'total_food_weight_grams': 23600, 'total_cost': 766.0,
            },
            'warnings': [],
            'adjustments_applied': [],
        }
        pdf_bytes = generate_portion_pdf(
            result=result,
            menu_name='Mixed Pool Menu',
            guests={'gents': 50, 'ladies': 50},
            event_date='2026-06-01',
        )
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))

    def test_no_date_uses_today(self):
        result = {
            'portions': [],
            'totals': {
                'food_per_gent_grams': 0, 'food_per_lady_grams': 0,
                'food_per_person_grams': 0, 'protein_per_person_grams': 0,
                'total_food_weight_grams': 0, 'total_cost': 0,
            },
            'warnings': [],
            'adjustments_applied': [],
        }
        pdf_bytes = generate_portion_pdf(
            result=result,
            menu_name='No Date Menu',
            guests={'gents': 10, 'ladies': 10},
        )
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))


class TestExportPDFAPI(TestCase):
    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.client = APIClient()

    def test_export_pdf_endpoint(self):
        from dishes.models import Dish
        dish_ids = list(Dish.objects.filter(is_active=True).values_list('id', flat=True)[:5])
        res = self.client.post('/api/export-pdf/', {
            'dish_ids': dish_ids,
            'guests': {'gents': 40, 'ladies': 40},
            'menu_name': 'Test Event Menu',
            'date': '2026-04-01',
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'application/pdf')
        self.assertIn('attachment', res['Content-Disposition'])
        self.assertTrue(res.content.startswith(b'%PDF'))

    def test_export_pdf_without_optional_fields(self):
        from dishes.models import Dish
        dish_ids = list(Dish.objects.filter(is_active=True).values_list('id', flat=True)[:3])
        res = self.client.post('/api/export-pdf/', {
            'dish_ids': dish_ids,
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'application/pdf')

    def test_export_pdf_validation_error(self):
        res = self.client.post('/api/export-pdf/', {
            'guests': {'gents': 50, 'ladies': 50},
        }, format='json')
        self.assertEqual(res.status_code, 400)
