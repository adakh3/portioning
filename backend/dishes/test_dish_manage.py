"""Self-serve dish catalog management (Settings → Dishes).

Covers the manage endpoints (owner/admin CRUD on Dish), the client-facing field
surface, dietary-tag writes, org scoping, permission gating, and the
deactivate-first delete guard (protect_dish_on_bookings surfaced as a 400).
"""
import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Contact, Quote
from dishes.models import DietaryTag, Dish
from dishes.tests import make_category, make_dish
from users.models import Organisation, User


def _rows(res):
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


MANAGE = "/api/dishes/manage/"


class DishManageTests(TestCase):
    def setUp(self):
        self.org = _org("dish-org", "Dish Org")
        self.owner = _user(self.org, "owner@dish.test", role="owner")
        self.client = _client(self.owner)
        self.category = make_category(org=self.org, name="entrees", display_name="Entrées",
                                      baseline_budget_grams=180)

    def test_create_defaults_portion_from_category_and_autocomputes_price(self):
        res = self.client.post(MANAGE, {
            "name": "Grilled Chicken", "category": self.category.id,
            "cost_per_gram": "0.0120",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        dish = Dish.objects.get(organisation=self.org, name="Grilled Chicken")
        # Hidden grams field seeded from the category's standard portion.
        self.assertEqual(dish.default_portion_grams, self.category.baseline_budget_grams)
        # Selling price auto-derived (override left off) — non-null once cost is set.
        self.assertIsNotNone(dish.selling_price_per_gram)
        self.assertFalse(dish.selling_price_override)

    def test_create_with_dietary_tags(self):
        tag = DietaryTag.objects.first()
        self.assertIsNotNone(tag, "expected the seeded dietary-tag vocabulary")
        res = self.client.post(MANAGE, {
            "name": "Tagged Dish", "category": self.category.id,
            "cost_per_gram": "0.01", "dietary_tag_ids": [tag.id],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        dish = Dish.objects.get(organisation=self.org, name="Tagged Dish")
        self.assertEqual(list(dish.dietary_tags.values_list("id", flat=True)), [tag.id])
        # The read side returns the resolved tag objects for badges.
        self.assertEqual(res.json()["dietary_tags"][0]["id"], tag.id)

    def test_update_name_and_cost(self):
        dish = make_dish(org=self.org, category=self.category, name="Old")
        res = self.client.patch(f"{MANAGE}{dish.id}/",
                                {"name": "New", "cost_per_gram": "0.02"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        dish.refresh_from_db()
        self.assertEqual(dish.name, "New")
        self.assertEqual(dish.cost_per_gram, Decimal("0.0200"))

    def test_deactivate(self):
        dish = make_dish(org=self.org, category=self.category, name="Retire me")
        res = self.client.patch(f"{MANAGE}{dish.id}/", {"is_active": False}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        dish.refresh_from_db()
        self.assertFalse(dish.is_active)
        # Inactive dishes stay in the manage list (so they can be reactivated)...
        self.assertIn("Retire me", {d["name"] for d in _rows(self.client.get(MANAGE))})
        # ...but drop from the picker that feeds quotes/events.
        self.assertNotIn("Retire me", {d["name"] for d in _rows(self.client.get("/api/dishes/"))})

    def test_cannot_change_kitchen_internals_via_this_editor(self):
        # portion grams / pool / baseline are not part of this serializer — a
        # caller can't sneak them in.
        dish = make_dish(org=self.org, category=self.category, default_portion_grams=100)
        self.client.patch(f"{MANAGE}{dish.id}/", {"default_portion_grams": 999}, format="json")
        dish.refresh_from_db()
        self.assertEqual(dish.default_portion_grams, 100)

    def test_delete_blocked_when_dish_is_on_a_booking(self):
        dish = make_dish(org=self.org, category=self.category, name="On a quote")
        contact = Contact.objects.create(organisation=self.org, name="Client")
        quote = Quote.objects.create(
            organisation=self.org, primary_contact=contact,
            event_date=datetime.date(2026, 9, 1), guest_count=10,
            price_per_head=Decimal("50"), created_by=self.owner,
        )
        quote.dishes.set([dish])

        res = self.client.delete(f"{MANAGE}{dish.id}/")
        self.assertEqual(res.status_code, 400, res.content)
        body = str(res.content).lower()
        self.assertIn("cannot be deleted", body)
        self.assertIn("is active", body)  # points the user at deactivating instead
        self.assertTrue(Dish.objects.filter(id=dish.id).exists())

    def test_delete_allowed_when_unused(self):
        dish = make_dish(org=self.org, category=self.category, name="Never ordered")
        res = self.client.delete(f"{MANAGE}{dish.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Dish.objects.filter(id=dish.id).exists())


class DishManageScopingTests(TestCase):
    def test_cannot_touch_another_orgs_dish_or_category(self):
        org_a = _org("dish-a")
        org_b = _org("dish-b")
        cat_a = make_category(org=org_a, name="a-cat")
        dish_a = make_dish(org=org_a, category=cat_a, name="A dish")
        client_b = _client(_user(org_b, "owner@db.test", role="owner"))

        self.assertNotIn("A dish", {d["name"] for d in _rows(client_b.get(MANAGE))})
        self.assertEqual(client_b.get(f"{MANAGE}{dish_a.id}/").status_code, 404)
        # Can't file a new dish under another org's category either.
        cat_b = make_category(org=org_b, name="b-cat")
        res = client_b.post(MANAGE, {"name": "X", "category": cat_a.id, "cost_per_gram": "0.01"},
                            format="json")
        self.assertEqual(res.status_code, 400)  # validate_category rejects it
        # But their own category works.
        ok = client_b.post(MANAGE, {"name": "Y", "category": cat_b.id, "cost_per_gram": "0.01"},
                           format="json")
        self.assertEqual(ok.status_code, 201, ok.content)

    def test_non_admin_cannot_write(self):
        org = _org("dish-perm")
        cat = make_category(org=org, name="perm-cat")
        chef = _user(org, "chef@dish.test", role="chef")
        res = _client(chef).post(MANAGE, {"name": "X", "category": cat.id, "cost_per_gram": "0.01"},
                                format="json")
        self.assertEqual(res.status_code, 403)


class DietaryTagListTests(TestCase):
    def test_lists_the_global_vocabulary(self):
        org = _org("tag-org")
        res = _client(_user(org, "owner@tag.test", role="owner")).get("/api/dietary-tags/")
        self.assertEqual(res.status_code, 200)
        rows = _rows(res)
        self.assertTrue(len(rows) > 0)
        self.assertIn("label", rows[0])
        self.assertIn("kind", rows[0])
