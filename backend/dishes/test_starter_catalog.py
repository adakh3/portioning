"""The US starter catalog seeds a usable, isolated, idempotent per-org catalog,
and the calculator works against it out of the box."""
from django.core.management import call_command
from django.test import TestCase

from users.models import Organisation
from dishes.models import Dish, DishCategory
from menus.models import MenuTemplate
from bookings.models.addons import AddOnProduct
from staff.models import LaborRole
from rules.models import GlobalConfig, BudgetProfile


def seed(org_name, country='US'):
    org, _ = Organisation.objects.get_or_create(
        name=org_name, defaults={'slug': org_name.lower().replace(' ', '-'), 'country': country})
    call_command('seed_starter_catalog', '--org', org_name, verbosity=0)
    return org


class StarterCatalogTests(TestCase):
    def test_creates_a_usable_catalog(self):
        org = seed('Acme Catering')
        self.assertEqual(DishCategory.objects.filter(organisation=org).count(), 6)
        self.assertEqual(Dish.objects.filter(organisation=org).count(), 18)
        self.assertEqual(MenuTemplate.objects.filter(organisation=org).count(), 2)
        self.assertTrue(AddOnProduct.objects.filter(organisation=org).exists())
        self.assertTrue(LaborRole.objects.filter(organisation=org, name='Server').exists())
        self.assertTrue(GlobalConfig.objects.filter(organisation=org).exists())
        self.assertTrue(BudgetProfile.objects.filter(organisation=org, is_default=True).exists())

    def test_isolated_between_orgs(self):
        a = seed('Org A')
        b = seed('Org B')
        # Both orgs have their own copy — per-org uniqueness holds (would have
        # failed under the old global-unique category/role names).
        self.assertEqual(Dish.objects.filter(organisation=a).count(), 18)
        self.assertEqual(Dish.objects.filter(organisation=b).count(), 18)
        a_dish_ids = set(Dish.objects.filter(organisation=a).values_list('id', flat=True))
        b_dish_ids = set(Dish.objects.filter(organisation=b).values_list('id', flat=True))
        self.assertFalse(a_dish_ids & b_dish_ids)  # no shared rows

    def test_idempotent(self):
        org = seed('Repeat Co')
        call_command('seed_starter_catalog', '--org', 'Repeat Co', verbosity=0)
        self.assertEqual(Dish.objects.filter(organisation=org).count(), 18)  # no dupes

    def test_calculator_works_on_a_starter_menu(self):
        org = seed('Calc Co')
        menu = MenuTemplate.objects.filter(organisation=org, name='Corporate Lunch Buffet').first()
        dish_ids = list(menu.portions.values_list('dish_id', flat=True))
        from calculator.engine.calculator import calculate_portions
        result = calculate_portions(dish_ids, {'gents': 50, 'ladies': 50}, org=org)
        self.assertTrue(result['portions'])  # produced per-dish portions
        self.assertGreater(result['totals']['total_food_weight_grams'], 0)
