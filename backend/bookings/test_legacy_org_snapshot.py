"""Legacy-org snapshot gate.

Wave 0 (locale cleanup) changed the *defaults* a new org gets (US-generic
$/Sales Tax/MM-DD instead of UK £/VAT/DD-MM). This gate proves that an EXISTING
GB-region org — one with explicit £/VAT/DD-MM settings and a gents/ladies split —
is completely unaffected: its computed totals and its rendered quote-PDF text stay
byte-for-byte what they are today.

Every later US-readiness wave inherits this gate: if a change ever alters a
legacy org's numbers or PDF, this test fails first.
"""
import io
from decimal import Decimal

from django.test import TestCase

from bookings.models.settings import OrgSettings
from bookings.pdf import generate_quote_pdf
from bookings.tests import _make_org, make_contact, make_quote

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover
    HAVE_PYPDF = False


class LegacyOrgSnapshotGate(TestCase):
    def setUp(self):
        self.org = _make_org(slug="existing-gb-org", country="GB")
        # An established GB org: explicit £/VAT/DD-MM (not the new US defaults).
        s = OrgSettings.for_org(self.org)
        s.currency_symbol = "£"
        s.currency_code = "GBP"
        s.tax_label = "VAT"
        s.date_format = "DD/MM/YYYY"
        s.default_tax_rate = Decimal("0.2000")
        s.save()
        self.contact = make_contact(org=self.org)

    def _quote(self):
        q = make_quote(
            org=self.org, primary_contact=self.contact,
            guest_count=100, gents=60, ladies=40,
            price_per_head=Decimal("10.00"),
            is_taxable=True, tax_rate=Decimal("0.2000"),
        )
        q.recalculate_totals()
        q.refresh_from_db()
        return q

    def test_computed_totals_are_unchanged(self):
        q = self._quote()
        # £10/head × 100 = £1,000 food; VAT @ 20% = £200; total £1,200.
        self.assertEqual(q.subtotal, Decimal("1000.00"))
        self.assertEqual(q.tax_amount, Decimal("200.00"))
        self.assertEqual(q.total, Decimal("1200.00"))

    def test_quote_pdf_still_renders_pounds_vat_and_the_split(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        q = self._quote()
        reader = PdfReader(io.BytesIO(generate_quote_pdf(q)))
        text = "\n".join(page.extract_text() for page in reader.pages)

        # Money renders in pounds; tax label is VAT; the gents/ladies split intact.
        self.assertIn("£1,000.00", text)
        self.assertIn("£1,200.00", text)
        self.assertIn("£200.00", text)   # VAT amount
        self.assertIn("VAT", text)
        self.assertIn("60 gents / 40 ladies", text)
        # The rendered amounts are £, never $. (The starter T&C boilerplate may
        # itself mention "$" — that's template text, not a currency-rendered
        # figure — so assert on the actual money amounts, not a bare "$".)
        self.assertNotIn("$1,000", text)
        self.assertNotIn("$1,200", text)
        self.assertNotIn("$200.00", text)

    def test_event_pdf_has_a_gb_totals_block_and_no_service_charge(self):
        # REL-404 deliberately adds a totals block to the event PDF (it doubles as
        # the signed contract). For a GB org with no service charge it must show
        # £ Sub Total / VAT / Grand Total and NO "Service Charge" line.
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        from events.models import Event
        from bookings.pdf import generate_event_pdf
        ev = Event.objects.create(
            organisation=self.org, name="GB Event", event_date="2026-09-01",
            guest_count=100, gents=60, ladies=40, price_per_head=Decimal("10.00"),
            is_taxable=True, tax_rate=Decimal("0.2000"),
        )
        ev.recalculate_totals()
        ev.refresh_from_db()
        reader = PdfReader(io.BytesIO(generate_event_pdf(ev)))
        text = "\n".join(page.extract_text() for page in reader.pages)

        self.assertIn("Sub Total", text)
        self.assertIn("£1,000.00", text)   # subtotal
        self.assertIn("£200.00", text)     # VAT amount
        self.assertIn("£1,200.00", text)   # grand total
        self.assertIn("VAT", text)
        self.assertNotIn("Service Charge", text)   # 0% for a GB org
        self.assertNotIn("Gratuity", text)
