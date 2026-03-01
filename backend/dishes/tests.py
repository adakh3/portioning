from decimal import Decimal

from django.test import TestCase

from bookings.models import SiteSettings
from dishes.models import Dish, DishCategory, PoolType


def make_category(**kwargs):
    defaults = {
        "name": "test_cat",
        "display_name": "Test Category",
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
        "name": "Test Dish",
        "category": category,
        "default_portion_grams": 100,
        "cost_per_gram": Decimal("0.0100"),
    }
    defaults.update(kwargs)
    return Dish.objects.create(**defaults)


class TestDishSellingPriceAutoCalc(TestCase):
    """selling_price_per_gram is auto-calculated from cost / target food cost %."""

    def setUp(self):
        self.settings = SiteSettings.load()
        self.settings.target_food_cost_percentage = Decimal("30.00")
        self.settings.save()

    def test_auto_calculated_on_save(self):
        dish = make_dish(cost_per_gram=Decimal("0.0300"))
        # 0.03 / 0.30 = 0.10
        self.assertAlmostEqual(float(dish.selling_price_per_gram), 0.10, places=4)

    def test_updates_when_cost_changes(self):
        dish = make_dish(cost_per_gram=Decimal("0.0300"))
        dish.cost_per_gram = Decimal("0.0600")
        dish.save()
        # 0.06 / 0.30 = 0.20
        self.assertAlmostEqual(float(dish.selling_price_per_gram), 0.20, places=4)

    def test_different_target_percentage(self):
        self.settings.target_food_cost_percentage = Decimal("25.00")
        self.settings.save()
        dish = make_dish(cost_per_gram=Decimal("0.0500"))
        # 0.05 / 0.25 = 0.20
        self.assertAlmostEqual(float(dish.selling_price_per_gram), 0.20, places=4)

    def test_zero_cost_leaves_selling_price_null(self):
        dish = make_dish(cost_per_gram=Decimal("0.0000"))
        self.assertIsNone(dish.selling_price_per_gram)


class TestDishSellingPriceOverride(TestCase):
    """When override is True, selling_price_per_gram is not auto-calculated."""

    def setUp(self):
        self.settings = SiteSettings.load()
        self.settings.target_food_cost_percentage = Decimal("30.00")
        self.settings.save()

    def test_override_preserves_manual_price(self):
        dish = make_dish(
            cost_per_gram=Decimal("0.0300"),
            selling_price_override=True,
            selling_price_per_gram=Decimal("0.5000"),
        )
        self.assertEqual(dish.selling_price_per_gram, Decimal("0.5000"))

    def test_override_not_overwritten_on_resave(self):
        dish = make_dish(
            cost_per_gram=Decimal("0.0300"),
            selling_price_override=True,
            selling_price_per_gram=Decimal("0.5000"),
        )
        dish.cost_per_gram = Decimal("0.0600")
        dish.save()
        # Should still be the manual value, not recalculated
        self.assertEqual(dish.selling_price_per_gram, Decimal("0.5000"))


class TestDishComputedSellingPrice(TestCase):
    """The computed_selling_price property."""

    def setUp(self):
        self.settings = SiteSettings.load()
        self.settings.target_food_cost_percentage = Decimal("30.00")
        self.settings.save()

    def test_computed_price(self):
        dish = make_dish(cost_per_gram=Decimal("0.0300"))
        self.assertAlmostEqual(float(dish.computed_selling_price), 0.10, places=4)

    def test_none_when_zero_cost(self):
        dish = make_dish(cost_per_gram=Decimal("0.0000"))
        self.assertIsNone(dish.computed_selling_price)

    def test_none_when_zero_target(self):
        self.settings.target_food_cost_percentage = Decimal("0.00")
        self.settings.save()
        dish = make_dish(cost_per_gram=Decimal("0.0300"))
        self.assertIsNone(dish.computed_selling_price)


class TestDishMarginPercent(TestCase):
    """margin_percent serializer field: (1 - cost/selling) * 100."""

    def setUp(self):
        self.settings = SiteSettings.load()
        self.settings.target_food_cost_percentage = Decimal("30.00")
        self.settings.save()

    def test_margin_from_serializer(self):
        from dishes.serializers import DishSerializer
        dish = make_dish(cost_per_gram=Decimal("0.0300"))
        data = DishSerializer(dish).data
        # cost=0.03, selling=0.10 → margin = (1 - 0.03/0.10)*100 = 70%
        self.assertAlmostEqual(data["margin_percent"], 70.0, places=1)

    def test_margin_none_when_no_selling_price(self):
        from dishes.serializers import DishSerializer
        dish = make_dish(cost_per_gram=Decimal("0.0000"))
        data = DishSerializer(dish).data
        self.assertIsNone(data["margin_percent"])
