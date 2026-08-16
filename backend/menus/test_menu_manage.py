"""Self-serve menu-template management (/menus editor).

Covers the manage endpoints (owner/admin CRUD on MenuTemplate with nested courses,
dishes and price tiers), the compose-only shape (portion grams auto-computed, never
sent), org scoping and permission gating.
"""
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from menus.models import MenuTemplate, MenuCourse, MenuDishPortion, MenuTemplatePriceTier
from menus.tests import make_category, make_dish
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
    user, _ = User.objects.get_or_create(email=email, defaults={"role": role, "organisation": org})
    return user


def _client(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


MANAGE = "/api/menus/manage/"


class MenuManageTests(TestCase):
    def setUp(self):
        self.org = _org("menu-org", "Menu Org")
        self.owner = _user(self.org, "owner@menu.test", role="owner")
        self.client = _client(self.owner)
        self.cat = make_category(self.org, name="entrees", baseline_budget_grams=180)
        self.chicken = make_dish(self.org, category=self.cat, name="Chicken")
        self.beef = make_dish(self.org, category=self.cat, name="Beef")

    def test_create_composes_courses_dishes_and_tiers_with_auto_portions(self):
        res = self.client.post(MANAGE, {
            "name": "Wedding Menu", "menu_type": "custom",
            "default_gents": 60, "default_ladies": 40,
            "courses": [{"name": "Starters"}, {"name": "Mains"}],
            "dishes": [
                {"dish_id": self.chicken.id, "course": 1},
                {"dish_id": self.beef.id, "course": 1},
            ],
            "price_tiers": [{"min_guests": 50, "price_per_head": "45.00"}],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)

        menu = MenuTemplate.objects.get(organisation=self.org, name="Wedding Menu")
        self.assertEqual([c.name for c in menu.courses.all()], ["Starters", "Mains"])
        portions = {p.dish.name: p for p in menu.portions.all()}
        self.assertEqual(set(portions), {"Chicken", "Beef"})
        # Portion grams were auto-filled (never sent) and are positive.
        self.assertGreater(portions["Chicken"].portion_grams, 0)
        # Both dishes landed in the "Mains" course (index 1).
        mains = menu.courses.all()[1]
        self.assertEqual(portions["Chicken"].course_id, mains.id)
        self.assertEqual(menu.price_tiers.get().price_per_head, Decimal("45.00"))

    def test_create_never_stores_a_grams_value_the_caller_sends(self):
        # portion_grams is not part of the write shape — a smuggled value is ignored.
        res = self.client.post(MANAGE, {
            "name": "Ignore Grams", "dishes": [{"dish_id": self.chicken.id, "portion_grams": 9999}],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        p = MenuTemplate.objects.get(name="Ignore Grams").portions.get()
        self.assertNotEqual(p.portion_grams, 9999)

    def test_read_returns_composition_with_course_indices(self):
        res = self.client.post(MANAGE, {
            "name": "Readback", "courses": [{"name": "One"}],
            "dishes": [{"dish_id": self.chicken.id, "course": 0}],
        }, format="json")
        menu_id = res.json()["id"]
        got = self.client.get(f"{MANAGE}{menu_id}/").json()
        self.assertEqual(got["courses"], [{"name": "One", "sort_order": 0}])
        self.assertEqual(got["dishes"][0]["dish_id"], self.chicken.id)
        self.assertEqual(got["dishes"][0]["course"], 0)

    def test_update_replaces_dishes_and_reassigns_courses(self):
        create = self.client.post(MANAGE, {
            "name": "Editable", "courses": [{"name": "A"}, {"name": "B"}],
            "dishes": [{"dish_id": self.chicken.id, "course": 0}],
        }, format="json")
        menu_id = create.json()["id"]

        res = self.client.patch(f"{MANAGE}{menu_id}/", {
            "courses": [{"name": "A"}, {"name": "B"}],
            "dishes": [
                {"dish_id": self.chicken.id, "course": 1},  # moved A→B
                {"dish_id": self.beef.id, "course": 0},     # added
            ],
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)

        menu = MenuTemplate.objects.get(id=menu_id)
        courses = list(menu.courses.all())
        by_dish = {p.dish.name: p.course_id for p in menu.portions.all()}
        self.assertEqual(by_dish["Chicken"], courses[1].id)
        self.assertEqual(by_dish["Beef"], courses[0].id)
        self.assertEqual(menu.portions.count(), 2)

    def test_list_includes_inactive(self):
        MenuTemplate.objects.create(organisation=self.org, name="Hidden", is_active=False)
        names = {m["name"] for m in _rows(self.client.get(MANAGE))}
        self.assertIn("Hidden", names)

    def test_delete(self):
        menu = MenuTemplate.objects.create(organisation=self.org, name="Delete me")
        res = self.client.delete(f"{MANAGE}{menu.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(MenuTemplate.objects.filter(id=menu.id).exists())

    def test_duplicate_price_tier_thresholds_are_a_clean_400_not_a_500(self):
        # Two tiers at the same guest count violate unique(menu, min_guests) —
        # caught as validation, not an IntegrityError mid-save.
        res = self.client.post(MANAGE, {
            "name": "Dup Tiers",
            "price_tiers": [
                {"min_guests": 50, "price_per_head": "40.00"},
                {"min_guests": 50, "price_per_head": "60.00"},
            ],
        }, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        # And nothing was written — the failed save must not leave a partial menu.
        self.assertFalse(MenuTemplate.objects.filter(organisation=self.org, name="Dup Tiers").exists())

    def test_negative_or_zero_price_tiers_are_rejected(self):
        neg = self.client.post(MANAGE, {
            "name": "Neg", "price_tiers": [{"min_guests": 10, "price_per_head": "-5"}],
        }, format="json")
        self.assertEqual(neg.status_code, 400, neg.content)
        self.assertFalse(MenuTemplate.objects.filter(organisation=self.org, name="Neg").exists())

        zero_guests = self.client.post(MANAGE, {
            "name": "ZeroG", "price_tiers": [{"min_guests": 0, "price_per_head": "10"}],
        }, format="json")
        self.assertEqual(zero_guests.status_code, 400, zero_guests.content)

    def test_a_failed_save_rolls_back_completely(self):
        # A duplicate tier fails AFTER the template/dishes are created; the whole
        # thing must roll back rather than persist a half-built menu.
        before = MenuTemplate.objects.filter(organisation=self.org).count()
        res = self.client.post(MANAGE, {
            "name": "Rollback", "courses": [{"name": "C"}],
            "dishes": [{"dish_id": self.chicken.id, "course": 0}],
            "price_tiers": [
                {"min_guests": 10, "price_per_head": "1"},
                {"min_guests": 10, "price_per_head": "2"},
            ],
        }, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        self.assertEqual(MenuTemplate.objects.filter(organisation=self.org).count(), before)
        self.assertFalse(MenuCourse.objects.filter(name="C", menu__organisation=self.org).exists())


class MenuManageScopingTests(TestCase):
    def test_cannot_touch_another_orgs_template_or_use_its_dishes(self):
        org_a = _org("menu-a")
        org_b = _org("menu-b")
        cat_a = make_category(org_a, name="a")
        dish_a = make_dish(org_a, category=cat_a, name="A dish")
        template_a = MenuTemplate.objects.create(organisation=org_a, name="A menu")
        client_b = _client(_user(org_b, "owner@mb.test", role="owner"))

        self.assertNotIn("A menu", {m["name"] for m in _rows(client_b.get(MANAGE))})
        self.assertEqual(client_b.get(f"{MANAGE}{template_a.id}/").status_code, 404)
        # Can't compose a menu from another org's dish.
        res = client_b.post(MANAGE, {"name": "Sneaky", "dishes": [{"dish_id": dish_a.id}]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_non_admin_cannot_write(self):
        org = _org("menu-perm")
        chef = _user(org, "chef@menu.test", role="chef")
        res = _client(chef).post(MANAGE, {"name": "X"}, format="json")
        self.assertEqual(res.status_code, 403)
