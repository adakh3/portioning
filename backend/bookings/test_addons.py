from decimal import Decimal

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase

from bookings.models import AddOnProduct, AddOnVariant
from bookings.tests import _make_org, _authenticated_client


class TestAddOnCatalogAPI(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()

    def test_lists_products_with_active_variants(self):
        product = AddOnProduct.objects.create(
            organisation=self.org, name="MocktailsZZZ", category="beverage", is_featured=True,
        )
        AddOnVariant.objects.create(organisation=self.org, product=product, name="Mojito", unit_price=Decimal("3.00"))
        AddOnVariant.objects.create(organisation=self.org, product=product, name="Virgin Colada", unit_price=Decimal("3.50"))
        AddOnVariant.objects.create(organisation=self.org, product=product, name="Retired", unit_price=Decimal("1"), is_active=False)

        res = self.client.get("/api/bookings/addon-products/?page_size=all")
        self.assertEqual(res.status_code, 200, res.content)
        row = next(r for r in res.json() if r["name"] == "MocktailsZZZ")
        self.assertTrue(row["is_featured"])
        names = [v["name"] for v in row["variants"]]
        self.assertEqual(names, ["Mojito", "Virgin Colada"])  # inactive variant excluded

    def test_inactive_product_excluded(self):
        AddOnProduct.objects.create(organisation=self.org, name="OldHiddenZZZ", category="rental", is_active=False)
        res = self.client.get("/api/bookings/addon-products/?page_size=all")
        names = [r["name"] for r in res.json()]
        self.assertNotIn("OldHiddenZZZ", names)


class TestSeedAddonCatalogMigration(TransactionTestCase):
    migrate_from = [('bookings', '0036_contact_address')]
    migrate_to = [('bookings', '0038_seed_addon_catalog_from_options')]

    def _migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        self._migrate(self.migrate_to)

    def test_options_become_featured_products_with_a_variant(self):
        old = self._migrate(self.migrate_from)
        Org = old.get_model('users', 'Organisation')
        Arr = old.get_model('bookings', 'ArrangementTypeOption')
        Bev = old.get_model('bookings', 'BeverageTypeOption')
        org = Org.objects.create(name='CatOrg', slug='cat-org', country='PK')
        Arr.objects.create(organisation=org, value='chairs', label='Chairs', sort_order=1)
        Bev.objects.create(organisation=org, value='soft', label='Soft drinks', sort_order=2)

        new = self._migrate(self.migrate_to)
        Product = new.get_model('bookings', 'AddOnProduct')
        Variant = new.get_model('bookings', 'AddOnVariant')

        chairs = Product.objects.get(name='Chairs')
        self.assertEqual(chairs.category, 'rental')
        self.assertTrue(chairs.is_featured)
        self.assertEqual(chairs.variants.count(), 1)

        soft = Product.objects.get(name='Soft drinks')
        self.assertEqual(soft.category, 'beverage')
        self.assertEqual(Variant.objects.filter(product__organisation_id=org.pk).count(), 2)
