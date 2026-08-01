"""Every free-text field must reach the PDF as text, not as markup.

reportlab parses each Paragraph as mini-markup, so raw user text was
*interpreted*: a note reading "<b>Deposit due</b>" silently rendered bold rather
than showing the characters, and malformed markup — a "<br>" or a stray "</b>",
easy to paste in from an email — raised ValueError and killed the whole
download. Course names were escaped (REL-417); nothing else was, including the
**client-supplied signer name** written onto the signed copy.
"""
import datetime
import io
from decimal import Decimal

from django.test import TestCase
from pypdf import PdfReader

from bookings.models import Contact, Quote
from bookings.models.addons import BookingLineItem
from bookings.pdf import _esc, generate_quote_pdf
from events.models import BookingCourse, BookingMeal
from tests.base import get_test_user

BOMB = '</b><font size="72" color="red">PWNED</font><b>'
CRASHERS = ['<br>', '</b>', '<b>bold</b>']


class EscapeHelperTests(TestCase):
    def test_markup_becomes_literal_text(self):
        self.assertEqual(_esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;')
        self.assertEqual(_esc('Smith & Sons'), 'Smith &amp; Sons')

    def test_none_and_empty(self):
        self.assertEqual(_esc(None), '')
        self.assertEqual(_esc(''), '')

    def test_ordinary_text_is_untouched(self):
        self.assertEqual(_esc('Kids under 5 eat free'), 'Kids under 5 eat free')


class PdfSurvivesHostileTextTests(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')

    def _quote(self, **kw):
        q = Quote.objects.create(
            organisation=self.org, primary_contact=self.contact,
            event_date=datetime.date(2026, 9, 1), guest_count=10,
            price_per_head=Decimal('50'), created_by=self.user, **kw,
        )
        q.recalculate_totals()
        return q

    def _render(self, quote):
        data = generate_quote_pdf(quote)
        data = data.getvalue() if hasattr(data, 'getvalue') else data
        return '\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(data)).pages)

    def test_notes_do_not_break_or_style_the_pdf(self):
        text = self._render(self._quote(notes=BOMB))
        # Shown as characters: the tags themselves appear in the extracted text,
        # so reportlab printed them rather than obeying them.
        self.assertIn('<font size="72" color="red">', text)

    def test_venue_address_does_not_break_the_pdf(self):
        self._render(self._quote(venue_address=BOMB))  # must not raise

    def test_a_line_item_description_does_not_break_the_pdf(self):
        q = self._quote()
        BookingLineItem.objects.create(
            quote=q, category='food', description=BOMB,
            quantity=Decimal('1'), unit='each', unit_price=Decimal('10'),
        )
        q.recalculate_totals()
        self._render(q)  # must not raise

    def test_a_meal_label_does_not_break_the_pdf(self):
        q = self._quote()
        BookingMeal.objects.create(
            quote=q, label=BOMB, guest_count=5,
            price_per_head=Decimal('10'), audience='custom',
        )
        q.recalculate_totals()
        text = self._render(q)
        self.assertIn('<font size="72" color="red">', text)

    def test_a_course_name_stays_escaped(self):
        q = self._quote()
        BookingCourse.objects.create(quote=q, name=BOMB, sort_order=0)
        self._render(q)  # REL-417 already covered this; guard the regression

    def test_the_signer_name_on_the_signed_copy_is_escaped(self):
        # Comes from the PUBLIC sign form — the one field an outsider controls.
        from bookings.models.signatures import BookingSignature
        q = self._quote()
        sig = BookingSignature.objects.create(quote=q, signer_name=BOMB)
        data = generate_quote_pdf(q, signature=sig)
        data = data.getvalue() if hasattr(data, 'getvalue') else data
        text = '\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(data)).pages)
        self.assertIn('<font size="72" color="red">', text)

    def test_markup_that_used_to_crash_the_download(self):
        for payload in CRASHERS:
            with self.subTest(payload=payload):
                self._render(self._quote(notes=payload))  # must not raise
