"""A PDF must print the rate the customer is actually charged.

The totals block rounded every percentage to a whole number, so an 8.5% sales
tax printed "8%" (Decimal's half-even) while the app showed "9%" and the money —
correct everywhere — was 8.5%. US sales tax is routinely fractional (CA 7.25%,
plenty of x.5% jurisdictions), so this misstated the rate on the customer-facing
document for most US orgs. Service charge and gratuity had the same bug.
"""
from decimal import Decimal

from django.test import TestCase

from bookings.pdf import _pct


class PercentFormattingTests(TestCase):
    def test_a_fractional_rate_keeps_its_fraction(self):
        self.assertEqual(_pct(Decimal('8.5')), '8.5')
        self.assertEqual(_pct(Decimal('7.25')), '7.25')

    def test_a_whole_rate_has_no_trailing_zeros(self):
        # Byte-identity for the common case: "20", never "20.00".
        self.assertEqual(_pct(Decimal('20')), '20')
        self.assertEqual(_pct(Decimal('20.00')), '20')

    def test_zero_and_none(self):
        self.assertEqual(_pct(Decimal('0')), '0')
        self.assertEqual(_pct(None), '0')

    def test_a_tax_rate_scaled_from_its_decimal_fraction(self):
        # How the PDF derives it: tax_rate 0.0850 -> 8.5%
        self.assertEqual(_pct(Decimal('0.0850') * 100), '8.5')
        self.assertEqual(_pct(Decimal('0.0725') * 100), '7.25')
        self.assertEqual(_pct(Decimal('0.2000') * 100), '20')


class RenderedPdfPercentageTests(TestCase):
    """Render-and-extract: the number on the page, not just the helper."""

    def test_the_quote_pdf_prints_the_fractional_tax_rate(self):
        import io

        from pypdf import PdfReader

        from bookings.models import Contact, Quote
        from bookings.pdf import generate_quote_pdf
        from tests.base import get_test_user

        user = get_test_user()
        contact = Contact.objects.create(organisation=user.organisation, name='Client')
        quote = Quote.objects.create(
            organisation=user.organisation, primary_contact=contact,
            event_date='2026-05-01', guest_count=100, price_per_head=Decimal('50'),
            is_taxable=True, tax_rate=Decimal('0.0850'),
            service_charge_pct=Decimal('7.5'), gratuity_pct=Decimal('2.5'),
        )
        quote.recalculate_totals()
        quote.refresh_from_db()

        data = generate_quote_pdf(quote)
        data = data.getvalue() if hasattr(data, 'getvalue') else data
        text = '\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(data)).pages)

        self.assertIn('8.5%', text)                 # was '8%'
        self.assertIn('Service Charge (7.5%)', text)  # was '(8%)'
        self.assertIn('Gratuity (2.5%)', text)        # was '(2%)'
