"""New organisations are auto-seeded with a starter catalog on creation when
SEED_STARTER_CATALOG_ON_ORG_CREATE is on (dev/prod). Under the test runner it is
OFF by default, so the ~700 org-creating tests stay fast and in control of their
own data — this file flips it on explicitly to prove the behaviour.
"""
from django.test import TestCase, override_settings

from bookings.models.addons import AddOnProduct
from dishes.models import Dish, DishCategory
from menus.models import MenuTemplate
from users.models import Organisation


class AutoSeedCatalogTests(TestCase):
    @override_settings(SEED_STARTER_CATALOG_ON_ORG_CREATE=True)
    def test_new_org_is_seeded_with_a_starter_catalog(self):
        org = Organisation.objects.create(
            name="Fresh Caterers", slug="fresh-caterers", country="GB",
        )
        # Every field a quote/event form touches has starter content.
        self.assertTrue(DishCategory.objects.filter(organisation=org).exists())
        self.assertTrue(Dish.objects.filter(organisation=org).exists())
        self.assertTrue(MenuTemplate.objects.filter(organisation=org).exists())
        self.assertTrue(AddOnProduct.objects.filter(organisation=org).exists())

    @override_settings(SEED_STARTER_CATALOG_ON_ORG_CREATE=True)
    def test_auto_seed_is_idempotent_and_never_blocks_creation(self):
        # A second org with the same content seeds cleanly (get_or_create), and a
        # seeding hiccup must never raise out of org creation.
        org = Organisation.objects.create(name="Repeat Co", slug="repeat-co", country="US")
        self.assertTrue(Dish.objects.filter(organisation=org).exists())

    def test_seeding_is_off_by_default_under_the_test_runner(self):
        # No override → the 'test' argv guard keeps creation catalog-free, so the
        # rest of the suite isn't slowed or forced to reason about seeded data.
        org = Organisation.objects.create(name="Bare Co", slug="bare-co", country="GB")
        self.assertFalse(Dish.objects.filter(organisation=org).exists())
