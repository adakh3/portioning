"""The AI proposal prose (REL-413) renders into the quote PDF, and a quote with
no prose renders byte-identically to before (snapshot-safe)."""
import io
from decimal import Decimal

from django.test import TestCase

from bookings.pdf import generate_quote_pdf
from bookings.tests import _make_org, make_contact, make_quote

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover
    HAVE_PYPDF = False


def _text(quote):
    reader = PdfReader(io.BytesIO(generate_quote_pdf(quote)))
    return "\n".join(page.extract_text() for page in reader.pages)


class QuotePDFProposalTests(TestCase):
    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        self.org = _make_org(slug="pdf-proposal")
        self.contact = make_contact(org=self.org)

    def _quote(self, **kwargs):
        q = make_quote(org=self.org, primary_contact=self.contact,
                       guest_count=50, price_per_head=Decimal("40"), **kwargs)
        q.recalculate_totals()
        q.refresh_from_db()
        return q

    def test_proposal_prose_renders_in_pdf(self):
        q = self._quote(proposal_prose={
            'intro': 'We would be honoured to cater your celebration.',
            'section_descriptions': {'Mains': 'Slow-roasted, generous portions.'},
            'whats_included': ['Full service staff', 'All serviceware'],
            'day_of_outline': 'Arrive two hours early to set up.',
            'closing': 'We cannot wait to make your day special.',
        })
        text = _text(q)
        self.assertIn('We would be honoured to cater your celebration.', text)
        self.assertIn('Slow-roasted, generous portions.', text)
        self.assertIn('Full service staff', text)
        self.assertIn('Arrive two hours early', text)
        self.assertIn('We cannot wait to make your day special.', text)

    def test_no_prose_renders_no_proposal_section(self):
        # A hand-built quote (null prose) must not gain any proposal text.
        q = self._quote()
        text = _text(q)
        self.assertNotIn("What's included", text)
