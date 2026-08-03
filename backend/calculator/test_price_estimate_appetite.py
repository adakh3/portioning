"""The suggested price/head: hearty eaters must raise it, and rounding must never
flatten it to zero.

Two separate bugs met here. `PriceEstimateView` was the one view that dropped
`big_eaters` (CalculateView, CheckPortionsView and ExportPDFView all pass it), so
the booking quoted 20% more food than the estimate priced. And the rounding step
defaulted to 50 — a rupee-shaped assumption — so any rate under $25/head rounded
down to $0.00, which reads as "these dishes are worth nothing".

The org is seeded with the real starter catalog: the engine needs an org's rules
(global config, budget profile, category constraints) and its guest segments to
portion anything at all, so a hand-built org estimates 0 no matter what is asked.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from bookings.models import OrgSettings
from dishes.models import Dish
from menus.models import MenuTemplate
from users.models import Organisation


@override_settings(SEED_STARTER_CATALOG_ON_ORG_CREATE=True)
class PriceEstimateAppetiteTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(
            name='Appetite Co', slug='appetite-co', country='US')
        self.user = get_user_model().objects.create_user(
            email='owner@appetite.test', password='pw', organisation=self.org, role='owner')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        menu = MenuTemplate.objects.get(organisation=self.org, name='Wedding Reception Dinner')
        self.dish_ids = list(menu.portions.values_list('dish_id', flat=True))
        self.assertTrue(self.dish_ids)
        self.assertTrue(
            Dish.objects.filter(id__in=self.dish_ids, selling_price_per_gram__gt=0).exists(),
            'the starter catalog must price its dishes, or every assertion here is vacuous',
        )

    def _estimate(self, **extra):
        res = self.client.post('/api/price-estimate/', {
            'dish_ids': self.dish_ids, 'guest_count': 100, **extra,
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        return res.data['price_per_head']

    def test_hearty_eaters_raises_the_suggested_rate(self):
        plain = self._estimate()
        self.assertGreater(plain, 0, 'a priced menu must estimate above zero')
        self.assertGreater(self._estimate(big_eaters=True, big_eaters_percentage=20), plain)

    def test_a_bigger_appetite_costs_more_than_a_smaller_one(self):
        self.assertGreater(
            self._estimate(big_eaters=True, big_eaters_percentage=50),
            self._estimate(big_eaters=True, big_eaters_percentage=20),
        )

    def test_unticked_is_identical_to_omitting_it(self):
        self.assertEqual(self._estimate(), self._estimate(big_eaters=False))

    def test_a_cheap_menu_never_rounds_down_to_nothing(self):
        """The legacy step of 50 turned any rate under $25/head into $0.00."""
        s = OrgSettings.for_org(self.org)
        s.price_rounding_step = 50
        s.save()
        self.assertGreater(self._estimate(), 0)

    def test_a_junk_percentage_falls_back_rather_than_500ing(self):
        self.assertEqual(
            self._estimate(big_eaters=True, big_eaters_percentage='not-a-number'),
            self._estimate(big_eaters=True, big_eaters_percentage=20),
        )

    def test_a_us_org_is_created_without_the_rupee_rounding_step(self):
        """The step follows the currency now — 50 was a global default that rounded a
        $38/head US booking to $50, and a $5/head one to nothing."""
        self.assertEqual(OrgSettings.for_org(self.org).price_rounding_step, 1)
        pk = Organisation.objects.create(name='Karachi Co', slug='karachi-co', country='PK')
        self.assertEqual(OrgSettings.for_org(pk).price_rounding_step, 50)
