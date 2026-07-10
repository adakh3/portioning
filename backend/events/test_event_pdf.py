"""End-to-end tests for the event function-sheet PDF: build an event, render it
with `generate_event_pdf`, extract the text with pypdf, and assert the ops team
sees the split, timeline, menu, meals and kitchen/banquet/setup instructions.
Plus the download endpoint (auth + org scoping)."""
import datetime
import io
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user
from events.models import Event, BookingMeal
from bookings.models import BookingLineItem
from bookings.pdf import generate_event_pdf
from dishes.tests import make_dish

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover - pypdf is a declared dependency
    HAVE_PYPDF = False


def _dt(hour):
    return datetime.datetime(2026, 8, 1, hour, 0, tzinfo=datetime.timezone.utc)


class EventPDFTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _event(self, org=None):
        e = Event.objects.create(
            organisation=org or self.org, name="Khan Wedding",
            event_date=datetime.date(2026, 8, 1), gents=60, ladies=40,
            big_eaters=True, big_eaters_percentage=20, event_type="wedding",
            price_per_head=Decimal("50"), guaranteed_count=100, final_count=95,
            status="confirmed", setup_time=_dt(16), meal_time=_dt(20),
            kitchen_instructions="No pork. Halal only.",
            banquet_instructions="White linen.", setup_instructions="Stage north wall.",
        )
        BookingMeal.objects.create(event=e, label="Welcome drinks", guest_count=100,
                                   price_per_head=Decimal("10"), meal_time=_dt(18))
        BookingLineItem.objects.create(event=e, category="labor", description="Waiters",
                                       quantity=Decimal("5"), unit="each", unit_price=Decimal("2000"))
        e.recalculate_totals()
        return e

    def _text(self, e):
        reader = PdfReader(io.BytesIO(generate_event_pdf(e)))
        return "\n".join(p.extract_text() for p in reader.pages)

    def test_function_sheet_shows_ops_detail_in_order(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        text = self._text(self._event())
        self.assertIn("EVENT FUNCTION SHEET", text)
        self.assertIn("60 gents / 40 ladies", text)
        self.assertIn("Guaranteed Count", text)
        self.assertIn("TIMELINE", text)
        self.assertIn("ADDITIONAL MEALS", text)
        self.assertIn("Welcome drinks", text)
        # Ops instructions — the reason a function sheet exists.
        self.assertIn("KITCHEN INSTRUCTIONS", text)
        self.assertIn("No pork", text)
        self.assertIn("BANQUET INSTRUCTIONS", text)
        self.assertIn("SETUP INSTRUCTIONS", text)
        # Timeline leads, then food, then meals (mirrors the editor).
        self.assertLess(text.find("TIMELINE"), text.find("FOOD / MENU"))
        self.assertLess(text.find("FOOD / MENU"), text.find("ADDITIONAL MEALS"))

    def test_pdf_endpoint_returns_pdf(self):
        e = self._event()
        res = self.client.get(f"/api/events/{e.id}/pdf/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "application/pdf")
        self.assertTrue(res.content.startswith(b"%PDF"))

    def test_menu_items_render_in_add_order_not_alphabetical(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        from dishes.tests import make_category, make_dish
        # Two dishes → the menu table puts one in each column on the same row, so
        # extracted text order is unambiguous (unlike a 3+ item 2-column split).
        cat = make_category(org=self.org)
        z = make_dish(org=self.org, category=cat, name="Zebra Kebab")
        a = make_dish(org=self.org, category=cat, name="Apple Tart")
        e = Event.objects.create(
            organisation=self.org, name="Order Test",
            event_date=datetime.date(2026, 8, 1), gents=10, ladies=10,
        )
        e.dishes.set([z, a])  # added Zebra first — reverse-alphabetical
        text = self._text(e)
        # Add-order (Zebra before Apple), NOT alphabetical (Apple before Zebra).
        self.assertLess(text.find("Zebra Kebab"), text.find("Apple Tart"))

    def test_never_mentions_big_eaters(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        self.assertNotIn("Big Eater", self._text(self._event()))

    def test_additional_meal_shows_its_own_menu(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        e = self._event()
        d1 = make_dish(org=self.org, name="Samosa")
        d2 = make_dish(org=self.org, category=d1.category, name="Spring Roll")
        e.additional_meals.first().dishes.set([d1, d2])
        text = self._text(e)
        self.assertIn("Samosa", text)
        self.assertIn("Spring Roll", text)

    def test_pdf_endpoint_is_org_scoped(self):
        from users.models import Organisation
        other = Organisation.objects.create(name="Other Co PDF", slug="other-co-pdf")
        e = self._event(org=other)
        res = self.client.get(f"/api/events/{e.id}/pdf/")
        self.assertEqual(res.status_code, 404)
