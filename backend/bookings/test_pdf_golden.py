"""GOLDEN-MASTER regression net for the quote PDF.

Renders a maximal quote — every section: header/org, contact (phone+email),
business + address, venue, event-type/service/meal labels, guest split, all
dates, full menu, per-head line, an additional meal with its own menu, one of
every line-item category (fee/beverage/labour/discount), notes, terms, totals,
and (separately) the signed ACCEPTANCE block — extracts the text with pypdf and
asserts it matches a frozen golden stored in test_data/quote_pdf_golden.txt.
Volatile IDs (Q-<pk>, Customer ID) are normalised.

This exists so the "single source" refactor (PDF rendering FROM a shared
booking_presentation) can be proven a pure no-op: if the golden still matches,
not one rendered character changed. Any drift in a field, value, or ordering
fails the test. To intentionally re-baseline, delete the golden file and re-run.
"""
import datetime
import io
import re
from decimal import Decimal
from pathlib import Path

from django.test import TestCase

from bookings.models import BookingLineItem, Quote
from bookings.models.choices import EventTypeOption, ServiceStyleOption, MealTypeOption
from bookings.models.settings import OrgSettings
from bookings.pdf import generate_quote_pdf, generate_event_pdf
from bookings.services.presentation import booking_presentation
from bookings.tests import _make_org, make_account, make_contact, make_venue, make_quote
from bookings.views.public_sign import serialize_public_booking
from dishes.tests import make_dish, make_category
from events.models import Event, BookingMeal
from users.models import User

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover
    HAVE_PYPDF = False

GOLDEN_PATH = Path(__file__).parent / "test_data" / "quote_pdf_golden.txt"
EVENT_GOLDEN_PATH = Path(__file__).parent / "test_data" / "event_pdf_golden.txt"


def _normalise(text):
    """Strip run-to-run volatility (auto-increment pks) so the golden is stable."""
    text = re.sub(r'Q-\d+', 'Q-<pk>', text)
    text = re.sub(r'Customer ID:\s*\d+', 'Customer ID: <id>', text)
    return text


def _pdf_text(quote, signature=None):
    reader = PdfReader(io.BytesIO(generate_quote_pdf(quote, signature=signature)))
    return _normalise("\n".join(p.extract_text() for p in reader.pages))


class QuotePdfGoldenTests(TestCase):
    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        self.org = _make_org(slug="pdf-golden", name="Golden Caterers", country="GB")
        EventTypeOption.objects.get_or_create(organisation=self.org, value="wedding", defaults={"label": "Wedding"})
        ServiceStyleOption.objects.get_or_create(organisation=self.org, value="plated", defaults={"label": "Plated"})
        MealTypeOption.objects.get_or_create(organisation=self.org, value="dinner", defaults={"label": "Dinner"})
        settings = OrgSettings.for_org(self.org)
        settings.currency_symbol = "£"
        settings.tax_label = "VAT"
        settings.quotation_terms = ("A 25% deposit is required to confirm the booking.\n"
                                    "Balance due 14 days before the event.")
        settings.save()
        self.user = User.objects.create_user(email="owner@golden.test", password="x", organisation=self.org)

    def _maximal_quote(self):
        account = make_account(org=self.org, name="Acme Events Ltd",
                               billing_address_line1="1 High St", billing_city="London", billing_postcode="EC1A 1AA")
        contact = make_contact(account=account, org=self.org, name="Aisha Khan",
                               email="aisha@example.com", phone="+447700900123")
        venue = make_venue(org=self.org, name="Grand Hall", address_line1="2 Park Ave", city="London")
        cat = make_category(org=self.org, name="mains", display_name="Mains", display_order=1)
        d1 = make_dish(org=self.org, category=cat, name="Biryani")
        d2 = make_dish(org=self.org, category=cat, name="Karahi")
        q = make_quote(
            org=self.org, account=account, primary_contact=contact, is_b2b=True, venue=venue,
            event_date=datetime.date(2026, 9, 1), guest_count=100, gents=60, ladies=40,
            price_per_head=Decimal("50"), event_type="wedding", service_style="plated",
            meal_type="dinner", valid_until=datetime.date(2026, 8, 1),
            booking_date=datetime.date(2026, 7, 15), tax_rate=Decimal("0.2000"), is_taxable=True,
            notes="Please keep nut-free.", created_by=self.user,
        )
        q.dishes.set([d1, d2])
        meal = BookingMeal.objects.create(quote=q, label="Welcome drinks", guest_count=100, price_per_head=Decimal("10"))
        meal.dishes.set([d1])
        BookingLineItem.objects.create(quote=q, category="fee", description="Setup fee", quantity=1, unit="flat", unit_price=Decimal("100"))
        BookingLineItem.objects.create(quote=q, category="beverage", description="Soft drinks", quantity=100, unit="each", unit_price=Decimal("3"))
        BookingLineItem.objects.create(quote=q, category="labor", description="Waiter", quantity=5, unit="each", unit_price=Decimal("40"))
        BookingLineItem.objects.create(quote=q, category="discount", description="Loyalty discount", quantity=1, unit="flat", unit_price=Decimal("50"))
        Quote.objects.filter(pk=q.pk).update(created_at=datetime.datetime(2026, 7, 10, 9, 0, tzinfo=datetime.timezone.utc))
        q.refresh_from_db()
        q.recalculate_totals()
        q.refresh_from_db()
        return q

    def test_quote_pdf_matches_golden(self):
        text = _pdf_text(self._maximal_quote())
        if not GOLDEN_PATH.exists():
            GOLDEN_PATH.parent.mkdir(exist_ok=True)
            GOLDEN_PATH.write_text(text)
            self.skipTest("golden written — re-run to assert against it")
        self.assertEqual(
            text, GOLDEN_PATH.read_text(),
            "Quote PDF output changed vs the golden. If this change is intentional, "
            "delete backend/bookings/test_data/quote_pdf_golden.txt and re-run to re-baseline.",
        )

    def test_signed_pdf_has_acceptance_block(self):
        from bookings.models import BookingSignature
        q = self._maximal_quote()
        # Sign it (attach to the quote for the PDF stamp), freeze the timestamp.
        sig = BookingSignature.objects.create(
            quote=q, signer_name="Aisha Khan", agreed_total=q.total,
            ip_address="203.0.113.7", consent_text="agreed",
        )
        BookingSignature.objects.filter(pk=sig.pk).update(
            signed_at=datetime.datetime(2026, 7, 20, 8, 47, tzinfo=datetime.timezone.utc))
        sig.refresh_from_db()
        text = _pdf_text(q, signature=sig)
        self.assertIn("ACCEPTANCE", text)
        self.assertIn("signed electronically by", text)
        self.assertIn("Aisha Khan", text)
        # IP is kept on the signature record for audit, but must NOT be printed.
        self.assertNotIn("203.0.113.7", text)

    def test_markdown_terms_render_without_raw_markers(self):
        """The seeded T&C template is lightweight markdown — the PDF must render
        headings/bold/bullets, never raw '#'/'##'/'**'/'- ' markers."""
        settings = OrgSettings.for_org(self.org)
        settings.quotation_terms = (
            "# Service Agreement\n\n"
            "**Effective Date:** [Date]\n\n"
            "## 1. Booking & Confirmation\n"
            "- A deposit is required to confirm.\n"
        )
        settings.save()
        text = _pdf_text(self._maximal_quote())
        for token in ("Service Agreement", "1. Booking & Confirmation",
                      "Effective Date:", "A deposit is required to confirm."):
            self.assertIn(token, text)
        self.assertNotIn("##", text)
        self.assertNotIn("**", text)

    def test_booking_presentation_contract(self):
        """Lock the single-source contract: a future edit can't quietly drop a
        field or stop resolving a label."""
        q = self._maximal_quote()
        p = booking_presentation(q)
        self.assertEqual(p["kind"], "quote")
        self.assertEqual(p["customer_name"], "Aisha Khan")
        self.assertEqual(p["contact_phone"], "+447700900123")
        self.assertEqual(p["contact_email"], "aisha@example.com")
        self.assertEqual(p["business_name"], "Golden Caterers")
        # Labels resolved, not raw slugs (the divergence that started all this).
        self.assertEqual(p["event_type_label"], "Wedding")
        self.assertEqual(p["service_style_label"], "Plated")
        self.assertEqual(p["meal_type_label"], "Dinner")
        self.assertEqual((p["guest_count"], p["gents"], p["ladies"]), (100, 60, 40))
        self.assertEqual(p["total"], str(q.total))
        self.assertIn("Biryani", p["menu_flat"])
        self.assertTrue(any(g["category"] == "Mains" for g in p["menu"]))
        self.assertEqual(p["additional_meals"][0]["label"], "Welcome drinks")
        self.assertTrue(any(li["is_discount"] for li in p["line_items"]))
        self.assertIn("deposit", p["terms"])

    def test_presentation_includes_timeline(self):
        q = self._maximal_quote()
        q.setup_time = datetime.datetime(2026, 9, 1, 16, 0, tzinfo=datetime.timezone.utc)
        q.meal_time = datetime.datetime(2026, 9, 1, 20, 0, tzinfo=datetime.timezone.utc)
        q.save(update_fields=["setup_time", "meal_time"])
        labels = [t["label"] for t in booking_presentation(q)["timeline"]]
        self.assertEqual(labels, ["Setup", "Meal service"])

    def test_sign_page_and_pdf_share_the_same_fields(self):
        """Parity guard: key content must appear in BOTH the /b/<token> payload
        and the PDF — so a renderer can't silently forget a field."""
        q = self._maximal_quote()
        payload = serialize_public_booking(q)
        pdf = _pdf_text(q)
        # Present in the page payload…
        self.assertEqual(payload["customer_name"], "Aisha Khan")
        self.assertEqual(payload["event_type_label"], "Wedding")
        self.assertTrue(any("Biryani" in g["items"] for g in payload["menu"]))
        self.assertEqual(payload["additional_meals"][0]["label"], "Welcome drinks")
        # …and rendered in the PDF (the same underlying values, one source).
        for token in ("Aisha Khan", "Wedding", "Biryani", "Welcome drinks", "Golden Caterers"):
            self.assertIn(token, pdf, f"{token!r} in payload but missing from the PDF")


class EventPdfGoldenTests(TestCase):
    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        self.org = _make_org(slug="event-golden", name="Golden Caterers", country="GB")
        settings = OrgSettings.for_org(self.org)
        settings.currency_symbol = "£"
        settings.tax_label = "VAT"
        settings.save()
        self.user = User.objects.create_user(email="ev@golden.test", password="x", organisation=self.org)

    def _maximal_event(self):
        cat = make_category(org=self.org, name="mains", display_name="Mains", display_order=1)
        d1 = make_dish(org=self.org, category=cat, name="Biryani")
        d2 = make_dish(org=self.org, category=cat, name="Karahi")

        def dt(h):
            return datetime.datetime(2026, 9, 1, h, 0, tzinfo=datetime.timezone.utc)

        e = Event.objects.create(
            organisation=self.org, name="Khan Wedding", event_date=datetime.date(2026, 9, 1),
            guest_count=100, gents=60, ladies=40, event_type="wedding", price_per_head=Decimal("50"),
            guaranteed_count=100, final_count=95, status="confirmed",
            setup_time=dt(16), meal_time=dt(20),
            kitchen_instructions="No pork. Halal only.", banquet_instructions="White linen.",
            setup_instructions="Stage north wall.", tax_rate=Decimal("0.2000"), is_taxable=True,
            notes="Nut-free please.", created_by=self.user,
        )
        e.dishes.set([d1, d2])
        meal = BookingMeal.objects.create(event=e, label="Welcome drinks", guest_count=100,
                                          price_per_head=Decimal("10"), meal_time=dt(18))
        meal.dishes.set([d1])
        BookingLineItem.objects.create(event=e, category="labor", description="Waiters",
                                       quantity=5, unit="each", unit_price=Decimal("40"))
        e.recalculate_totals()
        e.refresh_from_db()
        return e

    def test_event_pdf_matches_golden(self):
        reader = PdfReader(io.BytesIO(generate_event_pdf(self._maximal_event())))
        text = re.sub(r'E-\d+', 'E-<pk>', "\n".join(p.extract_text() for p in reader.pages))
        if not EVENT_GOLDEN_PATH.exists():
            EVENT_GOLDEN_PATH.parent.mkdir(exist_ok=True)
            EVENT_GOLDEN_PATH.write_text(text)
            self.skipTest("event golden written — re-run to assert against it")
        self.assertEqual(
            text, EVENT_GOLDEN_PATH.read_text(),
            "Event PDF output changed vs the golden. If intentional, delete "
            "backend/bookings/test_data/event_pdf_golden.txt and re-run to re-baseline.",
        )
