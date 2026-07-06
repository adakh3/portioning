"""End-to-end tests for the rendered quote PDF: build a quote, render it with
`generate_quote_pdf`, extract the text with pypdf, and assert what a customer
actually sees — presence, ordering, and that internal notes never leak. These
replace eyeballing the PDF by hand after every change.
"""
import datetime
import io
from decimal import Decimal

from django.test import TestCase

from bookings.models.settings import OrgSettings
from bookings.pdf import generate_quote_pdf
from bookings.tests import _make_org, make_contact, make_quote
from dishes.tests import make_dish
from events.models import BookingMeal

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover - pypdf is a declared dependency
    HAVE_PYPDF = False


def _aug(hour):
    return datetime.datetime(2026, 8, 1, hour, 0, tzinfo=datetime.timezone.utc)


def pdf_text(quote):
    reader = PdfReader(io.BytesIO(generate_quote_pdf(quote)))
    return "\n".join(page.extract_text() for page in reader.pages)


class QuotePDFContentTests(TestCase):
    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        self.org = _make_org(slug="pdf-content")
        self.contact = make_contact(org=self.org)

    def _quote(self, **kwargs):
        q = make_quote(org=self.org, primary_contact=self.contact, **kwargs)
        q.recalculate_totals()
        q.refresh_from_db()
        return q

    def test_shows_split_timeline_meals_in_order(self):
        q = self._quote(
            guest_count=20, gents=12, ladies=8, price_per_head=Decimal("10"),
            setup_time=_aug(10), meal_time=_aug(20), internal_notes="SECRET PLAN",
        )
        BookingMeal.objects.create(
            quote=q, label="Welcome drinks", guest_count=20,
            price_per_head=Decimal("30"), meal_time=_aug(14),
        )
        text = pdf_text(q)

        # Guest split on the guest line.
        self.assertIn("12 gents / 8 ladies", text)
        # Sections present.
        self.assertIn("TIMELINE", text)
        self.assertIn("Setup Time", text)
        self.assertIn("ADDITIONAL MEALS", text)
        # Meal line with its time.
        self.assertIn("Welcome drinks", text)
        self.assertIn("01 Aug 2026, 14:00", text)
        # Order: timeline, then food, then meals (mirrors the form).
        self.assertLess(text.find("TIMELINE"), text.find("FOOD / MENU"))
        self.assertLess(text.find("FOOD / MENU"), text.find("ADDITIONAL MEALS"))
        # Internal notes must never reach the customer PDF.
        self.assertNotIn("SECRET PLAN", text)

    def test_addon_items_are_included_in_the_subtotal(self):
        # Regression: the PDF prints the STORED subtotal. Add-on line items must be
        # folded into it — not listed while the Sub Total silently omits them (the
        # prefetch-cache bug that shipped a food-only total to customers).
        from bookings.models import BookingLineItem
        q = self._quote(guest_count=10, price_per_head=Decimal("100"), tax_rate=Decimal("0"))
        BookingLineItem.objects.create(
            quote=q, category="rental", description="Chairs",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("500"),
        )
        q.refresh_from_db()
        text = pdf_text(q)
        # The add-on is listed…
        self.assertIn("Chairs", text)
        # …and the Sub Total is food (1,000) + add-on (500) = 1,500, not food-only.
        self.assertIn("1,500.00", text)
        self.assertNotIn("Sub Total 1,000.00", text.replace("\n", " "))

    def test_food_line_shows_without_dishes(self):
        # Q-59: a per-head price with no dish list must still render a food line,
        # so the food cost is never hidden inside the subtotal.
        q = self._quote(guest_count=30, gents=15, ladies=15, price_per_head=Decimal("25"))
        text = pdf_text(q)
        self.assertIn("FOOD / MENU", text)
        self.assertIn("per head × 30 guests", text)

    def test_meals_render_even_with_no_main_food(self):
        q = self._quote(guest_count=10, gents=5, ladies=5, price_per_head=None)
        BookingMeal.objects.create(quote=q, label="Hi-Tea", guest_count=10, price_per_head=Decimal("40"))
        text = pdf_text(q)
        self.assertIn("ADDITIONAL MEALS", text)
        self.assertIn("Hi-Tea", text)

    def test_no_timeline_section_when_no_times(self):
        q = self._quote(guest_count=10, gents=5, ladies=5, price_per_head=Decimal("10"))
        self.assertNotIn("TIMELINE", pdf_text(q))

    def test_uses_org_tax_label_never_hardcoded(self):
        st = OrgSettings.for_org(self.org)
        st.tax_label = "GST"
        st.save()
        q = self._quote(guest_count=10, gents=5, ladies=5, price_per_head=Decimal("10"),
                        tax_rate=Decimal("0.10"))
        text = pdf_text(q)
        self.assertIn("GST Rate", text)
        self.assertIn("GST Amount", text)
        self.assertNotIn("Sales Tax", text)

    def test_never_mentions_big_eaters(self):
        q = self._quote(guest_count=10, gents=5, ladies=5, price_per_head=Decimal("10"),
                        big_eaters=True, big_eaters_percentage=25)
        self.assertNotIn("Big Eater", pdf_text(q))

    def test_additional_meal_shows_its_own_menu(self):
        q = self._quote(guest_count=20, gents=10, ladies=10, price_per_head=Decimal("10"))
        cat_dish = make_dish(org=self.org, name="Samosa")
        d2 = make_dish(org=self.org, category=cat_dish.category, name="Spring Roll")
        meal = BookingMeal.objects.create(quote=q, label="Hi-Tea", guest_count=20,
                                          price_per_head=Decimal("30"))
        meal.dishes.set([cat_dish, d2])
        text = pdf_text(q)
        self.assertIn("ADDITIONAL MEALS", text)
        self.assertIn("Hi-Tea", text)
        self.assertIn("Samosa", text)       # the meal's own menu is rendered
        self.assertIn("Spring Roll", text)
