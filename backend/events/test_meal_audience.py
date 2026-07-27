"""REL-426 — additional meals select their audience and derive their guest count.

A meal's ``audience`` (everyone / guests only / a single segment / custom) derives
``guest_count`` from the booking's segments and dual-writes it on recalculate, so
totals/PDFs/sign page keep reading ``guest_count``. ``custom`` keeps the typed number.
Existing meals backfill to ``custom`` (zero behaviour change). Covers AC2–AC8.
"""
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user
from events.models import (
    Event, BookingGuestCount, BookingMeal, MealAudience,
    derive_meal_guest_count, sync_audience_meal_counts,
)
from bookings.models import Quote, Contact
from bookings.views.quotes import _copy_additional_meals_to_event
from rules.models import GuestSegment


class _UsSegmentsMixin:
    """A mainstream US org: Adults (default, in-count) / Kids (in-count) / Vendors
    (additional covers). Replaces the seed org's default segments so resolution is
    deterministic."""
    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.org.guest_segments.all().delete()
        self.adults = self._seg('Adults', default=True, order=0)
        self.kids = self._seg('Kids', mult=0.6, order=1)
        self.vendors = self._seg('Vendors', counts=False, order=2)

    def _seg(self, name, mult=1.0, counts=True, default=False, order=0):
        return GuestSegment.objects.create(
            organisation=self.org, name=name, portion_multiplier=mult,
            counts_toward_total=counts, is_default=default, sort_order=order,
        )

    def _event(self, guest_count, breakdown=None, meals=None):
        ev = Event.objects.create(organisation=self.org, name='E', event_date='2026-05-01',
                                  guest_count=guest_count, price_per_head=Decimal('10'))
        for seg, count in (breakdown or {}).items():
            BookingGuestCount.objects.create(event=ev, segment=seg, count=count)
        for m in (meals or []):
            BookingMeal.objects.create(event=ev, **m)
        return ev


class DerivationTests(_UsSegmentsMixin, TestCase):
    def _segments(self, ev):
        from events.models import resolve_booking_segments
        return resolve_booking_segments(ev)

    def test_everyone_is_guests_plus_extra_covers(self):
        # 138 adults + 12 kids (=150 guests) + 8 vendors = 158 covers.
        ev = self._event(150, {self.adults: 138, self.kids: 12, self.vendors: 8})
        meal = BookingMeal(event=ev, audience=MealAudience.EVERYONE)
        self.assertEqual(derive_meal_guest_count(meal, self._segments(ev)), 158)

    def test_guests_only_excludes_extra_covers(self):
        ev = self._event(150, {self.adults: 138, self.kids: 12, self.vendors: 8})
        meal = BookingMeal(event=ev, audience=MealAudience.GUESTS)
        self.assertEqual(derive_meal_guest_count(meal, self._segments(ev)), 150)

    def test_single_segment_is_that_segments_count(self):
        ev = self._event(150, {self.adults: 138, self.kids: 12, self.vendors: 8})
        meal = BookingMeal(event=ev, audience=MealAudience.SEGMENT, audience_segment=self.vendors)
        self.assertEqual(derive_meal_guest_count(meal, self._segments(ev)), 8)

    def test_segment_not_in_the_mix_serves_zero(self):
        ev = self._event(150, {self.adults: 150})  # no vendors entered
        meal = BookingMeal(event=ev, audience=MealAudience.SEGMENT, audience_segment=self.vendors)
        self.assertEqual(derive_meal_guest_count(meal, self._segments(ev)), 0)

    def test_custom_returns_none_so_the_typed_count_stands(self):
        ev = self._event(150, {self.adults: 150})
        meal = BookingMeal(event=ev, audience=MealAudience.CUSTOM, guest_count=42)
        self.assertIsNone(derive_meal_guest_count(meal, self._segments(ev)))

    def test_everyone_with_no_breakdown_is_the_bare_guest_count(self):
        ev = self._event(150)  # count only, no segment rows
        meal = BookingMeal(event=ev, audience=MealAudience.EVERYONE)
        self.assertEqual(derive_meal_guest_count(meal, self._segments(ev)), 150)


class SyncAndTotalsTests(_UsSegmentsMixin, TestCase):
    def test_recalculate_dual_writes_derived_counts(self):
        ev = self._event(
            150, {self.adults: 138, self.kids: 12, self.vendors: 8},
            meals=[
                {'label': 'Dinner', 'audience': MealAudience.EVERYONE, 'price_per_head': Decimal('20'), 'guest_count': 0},
                {'label': 'Crew meal', 'audience': MealAudience.SEGMENT, 'audience_segment': self.vendors, 'price_per_head': Decimal('5'), 'guest_count': 0},
                {'label': 'Bar', 'audience': MealAudience.CUSTOM, 'price_per_head': Decimal('3'), 'guest_count': 25},
            ],
        )
        ev.recalculate_totals()
        counts = {m.label: m.guest_count for m in ev.additional_meals.all()}
        self.assertEqual(counts, {'Dinner': 158, 'Crew meal': 8, 'Bar': 25})

    def test_food_total_uses_the_derived_meal_counts(self):
        ev = self._event(
            150, {self.adults: 150},
            meals=[{'label': 'Dinner', 'audience': MealAudience.EVERYONE, 'price_per_head': Decimal('20'), 'guest_count': 0}],
        )
        ev.recalculate_totals()
        # main food 10×150 = 1500; meal 20×150 (everyone, no extra covers) = 3000.
        self.assertEqual(ev.food_total, Decimal('4500.00'))

    def test_derived_count_follows_a_finals_change(self):
        # AC3: the number moves with the booking's guests, including at finals.
        ev = self._event(
            150, {self.adults: 150},
            meals=[{'label': 'Dinner', 'audience': MealAudience.GUESTS, 'price_per_head': Decimal('20'), 'guest_count': 0}],
        )
        ev.recalculate_totals()
        self.assertEqual(ev.additional_meals.get().guest_count, 150)
        # Guarantee moves 150 -> 163.
        ev.guest_count = 163
        BookingGuestCount.objects.filter(event=ev, segment=self.adults).update(count=163)
        ev.recalculate_totals()
        self.assertEqual(ev.additional_meals.get().guest_count, 163)

    def test_custom_meal_is_left_exactly_as_typed(self):
        ev = self._event(
            150, {self.adults: 150},
            meals=[{'label': 'Bar', 'audience': MealAudience.CUSTOM, 'price_per_head': Decimal('3'), 'guest_count': 25}],
        )
        ev.recalculate_totals()
        self.assertEqual(ev.additional_meals.get().guest_count, 25)


class BackfillAndConversionTests(_UsSegmentsMixin, TestCase):
    def test_new_meal_defaults_to_custom_keeping_its_number(self):
        # AC5: a meal created without an audience (existing-row shape) is 'custom'.
        ev = self._event(150, {self.adults: 150})
        meal = BookingMeal.objects.create(event=ev, label='Legacy', guest_count=90, price_per_head=Decimal('7'))
        self.assertEqual(meal.audience, MealAudience.CUSTOM)
        ev.recalculate_totals()
        meal.refresh_from_db()
        self.assertEqual(meal.guest_count, 90)  # unchanged

    def test_conversion_preserves_audience(self):
        # AC7: audience + segment survive quote -> event conversion.
        contact = Contact.objects.create(organisation=self.org, name='Client')
        quote = Quote.objects.create(organisation=self.org, primary_contact=contact,
                                     event_date='2026-05-01', guest_count=150)
        BookingMeal.objects.create(
            quote=quote, label='Crew', audience=MealAudience.SEGMENT,
            audience_segment=self.vendors, guest_count=8, price_per_head=Decimal('5'),
        )
        event = Event.objects.create(organisation=self.org, name='E', event_date='2026-05-01', guest_count=150)
        _copy_additional_meals_to_event(quote, event)
        copied = event.additional_meals.get()
        self.assertEqual(copied.audience, MealAudience.SEGMENT)
        self.assertEqual(copied.audience_segment, self.vendors)


class MealAudienceApiTests(_UsSegmentsMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_persists_audience_and_derives_the_count(self):
        # AC2/AC3/AC6: post a meal by segment NAME; it reads back with a derived count.
        payload = {
            'name': 'Gala', 'date': '2026-05-01', 'guest_count': 150,
            # Full breakdown as the frontend sends it — including the default
            # (Adults) remainder row, so every cover is represented.
            'guest_counts': [
                {'segment': 'Adults', 'count': 138},
                {'segment': 'Kids', 'count': 12},
                {'segment': 'Vendors', 'count': 8},
            ],
            'additional_meals': [
                {'label': 'Crew meal', 'audience': 'segment', 'audience_segment': 'Vendors',
                 'price_per_head': '5.00'},
                {'label': 'Dinner', 'audience': 'everyone', 'price_per_head': '20.00'},
            ],
        }
        res = self.client.post('/api/events/', payload, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        meals = {m['label']: m for m in res.json()['additional_meals']}
        self.assertEqual(meals['Crew meal']['audience'], 'segment')
        self.assertEqual(meals['Crew meal']['audience_segment'], 'Vendors')
        self.assertEqual(meals['Crew meal']['guest_count'], 8)
        self.assertEqual(meals['Dinner']['guest_count'], 158)  # 138 adults + 12 kids + 8 vendors

    def test_editing_the_guest_count_reflows_a_derived_meal(self):
        # AC6: change the booking's guests, the audience-scoped meal follows on reload.
        ev_id = self.client.post('/api/events/', {
            'name': 'G', 'date': '2026-05-01', 'guest_count': 150,
            'additional_meals': [{'label': 'Dinner', 'audience': 'everyone', 'price_per_head': '20.00'}],
        }, format='json').json()['id']
        res = self.client.patch(f'/api/events/{ev_id}/', {'guest_count': 200}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['additional_meals'][0]['guest_count'], 200)


class GentsLadiesDataDrivenTests(TestCase):
    """AC8: a Gents/Ladies (GB/PK) org sees ITS segments in the audience — one code
    path, behaviour from segment data, not an org type."""
    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.gents = GuestSegment.objects.get(organisation=self.org, name='gents')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_segment_audience_uses_the_orgs_own_segments(self):
        res = self.client.post('/api/events/', {
            'name': 'Mehndi', 'date': '2026-05-01', 'guest_count': 100, 'gents': 60, 'ladies': 40,
            'additional_meals': [{'label': 'Gents lunch', 'audience': 'segment',
                                  'audience_segment': 'gents', 'price_per_head': '8.00'}],
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        meal = res.json()['additional_meals'][0]
        self.assertEqual(meal['audience_segment'], 'gents')
        self.assertEqual(meal['guest_count'], 60)
