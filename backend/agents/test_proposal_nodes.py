"""Unit tests for the proposal agent's deterministic tools/nodes (no LLM)."""
from decimal import Decimal

from django.test import TestCase

from agents.proposal import nodes, tools
from bookings.models import Lead, OrgSettings
from dishes.models import Dish, DishCategory
from menus.models import MenuTemplate, MenuTemplatePriceTier
from users.models import Organisation


class CatalogGroundingTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Org', slug='org')
        cat = DishCategory.objects.create(organisation=self.org, name='m', display_name='Mains')
        self.d1 = Dish.objects.create(organisation=self.org, name='A', category=cat, default_portion_grams=200)
        self.t = MenuTemplate.objects.create(organisation=self.org, name='T')
        self.tier = MenuTemplatePriceTier.objects.create(menu=self.t, min_guests=50, price_per_head=Decimal('40'))

    def test_resolve_menu_accepts_valid_and_rejects_invalid(self):
        plan = {'template_id': self.t.id, 'tier_id': self.tier.id,
                'sections': [{'name': 'Mains', 'dish_ids': [self.d1.id, 999]}],
                'addon_variant_ids': [777]}
        out = tools.resolve_menu(self.org, plan)
        self.assertTrue(out['errors'])  # bogus dish 999 and add-on 777
        # Resolved keeps only the valid ids.
        self.assertEqual(out['resolved']['sections'][0]['dish_ids'], [self.d1.id])
        self.assertEqual(out['resolved']['addon_variant_ids'], [])

    def test_resolve_menu_rejects_other_orgs_ids(self):
        other = Organisation.objects.create(name='Other', slug='other')
        cat = DishCategory.objects.create(organisation=other, name='m', display_name='M')
        foreign = Dish.objects.create(organisation=other, name='X', category=cat, default_portion_grams=100)
        out = tools.resolve_menu(self.org, {'sections': [{'name': 'S', 'dish_ids': [foreign.id]}]})
        self.assertTrue(out['errors'])
        self.assertEqual(out['resolved']['sections'][0]['dish_ids'], [])


class PricingTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Org', slug='org')
        self.t = MenuTemplate.objects.create(organisation=self.org, name='T')
        MenuTemplatePriceTier.objects.create(menu=self.t, min_guests=1, price_per_head=Decimal('30'))
        MenuTemplatePriceTier.objects.create(menu=self.t, min_guests=100, price_per_head=Decimal('25'))

    def test_price_per_head_picks_tier_for_headcount(self):
        resolved = {'template': self.t, 'tier': None, 'sections': [], 'addon_variant_ids': []}
        ppp, assumption = tools.price_per_head_for(self.org, resolved, {'headcount': 150})
        self.assertEqual(ppp, Decimal('25'))  # 100+ tier
        self.assertIsNotNone(assumption)

    def test_price_per_head_falls_back_to_org_default(self):
        s = OrgSettings.for_org(self.org)
        s.default_price_per_head = Decimal('55'); s.save()
        resolved = {'template': None, 'tier': None, 'sections': [], 'addon_variant_ids': []}
        ppp, assumption = tools.price_per_head_for(self.org, resolved, {'headcount': 10})
        self.assertEqual(ppp, Decimal('55'))

    def test_price_quote_food_is_ppp_times_guests(self):
        resolved = {'template': self.t, 'tier': None, 'sections': [], 'addon_variant_ids': []}
        pricing = tools.price_quote(self.org, {'headcount': 120}, resolved)
        # 120 guests → 25/head tier → food 3000; total >= food.
        self.assertEqual(Decimal(pricing['food_total']), Decimal('3000.00'))
        self.assertGreaterEqual(Decimal(pricing['total']), Decimal('3000.00'))
        self.assertEqual(pricing['guest_count'], 120)


class ResolveEventParamsTests(TestCase):
    def _state(self, lead_ctx, answers):
        return {'context': {'lead': lead_ctx}, 'answers': answers, 'assumptions': []}

    def test_answers_win_over_lead(self):
        out = nodes.resolve_event_params(self._state(
            {'event_type': 'wedding', 'guest_estimate': 50, 'service_style': 'buffet'},
            {'headcount': 200, 'service_style': 'plated'},
        ))
        p = out['event_params']
        self.assertEqual(p['headcount'], 200)
        self.assertEqual(p['service_style'], 'plated')
        self.assertEqual(p['occasion'], 'wedding')  # fell back to lead

    def test_missing_headcount_defaults_to_one_with_assumption(self):
        out = nodes.resolve_event_params(self._state({}, {}))
        self.assertEqual(out['event_params']['headcount'], 1)
        fields = [a['field'] for a in out['assumptions']]
        self.assertIn('headcount', fields)
        self.assertIn('service_style', fields)  # defaulted to buffet
