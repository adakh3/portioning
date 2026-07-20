"""Stage-2 N-segment portioning engine tests.

The headline invariant is **parity**: expanding the legacy gents/ladies dict and
the equivalent two-segment list through the engine must produce identical
grams/portions — even with a ladies multiplier != 1.0. Plus the new behaviours:
N segments scale and sum, and portions are computed over ALL covers (in-count +
additional).
"""
from django.core.management import call_command
from django.test import TestCase

from calculator.engine.calculator import calculate_portions


class NSegmentEngineParityTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)
        from users.models import Organisation
        from rules.models import GuestSegment
        from dishes.models import Dish

        cls.org = Organisation.objects.first()
        # Give ladies a non-trivial multiplier so scaling is actually exercised
        # (the seed ships 1.0, which would make parity trivially true).
        GuestSegment.objects.update_or_create(
            organisation=cls.org, name='gents',
            defaults={'portion_multiplier': 1.0, 'sort_order': 0, 'is_default': True},
        )
        GuestSegment.objects.update_or_create(
            organisation=cls.org, name='ladies',
            defaults={'portion_multiplier': 0.8, 'sort_order': 1},
        )
        cls.dish_ids = list(
            Dish.objects.filter(is_active=True, organisation=cls.org)
            .values_list('id', flat=True)[:6]
        )

    def test_segment_list_matches_legacy_gents_ladies_dict(self):
        """The two-segment list path == the legacy gents/ladies dict path."""
        legacy = calculate_portions(
            self.dish_ids, {'gents': 60, 'ladies': 40}, org=self.org,
        )
        segmented = calculate_portions(
            self.dish_ids,
            {'segments': [
                {'name': 'gents', 'count': 60, 'portion_multiplier': 1.0},
                {'name': 'ladies', 'count': 40, 'portion_multiplier': 0.8},
            ]},
            org=self.org,
        )
        # Both paths resolve to the same two named segments, so the full
        # portion dicts (grams_by_segment included) must match exactly.
        self.assertEqual(legacy['portions'], segmented['portions'])
        self.assertEqual(legacy['totals'], segmented['totals'])

    def test_ladies_multiplier_actually_applied(self):
        """Guard the parity test isn't vacuous: ladies grams != gent grams here."""
        res = calculate_portions(
            self.dish_ids, {'gents': 60, 'ladies': 40}, org=self.org,
        )
        p = res['portions'][0]
        self.assertEqual(p['grams_per_lady'], round(p['grams_per_gent'] * 0.8, 1))

    def test_three_segments_scale_and_sum_over_all_covers(self):
        """Adults/Kids/Vendors: Kids at 0.6, portions summed over 100+40+8 covers."""
        res = calculate_portions(
            self.dish_ids,
            {'segments': [
                {'name': 'Adults', 'count': 100, 'portion_multiplier': 1.0,
                 'counts_toward_total': True},
                {'name': 'Kids', 'count': 40, 'portion_multiplier': 0.6,
                 'counts_toward_total': True},
                {'name': 'Vendors', 'count': 8, 'portion_multiplier': 1.0,
                 'counts_toward_total': False},
            ]},
            org=self.org,
        )
        p = res['portions'][0]
        self.assertEqual(set(p['grams_by_segment']), {'Adults', 'Kids', 'Vendors'})
        base = p['grams_per_gent']  # base == the multiplier-1.0 reference
        self.assertEqual(p['grams_by_segment']['Kids'], round(base * 0.6, 1))
        self.assertEqual(p['grams_by_segment']['Vendors'], base)
        # dish total sums over ALL 148 covers (in-count + additional)
        expected = round(base * 100 + round(base * 0.6, 1) * 40 + base * 8, 1)
        self.assertEqual(p['total_grams'], expected)
        # per-person divides by all covers, not just the in-count ones
        self.assertEqual(
            p['grams_per_person'], round(p['total_grams'] / 148, 1),
        )
