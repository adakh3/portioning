"""E-signature (v1): a client views a booking on an unauthenticated tokenised
link and signs once to confirm it. Covers token generation, the customer-safe
public view (never leaks internal notes), signing a quote (which must run the
existing accept→confirmed-event pipeline), signing an event directly, guard
rails, idempotency, and the frozen signed PDF.
"""
import datetime
import io
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import BookingSignature, Quote
from bookings.models.quotes import QuoteStatus
from bookings.tests import _authenticated_client, make_contact, make_quote
from events.models import Event, EventStatus
from tests.base import get_test_org

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover
    HAVE_PYPDF = False


class ESignBackendTests(TestCase):
    def setUp(self):
        self.org = get_test_org()
        self.contact = make_contact(org=self.org, name="Aisha Khan")
        self.staff = _authenticated_client()      # authenticated as the org's user
        self.public = APIClient()                  # unauthenticated client

    def _quote(self, **kwargs):
        q = make_quote(org=self.org, primary_contact=self.contact,
                       price_per_head=Decimal("50"), guest_count=100, **kwargs)
        q.recalculate_totals()
        q.refresh_from_db()
        return q

    # ── staff: send for signature ────────────────────────────────────────────

    def test_send_for_signature_generates_token_and_marks_sent(self):
        q = self._quote(status=QuoteStatus.DRAFT)
        self.assertIsNone(q.public_token)

        resp = self.staff.post(f"/api/bookings/quotes/{q.pk}/send-for-signature/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["public_token"])

        q.refresh_from_db()
        self.assertIsNotNone(q.public_token)
        self.assertEqual(q.status, QuoteStatus.SENT)

    def test_send_for_signature_is_stable(self):
        q = self._quote(status=QuoteStatus.DRAFT)
        first = self.staff.post(f"/api/bookings/quotes/{q.pk}/send-for-signature/").data["public_token"]
        second = self.staff.post(f"/api/bookings/quotes/{q.pk}/send-for-signature/").data["public_token"]
        self.assertEqual(first, second)  # a resend keeps the same link

    # ── public: view ─────────────────────────────────────────────────────────

    def test_public_view_shows_customer_fields_and_hides_internal_notes(self):
        q = self._quote(notes="Thank you for choosing us",
                        internal_notes="SECRET MARGIN 40%")
        token = q.ensure_public_token()

        resp = self.public.get(f"/api/public/bookings/{token}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["customer_name"], "Aisha Khan")
        self.assertEqual(resp.data["kind"], "quote")
        self.assertTrue(resp.data["signable"])
        self.assertIn("Thank you", resp.data["notes"])
        # Internal notes / costs must never appear in the public payload.
        self.assertNotIn("SECRET MARGIN 40%", str(resp.data))

    def test_public_view_unknown_token_is_404(self):
        import uuid
        resp = self.public.get(f"/api/public/bookings/{uuid.uuid4()}/")
        self.assertEqual(resp.status_code, 404)

    # ── public: signing a quote confirms it AND creates the event ────────────

    def test_sign_quote_creates_confirmed_event_and_records_signature(self):
        q = self._quote(status=QuoteStatus.SENT)
        token = q.ensure_public_token()
        agreed_total = q.total

        resp = self.public.post(
            f"/api/public/bookings/{token}/sign/",
            {"signer_name": "Aisha Khan", "consent": True}, format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.data["is_signed"])
        self.assertEqual(resp.data["signer_name"], "Aisha Khan")

        q.refresh_from_db()
        self.assertEqual(q.status, QuoteStatus.ACCEPTED)
        # The accept pipeline must have produced a confirmed event.
        self.assertIsNotNone(q.event)
        self.assertEqual(q.event.status, EventStatus.CONFIRMED)

        sig = BookingSignature.objects.get(quote=q)
        self.assertEqual(sig.signer_name, "Aisha Khan")
        self.assertEqual(sig.agreed_total, agreed_total)   # immutable snapshot
        self.assertIsNotNone(sig.ip_address)               # attribution captured
        self.assertTrue(sig.signed_pdf)                    # frozen document

    def test_sign_requires_name_and_consent(self):
        q = self._quote(status=QuoteStatus.SENT)
        token = q.ensure_public_token()

        no_name = self.public.post(f"/api/public/bookings/{token}/sign/",
                                   {"consent": True}, format="json")
        self.assertEqual(no_name.status_code, 400)

        no_consent = self.public.post(f"/api/public/bookings/{token}/sign/",
                                      {"signer_name": "Aisha"}, format="json")
        self.assertEqual(no_consent.status_code, 400)
        # Nothing was signed or confirmed.
        q.refresh_from_db()
        self.assertEqual(q.status, QuoteStatus.SENT)
        self.assertFalse(BookingSignature.objects.filter(quote=q).exists())

    def test_sign_is_idempotent(self):
        q = self._quote(status=QuoteStatus.SENT)
        token = q.ensure_public_token()
        payload = {"signer_name": "Aisha Khan", "consent": True}

        first = self.public.post(f"/api/public/bookings/{token}/sign/", payload, format="json")
        self.assertEqual(first.status_code, 201)
        second = self.public.post(f"/api/public/bookings/{token}/sign/", payload, format="json")
        self.assertEqual(second.status_code, 200)  # returns state, doesn't re-sign

        self.assertEqual(BookingSignature.objects.filter(quote=q).count(), 1)

    def test_declined_quote_cannot_be_signed(self):
        q = self._quote()
        q.status = QuoteStatus.DECLINED
        q.save(update_fields=["status"])
        token = q.ensure_public_token()

        resp = self.public.post(f"/api/public/bookings/{token}/sign/",
                                {"signer_name": "Aisha", "consent": True}, format="json")
        self.assertEqual(resp.status_code, 409)

    def test_expired_quote_cannot_be_signed(self):
        q = self._quote(status=QuoteStatus.SENT,
                        valid_until=datetime.date(2020, 1, 1))
        token = q.ensure_public_token()

        resp = self.public.post(f"/api/public/bookings/{token}/sign/",
                                {"signer_name": "Aisha", "consent": True}, format="json")
        self.assertEqual(resp.status_code, 409)

    # ── public: signing an event directly (no quote) ─────────────────────────

    def test_sign_event_confirms_it(self):
        event = Event.objects.create(
            organisation=self.org, name="Direct booking", event_date="2026-09-01",
            gents=60, ladies=40, primary_contact=self.contact,
            price_per_head=Decimal("40"), status=EventStatus.TENTATIVE,
        )
        event.recalculate_totals()
        token = event.ensure_public_token()

        resp = self.public.post(
            f"/api/public/bookings/{token}/sign/",
            {"signer_name": "Aisha Khan", "consent": True}, format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["kind"], "event")

        event.refresh_from_db()
        self.assertEqual(event.status, EventStatus.CONFIRMED)
        self.assertTrue(BookingSignature.objects.filter(event=event).exists())

    # ── public: signed PDF ───────────────────────────────────────────────────

    def test_signed_pdf_is_downloadable(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        q = self._quote(status=QuoteStatus.SENT, internal_notes="SECRET MARGIN 40%")
        token = q.ensure_public_token()
        self.public.post(f"/api/public/bookings/{token}/sign/",
                         {"signer_name": "Aisha Khan", "consent": True}, format="json")

        resp = self.public.get(f"/api/public/bookings/{token}/pdf/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/pdf")

        text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(resp.content)).pages)
        self.assertNotIn("SECRET MARGIN 40%", text)  # internal notes never leak
