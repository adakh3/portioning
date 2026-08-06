"""A guest breakdown must always account for every guest the booking claims (REL-459).

The bug: `resolve_booking_segments` is count-first, so ANY `BookingGuestCount` row
wins outright and `guest_count` is ignored. A booking of 100 carrying only
"Kids: 20" therefore priced, portioned and printed as **twenty covers** — a £1,000
invoice for a £10,000 event — while the signed function sheet still said 100. The
API returned 200 and nothing warned.

`guest_counts_error` rejected a breakdown LARGER than the count but not a smaller
one, so the only direction that loses money was the unguarded one.

The fix puts the UI's own rule behind the API: the default in-count segment is the
remainder of `guest_count`. These tests pin the money, not just the rows.
"""
import datetime
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user
from events.models import Event, BookingGuestCount, write_booking_segments, resolve_booking_segments
from rules.models import GuestSegment


class GuestBreakdownReconcilesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data", verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        # A clean, explicit segment set: one default in-count, one other in-count,
        # one additional cover. The seeded org's default is "gents", which would make
        # these assertions read as though they were about a gendered split.
        GuestSegment.objects.filter(organisation=self.org).update(is_default=False)
        self.adults = GuestSegment.objects.create(
            organisation=self.org, name="Adults", is_default=True,
            counts_toward_total=True, sort_order=0)
        self.kids = GuestSegment.objects.create(
            organisation=self.org, name="Kids", counts_toward_total=True,
            price_multiplier=Decimal("0.5000"), portion_multiplier=0.6, sort_order=1)
        self.vendors = GuestSegment.objects.create(
            organisation=self.org, name="Vendors", counts_toward_total=False,
            price_multiplier=Decimal("0.4000"), sort_order=9)

    def _event(self, guest_count=100, **kwargs):
        return Event.objects.create(
            organisation=self.org, name="Reconcile", event_date=datetime.date(2026, 12, 1),
            guest_count=guest_count, price_per_head=Decimal("100.00"),
            status="confirmed", **kwargs)

    def _counts(self, event):
        return {r.segment.name: r.count for r in event.guest_counts.all()}

    # ── The money ──────────────────────────────────────────────────────────────

    def test_a_partial_breakdown_still_bills_every_guest(self):
        """THE regression. 100 guests, only "Kids: 20" sent → the other 80 are
        adults at the full rate, not thin air. Was £1,000; must be £9,000
        (80 × £100 + 20 × £50)."""
        e = self._event()
        write_booking_segments(e, [{"segment": "Kids", "count": 20}])
        e.recalculate_totals()
        e.refresh_from_db()
        self.assertEqual(self._counts(e), {"Adults": 80, "Kids": 20})
        self.assertEqual(e.subtotal, Decimal("9000.00"))

    def test_the_kitchen_cooks_for_every_guest_too(self):
        # Same resolver feeds the portioning engine, so an under-covered breakdown
        # under-cooked as well as under-billed.
        e = self._event()
        write_booking_segments(e, [{"segment": "Kids", "count": 20}])
        segments = resolve_booking_segments(e)
        in_count = sum(s["count"] for s in segments if s["counts_toward_total"])
        self.assertEqual(in_count, 100)

    def test_no_breakdown_at_all_is_unchanged(self):
        # An empty breakdown means "no breakdown", NOT "nobody is coming" — the
        # resolver still falls back to the whole guest_count at the base rate.
        e = self._event()
        write_booking_segments(e, [])
        e.recalculate_totals()
        e.refresh_from_db()
        self.assertEqual(self._counts(e), {})
        self.assertEqual(e.subtotal, Decimal("10000.00"))

    # ── The rows ───────────────────────────────────────────────────────────────

    def test_a_complete_breakdown_is_left_exactly_as_sent(self):
        # What the UI sends today. The guard must be a no-op here.
        e = self._event()
        write_booking_segments(e, [
            {"segment": "Adults", "count": 80}, {"segment": "Kids", "count": 20},
        ])
        self.assertEqual(self._counts(e), {"Adults": 80, "Kids": 20})

    def test_a_wrong_default_count_is_corrected_not_trusted(self):
        # The default is derived, so a caller claiming 5 adults on a 100-guest
        # booking with 20 kids gets the real 80 — the number can't be spoofed.
        e = self._event()
        write_booking_segments(e, [
            {"segment": "Adults", "count": 5}, {"segment": "Kids", "count": 20},
        ])
        self.assertEqual(self._counts(e), {"Adults": 80, "Kids": 20})

    def test_a_breakdown_that_uses_every_guest_gets_no_default_row(self):
        e = self._event()
        write_booking_segments(e, [{"segment": "Kids", "count": 100}])
        self.assertEqual(self._counts(e), {"Kids": 100})

    def test_additional_covers_do_not_eat_into_the_remainder(self):
        # Vendors sit OUTSIDE the guest count, so 100 guests + 8 vendors is 100
        # adults and 8 covers — not 92 adults.
        e = self._event()
        write_booking_segments(e, [{"segment": "Vendors", "count": 8}])
        self.assertEqual(self._counts(e), {"Adults": 100, "Vendors": 8})

    def test_re_saving_is_idempotent(self):
        e = self._event()
        for _ in range(3):
            write_booking_segments(e, [{"segment": "Kids", "count": 20}])
        self.assertEqual(self._counts(e), {"Adults": 80, "Kids": 20})

    def test_an_edit_that_drops_a_segment_reflows_from_the_NEW_payload(self):
        """The remainder must come from what this save says, not what the table still
        holds. Deriving it from the rows in the DB — which at that moment still
        include the ones about to be deleted — left 138 adults on a 150-guest booking
        whose kids had just been removed. Caught by an existing quote test."""
        e = self._event(guest_count=150)
        write_booking_segments(e, [
            {"segment": "Kids", "count": 12}, {"segment": "Vendors", "count": 8},
        ])
        self.assertEqual(self._counts(e), {"Adults": 138, "Kids": 12, "Vendors": 8})

        write_booking_segments(e, [{"segment": "Adults", "count": 150}])
        self.assertEqual(self._counts(e), {"Adults": 150})

    def test_lowering_the_guest_count_reflows_the_remainder(self):
        e = self._event()
        write_booking_segments(e, [{"segment": "Kids", "count": 20}])
        e.guest_count = 50
        e.save(update_fields=["guest_count"])
        write_booking_segments(e, [{"segment": "Kids", "count": 20}])
        self.assertEqual(self._counts(e), {"Adults": 30, "Kids": 20})

    # ── Through the real API, and on quotes too ────────────────────────────────

    def test_the_event_api_cannot_be_used_to_under_bill(self):
        e = self._event()
        res = self.client.patch(
            f"/api/events/{e.id}/",
            {"guest_counts": [{"segment": "Kids", "count": 20}]}, format="json")
        self.assertEqual(res.status_code, 200)
        e.refresh_from_db()
        self.assertEqual(self._counts(e), {"Adults": 80, "Kids": 20})
        self.assertEqual(e.subtotal, Decimal("9000.00"))

    def test_quotes_reconcile_the_same_way(self):
        # `resolve_booking_segments` takes quote XOR event, so the hole was identical
        # on the quote — which is the document a client actually signs.
        from bookings.models import Quote, Contact
        q = Quote.objects.create(
            organisation=self.org, event_date=datetime.date(2026, 12, 1),
            guest_count=100, price_per_head=Decimal("100.00"),
            primary_contact=Contact.objects.create(organisation=self.org, name="C"))
        write_booking_segments(q, [{"segment": "Kids", "count": 20}])
        q.recalculate_totals()
        q.refresh_from_db()
        self.assertEqual(
            {r.segment.name: r.count for r in q.guest_counts.all()},
            {"Adults": 80, "Kids": 20})
        self.assertEqual(q.subtotal, Decimal("9000.00"))

    def test_the_documents_agree_on_the_headline_number(self):
        # The bug's visible face: the contract said 100 and the BEO said 20.
        import io
        try:
            from pypdf import PdfReader
        except ImportError:  # pragma: no cover
            self.skipTest("pypdf not installed")
        from bookings.pdf import generate_event_pdf
        from bookings.pdf_beo import generate_beo_pdf

        e = self._event()
        write_booking_segments(e, [{"segment": "Kids", "count": 20}])
        e.recalculate_totals()
        e.refresh_from_db()
        sheet = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(generate_event_pdf(e))).pages)
        beo = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(generate_beo_pdf(e))).pages)
        self.assertIn("100", sheet)
        self.assertIn("Total guests:", beo)
        # Both now describe 100 covers; the BEO breaks them down, the sheet totals them.
        beo_total = beo.split("Total guests:")[1].split()[0]
        self.assertEqual(beo_total, "100")
