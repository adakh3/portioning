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
    finals_status, read_entree_choices, write_entree_choices, write_booking_courses,
)

# Events must sit in the future: the list/detail views auto-advance a past confirmed
# event to in_progress/completed, which would erase the derived finals state.
FUTURE_DATE = (timezone.now().date() + timedelta(days=120)).isoformat()


class EntreeChoiceModelTests(TestCase):
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
        write_entree_choices(self.event, {str(self.d1.id): None, str(self.d2.id): None})
        rows = {r.dish_id: r for r in self.event.dish_comments.all()}
        self.assertTrue(rows[self.d1.id].is_entree_choice)
        self.assertTrue(rows[self.d2.id].is_entree_choice)
        self.assertIsNone(rows[self.d1.id].choice_count)
        self.assertIsNone(rows[self.d2.id].choice_count)

    def test_read_round_trips_what_write_accepts(self):
        write_entree_choices(self.event, {str(self.d1.id): 90, str(self.d2.id): None})
        self.assertEqual(
            read_entree_choices(self.event), {str(self.d1.id): 90, str(self.d2.id): None},
        )

    def test_unflagging_clears_the_flag_and_its_count(self):
        write_entree_choices(self.event, {str(self.d1.id): 40})
        write_entree_choices(self.event, {})
        row = EventDishComment.objects.get(event=self.event, dish=self.d1)
        self.assertFalse(row.is_entree_choice)
        self.assertIsNone(row.choice_count)

    def test_ignores_a_dish_not_on_the_booking(self):
        self.event.dishes.set([self.d1])
        write_entree_choices(self.event, {str(self.d1.id): None, str(self.d3.id): None})
        self.assertFalse(EventDishComment.objects.filter(event=self.event, dish=self.d3).exists())

    def test_choices_do_not_disturb_course_assignment(self):
        write_booking_courses(self.event, [{'name': 'Entrée', 'sort_order': 0}],
                              {str(self.d1.id): 0})
        write_entree_choices(self.event, {str(self.d1.id): None})
        row = EventDishComment.objects.get(event=self.event, dish=self.d1)
        self.assertEqual(row.course.name, 'Entrée')
        self.assertTrue(row.is_entree_choice)

    def test_works_the_same_on_a_quote(self):  # AC1 (quote mirror)
        contact = Contact.objects.create(organisation=self.org, name='C')
        quote = Quote.objects.create(organisation=self.org, primary_contact=contact,
                                     event_date=FUTURE_DATE, guest_count=50)
        quote.dishes.set([self.d1, self.d2])
        write_entree_choices(quote, {str(self.d1.id): None})
        row = QuoteDishComment.objects.get(quote=quote, dish=self.d1)
        self.assertTrue(row.is_entree_choice)
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


class EntreeChoiceApiTests(TestCase):
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
            entree_choices={str(self.d1.id): None, str(self.d2.id): None},
        )
        self.assertEqual(
            body['entree_choices'], {str(self.d1.id): None, str(self.d2.id): None},
        )
        # Reload independently — no validation fired, the flags persisted (AC11).
        got = self.client.get(f"/api/bookings/quotes/{body['id']}/").json()
        self.assertEqual(got['entree_choices'], {str(self.d1.id): None, str(self.d2.id): None})

    def test_quote_never_validates_a_sum(self):  # AC8
        # Guest count 50 but only two offerings and no counts: still a clean save.
        body = self._create_quote(entree_choices={str(self.d1.id): None})
        res = self.client.patch(
            f"/api/bookings/quotes/{body['id']}/",
            {'entree_choices': {str(self.d1.id): None, str(self.d2.id): None}},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)

    def test_quote_patch_without_the_key_preserves_choices(self):
        body = self._create_quote(entree_choices={str(self.d1.id): None})
        res = self.client.patch(
            f"/api/bookings/quotes/{body['id']}/", {'guest_count': 60}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['entree_choices'], {str(self.d1.id): None})

    def test_event_saves_offered_choices_and_exposes_finals_status(self):  # AC1 (event mirror)
        res = self.client.post('/api/events/', {
            'name': 'Gala', 'date': FUTURE_DATE, 'guest_count': 50,
            'service_style': 'plated', 'dish_ids': [self.d1.id, self.d2.id],
            'entree_choices': {str(self.d1.id): None, str(self.d2.id): None},
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(
            res.json()['entree_choices'], {str(self.d1.id): None, str(self.d2.id): None},
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
            'entree_choices': {str(self.d1.id): None, str(self.d2.id): None},
        }, format='json').json()['id']
        EventDishComment.objects.filter(event_id=ev_id, dish=self.d1).update(choice_count=30)

        res = self.client.patch(f'/api/events/{ev_id}/', {
            'dish_comments': [
                {'dish_id': self.d1.id, 'comment': 'no nuts', 'portion_grams': 120},
                {'dish_id': self.d2.id, 'comment': '', 'portion_grams': 100},
            ],
        }, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['entree_choices'], {str(self.d1.id): 30, str(self.d2.id): None})

    def test_choices_survive_quote_to_event_acceptance(self):  # AC3
        from bookings.services.quote_acceptance import accept_quote
        quote = Quote.objects.create(organisation=self.org, primary_contact=self.contact,
                                     event_date=FUTURE_DATE, guest_count=50,
                                     service_style='plated')
        quote.dishes.set([self.d1, self.d2])
        write_entree_choices(quote, {str(self.d1.id): None, str(self.d2.id): None})

        event = accept_quote(quote)

        self.assertEqual(
            read_entree_choices(event), {str(self.d1.id): None, str(self.d2.id): None},
        )
        # The portion rows the conversion creates are still intact alongside the flags.
        self.assertTrue(
            EventDishComment.objects.filter(event=event, dish=self.d1)
            .exclude(portion_grams=None).exists()
        )

    def test_a_booking_with_no_choices_is_unchanged(self):  # existing-row rule
        body = self._create_quote()
        self.assertEqual(body['entree_choices'], {})
        ev = self.client.post('/api/events/', {
            'name': 'Plain', 'date': FUTURE_DATE, 'guest_count': 50,
            'dish_ids': [self.d1.id],
        }, format='json').json()
        self.assertEqual(ev['entree_choices'], {})
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
            final_count_due=timezone.localdate() + timedelta(days=7),
        )
        self.event.dishes.set([self.d1, self.d2])
        self.event.recalculate_totals()
        write_entree_choices(self.event, {str(self.d1.id): None, str(self.d2.id): None})

    def _post(self, **data):
        return self.client.post(f'/api/events/{self.event.id}/finals/', data, format='json')

    def test_one_save_records_everything_and_flips_the_pill(self):  # AC6
        res = self._post(
            final_count=150, guaranteed_count=140,
            final_count_due=str(timezone.localdate() + timedelta(days=3)),
            entree_counts={str(self.d1.id): 90, str(self.d2.id): 60},
        )
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body['final_count'], 150)
        self.assertEqual(body['guaranteed_count'], 140)
        self.assertEqual(body['entree_choices'], {str(self.d1.id): 90, str(self.d2.id): 60})
        self.assertEqual(body['finals_status'], 'recorded')
        # …and it is really stored (AC11).
        self.event.refresh_from_db()
        self.assertEqual(self.event.final_count, 150)

    def test_tallies_that_miss_the_guarantee_are_rejected(self):  # AC7
        res = self._post(final_count=150,
                         entree_counts={str(self.d1.id): 90, str(self.d2.id): 55})
        self.assertEqual(res.status_code, 400)
        self.assertIn('add up to the final guarantee', str(res.json()))
        self.event.refresh_from_db()
        self.assertIsNone(self.event.final_count)  # nothing was written

    def test_a_missing_tally_counts_as_zero_and_fails_the_sum(self):  # AC7
        res = self._post(final_count=150, entree_counts={str(self.d1.id): 150 - 10})
        self.assertEqual(res.status_code, 400)

    def test_a_tally_for_a_dish_that_is_not_offered_is_rejected(self):
        other = self.d2
        write_entree_choices(self.event, {str(self.d1.id): None})
        res = self._post(final_count=150, entree_counts={str(self.d1.id): 150,
                                                         str(other.id): 0})
        self.assertEqual(res.status_code, 400)

    def test_an_event_with_no_offerings_records_the_guarantee_alone(self):
        write_entree_choices(self.event, {})
        res = self._post(final_count=150)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['final_count'], 150)

    def test_recording_tallies_never_moves_the_money(self):  # AC9
        before = (self.event.subtotal, self.event.tax_amount, self.event.total)
        res = self._post(final_count=150,
                         entree_counts={str(self.d1.id): 90, str(self.d2.id): 60})
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
