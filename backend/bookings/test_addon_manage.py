"""Self-serve add-on catalog management (Settings → Add-ons).

Covers the manage endpoints (owner/admin CRUD on AddOnProduct + nested variants),
org scoping, permissions, and that the read endpoint that feeds the quote/event
pickers reflects the changes.
"""
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import AddOnProduct, AddOnVariant
from users.models import Organisation, User


def _rows(res):
    """List endpoints are paginated ({count, results}); unwrap to the rows."""
    data = res.json()
    return data["results"] if isinstance(data, dict) else data


def _org(slug, name=None):
    org, _ = Organisation.objects.get_or_create(
        slug=slug, defaults={"name": name or slug.title(), "country": "US"},
    )
    return org


def _user(org, email, role="owner"):
    user, _ = User.objects.get_or_create(
        email=email, defaults={"role": role, "organisation": org},
    )
    return user


def _client(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


MANAGE = "/api/bookings/settings/addon-products/"
READ = "/api/bookings/addon-products/"


class AddOnManageTests(TestCase):
    def setUp(self):
        self.org = _org("addon-org", "Add-on Org")
        self.owner = _user(self.org, "owner@addon.test", role="owner")
        self.client = _client(self.owner)

    def test_create_product_without_variants(self):
        res = self.client.post(MANAGE, {
            "name": "Chair rental", "category": "rental",
            "default_unit": "each", "unit_price": "5.00",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        product = AddOnProduct.objects.get(organisation=self.org, name="Chair rental")
        self.assertEqual(product.organisation, self.org)  # org stamped from request
        self.assertEqual(product.variants.count(), 0)

    def test_create_product_with_nested_variants(self):
        res = self.client.post(MANAGE, {
            "name": "Mocktails", "category": "beverage",
            "default_unit": "each", "unit_price": "4.00",
            "variants": [
                {"name": "Mojito", "unit_price": "3.00"},
                {"name": "Virgin Mary"},  # blank → inherits base
            ],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        product = AddOnProduct.objects.get(organisation=self.org, name="Mocktails")
        variants = {v.name: v for v in product.variants.all()}
        self.assertEqual(variants["Mojito"].unit_price, Decimal("3.00"))
        self.assertIsNone(variants["Virgin Mary"].unit_price)
        # Inherited variant resolves to the product's base price.
        self.assertEqual(variants["Virgin Mary"].effective_price, Decimal("4.00"))
        # Variants inherit the product's org.
        self.assertEqual(variants["Mojito"].organisation, self.org)

    def test_patch_product_fields_leaves_variants_untouched(self):
        product = AddOnProduct.objects.create(
            organisation=self.org, name="Tent", category="rental", unit_price=Decimal("100"),
        )
        AddOnVariant.objects.create(organisation=self.org, product=product, name="Large")
        res = self.client.patch(f"{MANAGE}{product.id}/", {"is_featured": True}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        product.refresh_from_db()
        self.assertTrue(product.is_featured)
        self.assertEqual(product.variants.count(), 1)  # not wiped by a fields-only PATCH

    def test_variant_upsert_and_delete(self):
        product = AddOnProduct.objects.create(
            organisation=self.org, name="Linens", category="rental", unit_price=Decimal("10"),
        )
        keep = AddOnVariant.objects.create(organisation=self.org, product=product, name="White")
        drop = AddOnVariant.objects.create(organisation=self.org, product=product, name="Ivory")

        # Rename `keep`, omit `drop` (deleted), add a brand-new variant.
        res = self.client.patch(f"{MANAGE}{product.id}/", {
            "variants": [
                {"id": keep.id, "name": "Snow White", "unit_price": "12.00"},
                {"name": "Black"},
            ],
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)

        names = set(product.variants.values_list("name", flat=True))
        self.assertEqual(names, {"Snow White", "Black"})
        self.assertFalse(AddOnVariant.objects.filter(id=drop.id).exists())
        keep.refresh_from_db()
        self.assertEqual(keep.unit_price, Decimal("12.00"))

    def test_manage_list_includes_inactive_but_read_excludes(self):
        AddOnProduct.objects.create(
            organisation=self.org, name="Active one", category="fee", is_active=True,
        )
        AddOnProduct.objects.create(
            organisation=self.org, name="Hidden one", category="fee", is_active=False,
        )
        manage_names = {p["name"] for p in _rows(self.client.get(MANAGE))}
        read_names = {p["name"] for p in _rows(self.client.get(READ))}
        self.assertIn("Hidden one", manage_names)   # editable so it can be reactivated
        self.assertNotIn("Hidden one", read_names)  # not offered on quotes/events

    def test_delete_product(self):
        product = AddOnProduct.objects.create(
            organisation=self.org, name="Delete me", category="fee",
        )
        res = self.client.delete(f"{MANAGE}{product.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(AddOnProduct.objects.filter(id=product.id).exists())


class AddOnManageScopingTests(TestCase):
    def test_cannot_edit_another_orgs_product(self):
        org_a = _org("org-a")
        org_b = _org("org-b")
        product = AddOnProduct.objects.create(
            organisation=org_a, name="A's product", category="fee",
        )
        client_b = _client(_user(org_b, "owner@b.test", role="owner"))

        self.assertNotIn(
            "A's product",
            {p["name"] for p in _rows(client_b.get(MANAGE))},
        )
        self.assertEqual(client_b.get(f"{MANAGE}{product.id}/").status_code, 404)
        self.assertEqual(
            client_b.patch(f"{MANAGE}{product.id}/", {"name": "hijacked"}, format="json").status_code,
            404,
        )

    def test_non_admin_cannot_write(self):
        org = _org("perm-org")
        chef = _user(org, "chef@perm.test", role="chef")
        res = _client(chef).post(MANAGE, {"name": "X", "category": "fee"}, format="json")
        self.assertEqual(res.status_code, 403)
