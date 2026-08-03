"""REL-419 — entrée choices at proposal + the finals lifecycle.

Two phases on one set of per-dish rows: an *offered* flag chosen at proposal (priced
per head whoever picks what, never validated), and the per-entrée tallies that land
weeks later with the final guarantee, in the finals panel — the only place the two
are checked against each other. "Awaiting finals" is derived, never stored.

Traces AC1–AC11.
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from tests.base import get_test_user
from bookings.models import Quote, Contact
from events.models import (
    Event, EventDishComment, QuoteDishComment,
    finals_status, read_menu_choices, write_menu_choices, write_booking_courses,
)

# Events must sit in the future: the list/detail views auto-advance a past confirmed
# event to in_progress/completed, which would erase the derived finals state.
FUTURE_DATE = (timezone.now().date() + timedelta(days=120)).isoformat()


class MenuChoiceModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.d1, self.d2, self.d3 = list(Dish.objects.filter(organisation=self.org)[:3])
        self.event = Event.objects.create(organisation=self.org, name='E', event_date=FUTURE_DATE)
        self.event.dishes.set([self.d1, self.d2, self.d3])

    def test_flags_offered_dishes_with_no_count(self):  # AC1
        write_menu_choices(self.event, {str(self.d1.id): None, str(self.d2.id): None})
        rows = {r.dish_id: r for r in self.event.dish_comments.all()}
        self.assertTrue(rows[self.d1.id].is_choice)
        self.assertTrue(rows[self.d2.id].is_choice)
        self.assertIsNone(rows[self.d1.id].choice_count)
        self.assertIsNone(rows[self.d2.id].choice_count)

    def test_read_round_trips_what_write_accepts(self):
        write_menu_choices(self.event, {str(self.d1.id): 90, str(self.d2.id): None})
        self.assertEqual(
            read_menu_choices(self.event), {str(self.d1.id): 90, str(self.d2.id): None},
        )

    def test_unflagging_clears_the_flag_and_its_count(self):
        write_menu_choices(self.event, {str(self.d1.id): 40})
        write_menu_choices(self.event, {})
        row = EventDishComment.objects.get(event=self.event, dish=self.d1)
        self.assertFalse(row.is_choice)
        self.assertIsNone(row.choice_count)

    def test_ignores_a_dish_not_on_the_booking(self):
        self.event.dishes.set([self.d1])
        write_menu_choices(self.event, {str(self.d1.id): None, str(self.d3.id): None})
        self.assertFalse(EventDishComment.objects.filter(event=self.event, dish=self.d3).exists())

    def test_choices_do_not_disturb_course_assignment(self):
        write_booking_courses(self.event, [{'name': 'Entrée', 'sort_order': 0}],
                              {str(self.d1.id): 0})
        write_menu_choices(self.event, {str(self.d1.id): None})
        row = EventDishComment.objects.get(event=self.event, dish=self.d1)
        self.assertEqual(row.course.name, 'Entrée')
        self.assertTrue(row.is_choice)

    def test_works_the_same_on_a_quote(self):  # AC1 (quote mirror)
        contact = Contact.objects.create(organisation=self.org, name='C')
        quote = Quote.objects.create(organisation=self.org, primary_contact=contact,
                                     event_date=FUTURE_DATE, guest_count=50)
        quote.dishes.set([self.d1, self.d2])
        write_menu_choices(quote, {str(self.d1.id): None})
        row = QuoteDishComment.objects.get(quote=quote, dish=self.d1)
        self.assertTrue(row.is_choice)
        self.assertIsNone(row.choice_count)


class FinalsStatusTests(TestCase):
    """AC10 — derived from (confirmed + final_count vs final_count_due), never stored."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.today = timezone.localdate()

    def _event(self, **kwargs):
        return Event.objects.create(
            organisation=self.org, name='E', event_date=FUTURE_DATE, **kwargs,
        )

    def test_no_status_before_the_booking_is_confirmed(self):
        ev = self._event(status='tentative', final_count_due=self.today)
        self.assertIsNone(finals_status(ev))

    def test_no_status_when_no_due_date_is_set(self):
        ev = self._event(status='confirmed')
        self.assertIsNone(finals_status(ev))

    def test_due_soon_inside_the_fortnight(self):  # AC4
        ev = self._event(status='confirmed', final_count_due=self.today + timedelta(days=10))
        self.assertEqual(finals_status(ev), 'due_soon')

    def test_awaiting_while_the_due_date_is_far_off(self):
        ev = self._event(status='confirmed', final_count_due=self.today + timedelta(days=60))
        self.assertEqual(finals_status(ev), 'awaiting')

    def test_overdue_once_the_due_date_has_passed(self):  # AC5
        ev = self._event(status='confirmed', final_count_due=self.today - timedelta(days=1))
        self.assertEqual(finals_status(ev), 'overdue')

    def test_recorded_wins_even_when_overdue(self):  # AC6
        ev = self._event(status='confirmed', final_count=150,
                         final_count_due=self.today - timedelta(days=30))
        self.assertEqual(finals_status(ev), 'recorded')

    def test_boundary_days_are_stable(self):
        due_today = self._event(status='confirmed', final_count_due=self.today)
        self.assertEqual(finals_status(due_today), 'due_soon')
        edge = self._event(status='confirmed', final_count_due=self.today + timedelta(days=14))
        self.assertEqual(finals_status(edge), 'due_soon')
        just_outside = self._event(status='confirmed', final_count_due=self.today + timedelta(days=15))
        self.assertEqual(finals_status(just_outside), 'awaiting')

    def test_no_stored_status_column_exists(self):  # AC10
        columns = {f.name for f in Event._meta.get_fields() if hasattr(f, 'attname')}
        self.assertNotIn('finals_status', columns)
        # …and the property still answers.
        self.assertIsNone(self._event(status='tentative').finals_status)


class MenuChoiceApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.d1, self.d2 = list(Dish.objects.filter(organisation=self.org)[:2])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.contact = Contact.objects.create(organisation=self.org, name='C')

    def _create_quote(self, **extra):
        payload = {
            'primary_contact': self.contact.id, 'event_date': FUTURE_DATE,
            'guest_count': 50, 'price_per_head': '40.00', 'service_style': 'plated',
            'dish_ids': [self.d1.id, self.d2.id],
        }
        payload.update(extra)
        res = self.client.post('/api/bookings/quotes/', payload, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def test_quote_saves_offered_choices_with_null_counts(self):  # AC1, AC2, AC8
        body = self._create_quote(
            menu_choices={str(self.d1.id): None, str(self.d2.id): None},
        )
        self.assertEqual(
            body['menu_choices'], {str(self.d1.id): None, str(self.d2.id): None},
        )
        # Reload independently — no validation fired, the flags persisted (AC11).
        got = self.client.get(f"/api/bookings/quotes/{body['id']}/").json()
        self.assertEqual(got['menu_choices'], {str(self.d1.id): None, str(self.d2.id): None})

    def test_quote_never_validates_a_sum(self):  # AC8
        # Guest count 50 but only two offerings and no counts: still a clean save.
        body = self._create_quote(menu_choices={str(self.d1.id): None})
        res = self.client.patch(
            f"/api/bookings/quotes/{body['id']}/",
            {'menu_choices': {str(self.d1.id): None, str(self.d2.id): None}},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)

    def test_quote_patch_without_the_key_preserves_choices(self):
        body = self._create_quote(menu_choices={str(self.d1.id): None})
        res = self.client.patch(
            f"/api/bookings/quotes/{body['id']}/", {'guest_count': 60}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['menu_choices'], {str(self.d1.id): None})

    def test_event_saves_offered_choices_and_exposes_finals_status(self):  # AC1 (event mirror)
        res = self.client.post('/api/events/', {
            'name': 'Gala', 'date': FUTURE_DATE, 'guest_count': 50,
            'service_style': 'plated', 'dish_ids': [self.d1.id, self.d2.id],
            'menu_choices': {str(self.d1.id): None, str(self.d2.id): None},
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(
            res.json()['menu_choices'], {str(self.d1.id): None, str(self.d2.id): None},
        )
        self.assertIsNone(res.json()['finals_status'])  # tentative → nothing to chase

    def test_event_list_carries_finals_status_for_the_pill(self):  # AC4/AC5 (list surface)
        due = timezone.localdate() - timedelta(days=2)
        ev = Event.objects.create(organisation=self.org, name='Overdue', event_date=FUTURE_DATE,
                                  status='confirmed', final_count_due=due)
        rows = self.client.get('/api/events/').json()
        rows = rows['results'] if isinstance(rows, dict) else rows
        row = next(r for r in rows if r['id'] == ev.id)
        self.assertEqual(row['finals_status'], 'overdue')
        self.assertEqual(row['final_count_due'], due.isoformat())

    def test_an_ordinary_event_save_does_not_wipe_flags_or_tallies(self):
        """The conversion-data-loss trap, on the edit path: the event form PATCHes
        dish_comments (portions/comments), which replaces every row."""
        ev_id = self.client.post('/api/events/', {
            'name': 'Gala', 'date': FUTURE_DATE, 'guest_count': 50,
            'service_style': 'plated', 'dish_ids': [self.d1.id, self.d2.id],
            'menu_choices': {str(self.d1.id): None, str(self.d2.id): None},
        }, format='json').json()['id']
        EventDishComment.objects.filter(event_id=ev_id, dish=self.d1).update(choice_count=30)

        res = self.client.patch(f'/api/events/{ev_id}/', {
            'dish_comments': [
                {'dish_id': self.d1.id, 'comment': 'no nuts', 'portion_grams': 120},
                {'dish_id': self.d2.id, 'comment': '', 'portion_grams': 100},
            ],
        }, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['menu_choices'], {str(self.d1.id): 30, str(self.d2.id): None})

    def test_choices_survive_quote_to_event_acceptance(self):  # AC3
        from bookings.services.quote_acceptance import accept_quote
        quote = Quote.objects.create(organisation=self.org, primary_contact=self.contact,
                                     event_date=FUTURE_DATE, guest_count=50,
                                     service_style='plated')
        quote.dishes.set([self.d1, self.d2])
        write_menu_choices(quote, {str(self.d1.id): None, str(self.d2.id): None})

        event = accept_quote(quote)

        self.assertEqual(
            read_menu_choices(event), {str(self.d1.id): None, str(self.d2.id): None},
        )
        # The portion rows the conversion creates are still intact alongside the flags.
        self.assertTrue(
            EventDishComment.objects.filter(event=event, dish=self.d1)
            .exclude(portion_grams=None).exists()
        )

    def test_a_booking_with_no_choices_is_unchanged(self):  # existing-row rule
        body = self._create_quote()
        self.assertEqual(body['menu_choices'], {})
        ev = self.client.post('/api/events/', {
            'name': 'Plain', 'date': FUTURE_DATE, 'guest_count': 50,
            'dish_ids': [self.d1.id],
        }, format='json').json()
        self.assertEqual(ev['menu_choices'], {})
        self.assertIsNone(ev['finals_status'])


class FinalsPanelApiTests(TestCase):
    """AC6, AC7, AC9 — the finals endpoint is the one place the sum is enforced."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.d1, self.d2 = list(Dish.objects.filter(organisation=self.org)[:2])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.event = Event.objects.create(
            organisation=self.org, name='Gala', event_date=FUTURE_DATE,
            guest_count=150, price_per_head=Decimal('40.00'), status='confirmed',
            service_style='plated',
            final_count_due=timezone.localdate() + timedelta(days=7),
        )
        self.event.dishes.set([self.d1, self.d2])
        self.event.recalculate_totals()
        # A choice belongs to a course (AC1 rule 1) — without one there is no group
        # for the finals sum to check against.
        write_booking_courses(self.event, [{'name': 'Entrée', 'sort_order': 0}], {
            str(self.d1.id): 0, str(self.d2.id): 0,
        })
        write_menu_choices(self.event, {str(self.d1.id): None, str(self.d2.id): None})

    def _post(self, **data):
        return self.client.post(f'/api/events/{self.event.id}/finals/', data, format='json')

    def test_one_save_records_everything_and_flips_the_pill(self):  # AC6
        res = self._post(
            final_count=150, guaranteed_count=140,
            final_count_due=str(timezone.localdate() + timedelta(days=3)),
            choice_counts={str(self.d1.id): 90, str(self.d2.id): 60},
        )
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body['final_count'], 150)
        self.assertEqual(body['guaranteed_count'], 140)
        self.assertEqual(body['menu_choices'], {str(self.d1.id): 90, str(self.d2.id): 60})
        self.assertEqual(body['finals_status'], 'recorded')
        # …and it is really stored (AC11).
        self.event.refresh_from_db()
        self.assertEqual(self.event.final_count, 150)

    def test_tallies_that_miss_the_guarantee_are_rejected(self):  # AC7
        res = self._post(final_count=150,
                         choice_counts={str(self.d1.id): 90, str(self.d2.id): 55})
        self.assertEqual(res.status_code, 400)
        self.assertIn('add up to the final guarantee', str(res.json()))
        self.event.refresh_from_db()
        self.assertIsNone(self.event.final_count)  # nothing was written

    def test_a_missing_tally_counts_as_zero_and_fails_the_sum(self):  # AC7
        res = self._post(final_count=150, choice_counts={str(self.d1.id): 150 - 10})
        self.assertEqual(res.status_code, 400)

    def test_a_tally_for_a_dish_that_is_not_offered_is_rejected(self):
        other = self.d2
        write_menu_choices(self.event, {str(self.d1.id): None})
        res = self._post(final_count=150, choice_counts={str(self.d1.id): 150,
                                                         str(other.id): 0})
        self.assertEqual(res.status_code, 400)

    def test_an_event_with_no_offerings_records_the_guarantee_alone(self):
        write_menu_choices(self.event, {})
        res = self._post(final_count=150)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['final_count'], 150)

    def test_recording_tallies_never_moves_the_money(self):  # AC9
        before = (self.event.subtotal, self.event.tax_amount, self.event.total)
        res = self._post(final_count=150,
                         choice_counts={str(self.d1.id): 90, str(self.d2.id): 60})
        self.assertEqual(res.status_code, 200, res.content)
        self.event.refresh_from_db()
        self.assertEqual((self.event.subtotal, self.event.tax_amount, self.event.total), before)
        body = res.json()
        self.assertEqual(Decimal(body['total']), before[2])

    def test_another_orgs_event_is_not_reachable(self):
        from users.models import Organisation
        other_org = Organisation.objects.create(name='Other Co', slug='other-co')
        foreign = Event.objects.create(organisation=other_org, name='X',
                                       event_date=FUTURE_DATE, status='confirmed')
        res = self.client.post(f'/api/events/{foreign.id}/finals/',
                               {'final_count': 10}, format='json')
        self.assertEqual(res.status_code, 404)


class FinalsRegressionTests(TestCase):
    """The defects an adversarial review of the first cut turned up. Each test is
    named for the way the data was actually lost or corrupted."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.d1, self.d2 = list(Dish.objects.filter(organisation=self.org)[:2])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.event = Event.objects.create(
            organisation=self.org, name='Gala', event_date=FUTURE_DATE,
            guest_count=50, status='confirmed', service_style='plated',
        )
        self.event.dishes.set([self.d1, self.d2])
        write_menu_choices(self.event, {str(self.d1.id): None, str(self.d2.id): None})

    def _record_finals(self):
        res = self.client.post(f'/api/events/{self.event.id}/finals/', {
            'final_count': 50,
            'choice_counts': {str(self.d1.id): 30, str(self.d2.id): 20},
        }, format='json')
        self.assertEqual(res.status_code, 200, res.content)

    def test_a_partial_dish_comments_save_keeps_an_omitted_offering(self):
        """The kitchen page only sends rows that HAVE a portion. Replacing the rows
        with just those would delete an offered entrée and its recorded tally."""
        self._record_finals()
        res = self.client.patch(f'/api/events/{self.event.id}/', {
            'dish_comments': [{'dish_id': self.d1.id, 'comment': '', 'portion_grams': 120}],
        }, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(
            res.json()['menu_choices'], {str(self.d1.id): 30, str(self.d2.id): 20},
        )

    def test_an_ordinary_patch_cannot_write_the_finals_numbers(self):
        """Otherwise the sum check is bypassed, and a stale event form can blank a
        guarantee that was recorded while it was open."""
        self._record_finals()
        res = self.client.patch(f'/api/events/{self.event.id}/', {
            'final_count': 999, 'guaranteed_count': 1, 'final_count_due': '2026-01-01',
        }, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.event.refresh_from_db()
        self.assertEqual(self.event.final_count, 50)     # unchanged
        self.assertIsNone(self.event.guaranteed_count)
        self.assertIsNone(self.event.final_count_due)

    def test_recorded_numbers_stay_visible_once_the_event_is_under_way(self):
        """An event auto-advances to in_progress on its own day — the day the kitchen
        reads the breakdown. Gating on `confirmed` alone hid it exactly then."""
        self._record_finals()
        for status in ('in_progress', 'completed'):
            Event.objects.filter(pk=self.event.pk).update(status=status)
            self.event.refresh_from_db()
            self.assertEqual(finals_status(self.event), 'recorded', status)

    def test_chasing_stops_once_the_event_is_under_way(self):
        Event.objects.filter(pk=self.event.pk).update(
            status='in_progress', final_count_due=timezone.localdate() - timedelta(days=1),
        )
        self.event.refresh_from_db()
        self.assertIsNone(finals_status(self.event))  # nothing left to ask for on the day

    def test_a_cancelled_booking_has_no_finals_state(self):
        Event.objects.filter(pk=self.event.pk).update(status='cancelled', final_count=50)
        self.event.refresh_from_db()
        self.assertIsNone(finals_status(self.event))

    def test_malformed_menu_choices_are_rejected_not_a_500(self):
        for bad in ({'abc': None}, {str(self.d1.id): 'lots'}, ['x'], {str(self.d1.id): -3}):
            res = self.client.patch(f'/api/events/{self.event.id}/',
                                    {'menu_choices': bad}, format='json')
            self.assertEqual(res.status_code, 400, f'{bad} → {res.status_code}')

    def test_a_null_menu_choices_leaves_the_offerings_alone(self):
        """A client that serialises absent optional fields as null must not wipe them."""
        res = self.client.patch(f'/api/events/{self.event.id}/',
                                {'menu_choices': None}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(
            res.json()['menu_choices'], {str(self.d1.id): None, str(self.d2.id): None},
        )

    def test_an_empty_map_still_clears_the_offerings(self):
        res = self.client.patch(f'/api/events/{self.event.id}/',
                                {'menu_choices': {}}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['menu_choices'], {})

    def test_a_malformed_tally_key_is_rejected_not_a_500(self):
        res = self.client.post(f'/api/events/{self.event.id}/finals/', {
            'final_count': 50, 'choice_counts': {'abc': 5},
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_finals_cannot_be_recorded_before_the_booking_is_confirmed(self):
        Event.objects.filter(pk=self.event.pk).update(status='tentative')
        res = self.client.post(f'/api/events/{self.event.id}/finals/',
                               {'final_count': 50,
                                'choice_counts': {str(self.d1.id): 30, str(self.d2.id): 20}},
                               format='json')
        self.assertEqual(res.status_code, 400)
        self.event.refresh_from_db()
        self.assertIsNone(self.event.final_count)

    def test_a_quote_never_stores_a_tally_so_none_can_reach_the_event(self):
        """A count on a quote would ride the conversion onto the event and show as a
        recorded breakdown against no guarantee."""
        contact = Contact.objects.create(organisation=self.org, name='C')
        quote = Quote.objects.create(organisation=self.org, primary_contact=contact,
                                     event_date=FUTURE_DATE, guest_count=50)
        quote.dishes.set([self.d1])
        res = self.client.patch(f'/api/bookings/quotes/{quote.id}/',
                                {'menu_choices': {str(self.d1.id): 7}}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['menu_choices'], {str(self.d1.id): None})
        self.assertIsNone(
            QuoteDishComment.objects.get(quote=quote, dish=self.d1).choice_count,
        )


class PerCourseChoiceTests(TestCase):
    """A choice belongs to a course, and every guest picks one dish from each course
    that offers one — so each course's tallies must add up to the guarantee on their
    own. Summing them together would demand 300 covers from a 150-guest booking that
    offers a choice of main AND of dessert."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.beef, self.salmon, self.brownie, self.cake = list(
            Dish.objects.filter(organisation=self.org)[:4]
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.event = Event.objects.create(
            organisation=self.org, name='Gala', event_date=FUTURE_DATE,
            guest_count=150, status='confirmed', service_style='plated',
        )
        self.event.dishes.set([self.beef, self.salmon, self.brownie, self.cake])
        write_booking_courses(self.event, [
            {'name': 'Entrée', 'sort_order': 0},
            {'name': 'Dessert', 'sort_order': 1},
        ], {
            str(self.beef.id): 0, str(self.salmon.id): 0,
            str(self.brownie.id): 1, str(self.cake.id): 1,
        })
        write_menu_choices(self.event, {
            str(self.beef.id): None, str(self.salmon.id): None,
            str(self.brownie.id): None, str(self.cake.id): None,
        })

    def _post(self, counts):
        return self.client.post(f'/api/events/{self.event.id}/finals/', {
            'final_count': 150,
            'choice_counts': {str(k): v for k, v in counts.items()},
        }, format='json')

    def test_groups_the_choices_by_course_in_course_order(self):
        from events.models import choice_groups
        groups = choice_groups(self.event)
        self.assertEqual([g['course_name'] for g in groups], ['Entrée', 'Dessert'])
        self.assertEqual(groups[0]['dish_ids'], sorted([self.beef.id, self.salmon.id]))
        self.assertEqual(groups[1]['dish_ids'], sorted([self.brownie.id, self.cake.id]))

    def test_each_course_adds_up_to_the_guarantee_separately(self):  # AC7
        res = self._post({
            self.beef.id: 90, self.salmon.id: 60,      # Entrée = 150
            self.brownie.id: 100, self.cake.id: 50,    # Dessert = 150
        })
        self.assertEqual(res.status_code, 200, res.content)
        # NOT 300 vs 150 — the old global sum would have rejected this.
        self.assertEqual(res.json()['final_count'], 150)

    def test_only_the_wrong_course_is_named_in_the_error(self):
        res = self._post({
            self.beef.id: 90, self.salmon.id: 60,      # Entrée fine
            self.brownie.id: 100, self.cake.id: 30,    # Dessert = 130
        })
        self.assertEqual(res.status_code, 400)
        body = str(res.json())
        self.assertIn('Dessert choices must add up', body)
        self.assertIn('130', body)
        self.assertNotIn('Entrée choices must add up', body)

    def test_a_course_left_entirely_blank_blocks_the_save(self):
        """Ticking a dish as offered is a commitment to collecting its numbers."""
        res = self._post({self.beef.id: 90, self.salmon.id: 60})  # dessert untouched
        self.assertEqual(res.status_code, 400)
        self.assertIn('Dessert choices must add up', str(res.json()))
        self.event.refresh_from_db()
        self.assertIsNone(self.event.final_count)

    def test_unticking_that_course_unblocks_it(self):
        """…and the escape hatch is the tick, not a half-filled panel."""
        write_menu_choices(self.event, {
            str(self.beef.id): None, str(self.salmon.id): None,
        })
        res = self._post({self.beef.id: 90, self.salmon.id: 60})
        self.assertEqual(res.status_code, 200, res.content)

    def test_a_course_less_choice_is_no_group_at_all(self):
        # AC1 rule 1: a choice belongs to a course. Deleting the courses leaves the
        # flags with nothing to sum against, so finals stop demanding tallies for a
        # choice the client was never shown — it used to be an unescapable block,
        # because the un-coursed dishes also have no checkbox to untick.
        from events.models import choice_groups
        write_booking_courses(self.event, [], {})
        write_menu_choices(self.event, {
            str(self.beef.id): None, str(self.salmon.id): None,
        })
        self.assertEqual(choice_groups(self.event), [])
        self.assertEqual(self._post({}).status_code, 200)

    def test_choices_in_one_course_and_a_plain_dish_in_another(self):
        """Only the dishes actually ticked form a group — an un-ticked course is not
        a group at all, so it can't block anything."""
        write_menu_choices(self.event, {
            str(self.beef.id): None, str(self.salmon.id): None,
        })
        from events.models import choice_groups
        self.assertEqual([g['course_name'] for g in choice_groups(self.event)], ['Entrée'])
        self.assertEqual(self._post({self.beef.id: 75, self.salmon.id: 75}).status_code, 200)
