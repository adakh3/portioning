"""Stage 1 of the general guest-segmentation model: GuestSegment (per-org named
segments with portion + price multipliers) and BookingGuestCount (per-booking
counts, quote XOR event). 'gents'/'ladies' are now just ordinary segment names."""
from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase

from users.models import Organisation
from rules.models import GuestSegment
from events.models import Event, BookingGuestCount


class GuestSegmentModelTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="Seg Co", slug="seg-co", country="US")

    def test_segment_carries_portion_and_price_multipliers(self):
        kids = GuestSegment.objects.create(
            organisation=self.org, name="Kids",
            portion_multiplier=0.6, price_multiplier=Decimal("0.5000"),
        )
        self.assertEqual(kids.portion_multiplier, 0.6)
        self.assertEqual(kids.price_multiplier, Decimal("0.5000"))
        # defaults for a plain adult segment
        adults = GuestSegment.objects.create(organisation=self.org, name="Adults", is_default=True)
        self.assertEqual(adults.portion_multiplier, 1.0)
        self.assertEqual(adults.price_multiplier, Decimal("1.0000"))

    def test_name_unique_per_org(self):
        GuestSegment.objects.create(organisation=self.org, name="Adults")
        other = Organisation.objects.create(name="Other", slug="other", country="US")
        # same name in another org is fine
        GuestSegment.objects.create(organisation=other, name="Adults")
        with self.assertRaises(IntegrityError):
            GuestSegment.objects.create(organisation=self.org, name="Adults")


class BookingGuestCountTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="Seg Co", slug="seg-co", country="US")
        self.adults = GuestSegment.objects.create(organisation=self.org, name="Adults", is_default=True)
        self.event = Event.objects.create(name="Gala", organisation=self.org, event_date=date(2026, 8, 1))

    def test_count_attaches_to_event(self):
        gc = BookingGuestCount.objects.create(event=self.event, segment=self.adults, count=120)
        self.assertEqual(self.event.guest_counts.get().count, 120)
        self.assertEqual(str(gc), "120 × Adults")

    def test_requires_exactly_one_parent(self):
        # neither quote nor event → violates the XOR check constraint
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                BookingGuestCount.objects.create(segment=self.adults, count=10)

    def test_one_row_per_segment_per_event(self):
        BookingGuestCount.objects.create(event=self.event, segment=self.adults, count=100)
        with self.assertRaises(IntegrityError):
            BookingGuestCount.objects.create(event=self.event, segment=self.adults, count=50)
