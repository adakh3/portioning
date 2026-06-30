"""Unit tests for the quote-PDF pure helpers (F2/F3). The PDF itself has no
text-extraction test path (only reportlab is installed), so the rendered content
is covered by testing these helpers + the existing smoke test."""
from decimal import Decimal

from django.test import SimpleTestCase

from bookings.pdf import food_summary_text, addon_cells


class _Item:
    def __init__(self, category, description, quantity, unit, unit_price, line_total):
        self.category = category
        self.description = description
        self.quantity = quantity
        self.unit = unit
        self.unit_price = unit_price
        self.line_total = line_total


class FoodSummaryTextTests(SimpleTestCase):
    def test_shown_when_food_total_positive_even_with_no_dishes(self):
        # The Q-59 case: 50/head × 40 with no menu must still produce the food line.
        self.assertEqual(
            food_summary_text(Decimal("50"), 40, Decimal("2000"), "PKR"),
            "PKR50.00 per head × 40 guests = PKR2,000.00",
        )

    def test_none_when_no_food(self):
        self.assertIsNone(food_summary_text(Decimal("0"), 40, Decimal("0"), "PKR"))
        self.assertIsNone(food_summary_text(None, 40, None, "PKR"))


class AddonCellsTests(SimpleTestCase):
    def test_includes_category_label(self):
        item = _Item("beverage", "Tea & Coffee", Decimal("40"), "each", Decimal("1200"), Decimal("48000"))
        cat, desc, rate, amount = addon_cells(item, "PKR")
        self.assertEqual(cat, "Beverage")  # F3: category column now rendered
        self.assertIn("Tea & Coffee", desc)
        self.assertEqual(rate, "PKR1,200.00")
        self.assertEqual(amount, "PKR48,000.00")

    def test_quantity_suffix_and_discount(self):
        item = _Item("discount", "Lumsum", Decimal("1"), "flat", Decimal("11200"), Decimal("-11200"))
        cat, _desc, _rate, amount = addon_cells(item, "PKR")
        self.assertEqual(cat, "Discount")
        self.assertEqual(amount, "PKR-11,200.00")
