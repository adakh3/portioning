"""Service charge + gratuity (REL-404): stored amounts, PDF rows, and the
OrgSettings snapshot-on-create for both quotes and events."""
import io
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from bookings.models.settings import OrgSettings
from bookings.pdf import generate_quote_pdf, generate_event_pdf
from bookings.serializers.quotes import QuoteSerializer
from bookings.tests import _make_org, make_contact, make_quote
from events.models import Event
from events.serializers import EventSerializer
from users.models import Organisation

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover
    HAVE_PYPDF = False


class ServiceChargeGratuityTotals(TestCase):
    def setUp(self):
        self.org = _make_org()

    def _quote(self, **kw):
        q = make_quote(org=self.org, guest_count=100, price_per_head=Decimal("10.00"),
                       tax_rate=Decimal("0.20"), is_taxable=True, **kw)
        q.recalculate_totals()
        q.refresh_from_db()
        return q

    def test_taxable_service_charge(self):
        # £1,000 subtotal, 20% taxable service charge → tax on 1,200.
        q = self._quote(service_charge_pct=Decimal("20"), service_charge_taxable=True)
        self.assertEqual(q.subtotal, Decimal("1000.00"))
        self.assertEqual(q.service_charge, Decimal("200.00"))
        self.assertEqual(q.tax_amount, Decimal("240.00"))   # 1,200 × 0.20
        self.assertEqual(q.total, Decimal("1440.00"))

    def test_non_taxable_service_charge(self):
        q = self._quote(service_charge_pct=Decimal("20"), service_charge_taxable=False)
        self.assertEqual(q.service_charge, Decimal("200.00"))
        self.assertEqual(q.tax_amount, Decimal("200.00"))   # tax on 1,000 only
        self.assertEqual(q.total, Decimal("1400.00"))

    def test_gratuity_is_post_tax_and_untaxed(self):
        q = self._quote(gratuity_pct=Decimal("15"))
        self.assertEqual(q.tax_amount, Decimal("200.00"))   # tax unaffected by gratuity
        self.assertEqual(q.gratuity, Decimal("150.00"))
        self.assertEqual(q.total, Decimal("1350.00"))

    def test_all_zero_is_todays_math(self):
        q = self._quote()  # no service charge / gratuity
        self.assertEqual(q.service_charge, Decimal("0.00"))
        self.assertEqual(q.gratuity, Decimal("0.00"))
        self.assertEqual(q.tax_amount, Decimal("200.00"))
        self.assertEqual(q.total, Decimal("1200.00"))

    def test_event_service_charge(self):
        ev = Event.objects.create(
            organisation=self.org, name="E", event_date="2026-09-01", guest_count=100,
            gents=50, ladies=50, price_per_head=Decimal("10.00"), is_taxable=True,
            tax_rate=Decimal("0.20"), service_charge_pct=Decimal("20"),
        )
        ev.recalculate_totals()
        ev.refresh_from_db()
        self.assertEqual(ev.service_charge, Decimal("200.00"))
        self.assertEqual(ev.total, Decimal("1440.00"))

    def test_quote_pdf_shows_service_charge_and_gratuity_rows(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        s = OrgSettings.for_org(self.org)
        s.currency_symbol = "$"
        s.save()
        q = self._quote(service_charge_pct=Decimal("20"), gratuity_pct=Decimal("15"))
        text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(generate_quote_pdf(q))).pages)
        self.assertIn("Service Charge (20%)", text)
        self.assertIn("$200.00", text)   # service charge amount
        self.assertIn("Gratuity (15%)", text)
        self.assertIn("$150.00", text)   # gratuity amount

    def test_event_pdf_shows_service_charge_and_gratuity_rows(self):
        # The event PDF doubles as the signed contract, so its totals block must
        # render the service charge / gratuity when non-zero (the GB snapshot gate
        # only covers the 0% case). $1,000 subtotal, 20% taxable SC, 15% gratuity:
        # tax = 1,200 × 0.20 = 240; total = 1,000 + 200 + 240 + 150 = 1,590.
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        s = OrgSettings.for_org(self.org)
        s.currency_symbol = "$"
        s.save()
        ev = Event.objects.create(
            organisation=self.org, name="E", event_date="2026-09-01", guest_count=100,
            gents=50, ladies=50, price_per_head=Decimal("10.00"), is_taxable=True,
            tax_rate=Decimal("0.20"), service_charge_pct=Decimal("20"),
            gratuity_pct=Decimal("15"),
        )
        ev.recalculate_totals()
        ev.refresh_from_db()
        text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(generate_event_pdf(ev))).pages)
        self.assertIn("Service Charge (20%)", text)
        self.assertIn("$200.00", text)     # service charge amount
        self.assertIn("Gratuity (15%)", text)
        self.assertIn("$150.00", text)     # gratuity amount
        self.assertIn("$1,590.00", text)   # grand total, incl. SC + tax + gratuity


class PricingSnapshotOnCreate(TestCase):
    """Quotes and events snapshot the org's service charge / gratuity defaults at
    creation (the asymmetry fix — previously only events copied tax_rate)."""

    def _ctx(self, org):
        req = APIRequestFactory().post("/")
        req.user = get_user_model().objects.filter(organisation=org).first()
        req.organisation = org  # what the view resolves; drives FK narrowing
        return {"request": req}

    def _us_org(self):
        # A fresh US org gets service_charge_default_pct=20 via country_defaults.
        org = Organisation.objects.create(name="US Caterer", slug="us-caterer", country="US")
        get_user_model().objects.create(email="u@us.test", organisation=org, is_active=True)
        return org

    def test_quote_snapshots_service_charge_from_org(self):
        org = self._us_org()
        contact = make_contact(org=org)
        ser = QuoteSerializer(context=self._ctx(org), data={
            "primary_contact": contact.id, "event_date": "2026-09-01", "guest_count": 50,
        })
        ser.is_valid(raise_exception=True)
        quote = ser.save(organisation=org)  # the view injects org on create
        self.assertEqual(quote.service_charge_pct, Decimal("20.00"))
        self.assertEqual(quote.tax_rate, Decimal("0.0000"))  # US tax default

    def test_event_snapshots_service_charge_from_org(self):
        org = self._us_org()
        ser = EventSerializer(context=self._ctx(org), data={
            "name": "US Event", "date": "2026-09-01", "guest_count": 50,
        })
        ser.is_valid(raise_exception=True)
        event = ser.save(organisation=org)
        self.assertEqual(event.service_charge_pct, Decimal("20.00"))
