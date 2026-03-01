from decimal import Decimal

from django.test import TestCase

from bookings.models import SiteSettings
from dishes.models import Dish, DishCategory, PoolType
from menus.models import MenuTemplate, MenuDishPortion, MenuTemplatePriceTier
from menus.serializers import MenuTemplateDetailSerializer, MenuTemplateListSerializer


def make_category(name="cat", **kwargs):
    defaults = {
        "name": name,
        "display_name": name.title(),
        "display_order": 0,
        "pool": PoolType.PROTEIN,
        "baseline_budget_grams": 200,
        "min_per_dish_grams": 50,
    }
    defaults.update(kwargs)
    return DishCategory.objects.create(**defaults)


def make_dish(category=None, **kwargs):
    if category is None:
        category = make_category()
    defaults = {
        "name": "Dish",
        "category": category,
        "default_portion_grams": 100,
        "cost_per_gram": Decimal("0.0100"),
    }
    defaults.update(kwargs)
    return Dish.objects.create(**defaults)


class TestSuggestedPricePerHead(TestCase):
    """MenuTemplateDetailSerializer.suggested_price_per_head sums selling × portion."""

    def setUp(self):
        self.settings = SiteSettings.load()
        self.settings.target_food_cost_percentage = Decimal("30.00")
        self.settings.save()
        self.cat = make_category(name="mains")
        self.template = MenuTemplate.objects.create(name="Test Menu")

    def test_single_dish(self):
        dish = make_dish(category=self.cat, name="D1", cost_per_gram=Decimal("0.0300"))
        MenuDishPortion.objects.create(menu=self.template, dish=dish, portion_grams=150)
        data = MenuTemplateDetailSerializer(self.template).data
        self.assertAlmostEqual(data["suggested_price_per_head"], 15.0, places=2)
        self.assertFalse(data["has_unpriced_dishes"])

    def test_multiple_dishes_sum(self):
        d1 = make_dish(category=self.cat, name="D1", cost_per_gram=Decimal("0.0300"))
        d2 = make_dish(category=self.cat, name="D2", cost_per_gram=Decimal("0.0600"))
        MenuDishPortion.objects.create(menu=self.template, dish=d1, portion_grams=100)
        MenuDishPortion.objects.create(menu=self.template, dish=d2, portion_grams=80)
        data = MenuTemplateDetailSerializer(self.template).data
        self.assertAlmostEqual(data["suggested_price_per_head"], 26.0, places=2)

    def test_null_when_no_priced_dishes(self):
        dish = make_dish(category=self.cat, name="Free", cost_per_gram=Decimal("0.0000"))
        MenuDishPortion.objects.create(menu=self.template, dish=dish, portion_grams=100)
        data = MenuTemplateDetailSerializer(self.template).data
        self.assertIsNone(data["suggested_price_per_head"])

    def test_null_when_no_dishes(self):
        data = MenuTemplateDetailSerializer(self.template).data
        self.assertIsNone(data["suggested_price_per_head"])
        self.assertFalse(data["has_unpriced_dishes"])


class TestHasUnpricedDishes(TestCase):
    """has_unpriced_dishes flag in MenuTemplateDetailSerializer."""

    def setUp(self):
        self.settings = SiteSettings.load()
        self.settings.target_food_cost_percentage = Decimal("30.00")
        self.settings.save()
        self.cat = make_category(name="sides")
        self.template = MenuTemplate.objects.create(name="Mixed Menu")

    def test_true_when_mix_of_priced_and_unpriced(self):
        priced = make_dish(category=self.cat, name="Priced", cost_per_gram=Decimal("0.0300"))
        unpriced = make_dish(category=self.cat, name="Unpriced", cost_per_gram=Decimal("0.0000"))
        MenuDishPortion.objects.create(menu=self.template, dish=priced, portion_grams=100)
        MenuDishPortion.objects.create(menu=self.template, dish=unpriced, portion_grams=50)
        data = MenuTemplateDetailSerializer(self.template).data
        self.assertTrue(data["has_unpriced_dishes"])
        self.assertAlmostEqual(data["suggested_price_per_head"], 10.0, places=2)

    def test_false_when_all_priced(self):
        dish = make_dish(category=self.cat, name="D", cost_per_gram=Decimal("0.0300"))
        MenuDishPortion.objects.create(menu=self.template, dish=dish, portion_grams=100)
        data = MenuTemplateDetailSerializer(self.template).data
        self.assertFalse(data["has_unpriced_dishes"])

    def test_override_dish_counted_as_priced(self):
        dish = make_dish(
            category=self.cat,
            name="Override",
            cost_per_gram=Decimal("0.0100"),
            selling_price_override=True,
            selling_price_per_gram=Decimal("0.5000"),
        )
        MenuDishPortion.objects.create(menu=self.template, dish=dish, portion_grams=80)
        data = MenuTemplateDetailSerializer(self.template).data
        self.assertFalse(data["has_unpriced_dishes"])
        self.assertAlmostEqual(data["suggested_price_per_head"], 40.0, places=2)


class TestMenuType(TestCase):
    """menu_type field is serialized correctly."""

    def test_default_is_custom(self):
        menu = MenuTemplate.objects.create(name="My Menu")
        data = MenuTemplateListSerializer(menu).data
        self.assertEqual(data["menu_type"], "custom")

    def test_barat_type(self):
        menu = MenuTemplate.objects.create(name="Wedding", menu_type="barat")
        data = MenuTemplateListSerializer(menu).data
        self.assertEqual(data["menu_type"], "barat")


class TestPriceTiers(TestCase):
    """MenuTemplatePriceTier model and serialization."""

    def test_tiers_serialized_in_list(self):
        menu = MenuTemplate.objects.create(name="Tier Test", menu_type="barat")
        MenuTemplatePriceTier.objects.create(menu=menu, min_guests=50, price_per_head=Decimal("3000"))
        MenuTemplatePriceTier.objects.create(menu=menu, min_guests=100, price_per_head=Decimal("2500"))
        MenuTemplatePriceTier.objects.create(menu=menu, min_guests=200, price_per_head=Decimal("2000"))
        data = MenuTemplateListSerializer(menu).data
        self.assertEqual(len(data["price_tiers"]), 3)
        # Ordered by min_guests
        self.assertEqual(data["price_tiers"][0]["min_guests"], 50)
        self.assertEqual(data["price_tiers"][2]["min_guests"], 200)

    def test_tiers_serialized_in_detail(self):
        menu = MenuTemplate.objects.create(name="Detail Tier", menu_type="mehndi")
        MenuTemplatePriceTier.objects.create(menu=menu, min_guests=50, price_per_head=Decimal("2500"))
        data = MenuTemplateDetailSerializer(menu).data
        self.assertEqual(len(data["price_tiers"]), 1)
        self.assertEqual(data["price_tiers"][0]["price_per_head"], "2500.00")

    def test_unique_together(self):
        menu = MenuTemplate.objects.create(name="Unique Test")
        MenuTemplatePriceTier.objects.create(menu=menu, min_guests=50, price_per_head=Decimal("1000"))
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            MenuTemplatePriceTier.objects.create(menu=menu, min_guests=50, price_per_head=Decimal("2000"))
