"""REL-419 AC12–AC14 — the client-facing payoff of a menu choice.

A course's offered dishes collapse into one line — "Choice of: A / B / C" — wherever
the client sees the menu: the public sign page, the quote PDF, the event function
sheet, the frozen signed copy, and the in-app pages. Unflagged dishes in the same
course still render as their own lines, and a booking with no choices renders exactly
as it did before (the goldens in `test_pdf_golden.py` are the byte-identical gate and
are deliberately untouched).

Everything here goes through `booking_menu_courses`, which is the one place the
rendering exists — that is what stops the contract and the app disagreeing.
"""
import datetime
import io
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Contact, Quote
from bookings.pdf import generate_quote_pdf, generate_event_pdf
from bookings.services.presentation import booking_menu_courses, booking_presentation
from events.models import Event, write_booking_courses, write_menu_choices
from tests.base import get_test_user
from dishes.ordering import dish_ids_in_added_order


def choice_line(booking, dishes):
    """The expected "Choice of: …" line for `dishes`, in the order the menu renders
    them (add order), so these tests assert the rendering and not a fixture accident."""
    order = dish_ids_in_added_order(booking)
    names = [d.name for d in sorted(dishes, key=lambda d: order.index(d.id))]
    return f"Choice of: {' / '.join(names)}"

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover - pypdf is a declared dependency
    HAVE_PYPDF = False


def pdf_text(pdf_bytes):
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf_bytes)).pages)


class ChoiceOfRenderingTests(TestCase):
    """The renderer itself — every surface below is a thin consumer of this."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.beef, self.salmon, self.veg, self.potatoes = list(
            Dish.objects.filter(organisation=self.org)[:4]
        )
        self.event = Event.objects.create(
            organisation=self.org, name='Gala', event_date=datetime.date(2026, 12, 1),
            guest_count=150, price_per_head=Decimal('80.00'), status='confirmed',
            service_style='plated',
        )
        self.event.dishes.set([self.beef, self.salmon, self.veg, self.potatoes])
        write_booking_courses(self.event, [{'name': 'Entrée', 'sort_order': 0}], {
            str(self.beef.id): 0, str(self.salmon.id): 0,
            str(self.veg.id): 0, str(self.potatoes.id): 0,
        })

    def _entree_items(self):
        return next(g for g in booking_menu_courses(self.event) if g['name'] == 'Entrée')['items']

    def test_offered_dishes_collapse_into_one_choice_line(self):  # AC12
        write_menu_choices(self.event, {
            str(self.beef.id): None, str(self.salmon.id): None, str(self.veg.id): None,
        })
        items = self._entree_items()
        self.assertIn(
            choice_line(self.event, [self.beef, self.salmon, self.veg]), items,
        )
        # Three dishes became one line, and the unflagged dish is untouched.
        self.assertEqual(len(items), 2)
        self.assertIn(self.potatoes.name, items)

    def test_unflagged_dishes_in_the_same_course_stay_normal_lines(self):  # AC12
        write_menu_choices(self.event, {str(self.beef.id): None, str(self.salmon.id): None})
        items = self._entree_items()
        self.assertIn(self.potatoes.name, items)
        self.assertIn(self.veg.name, items)
        self.assertEqual(len([i for i in items if i.startswith('Choice of:')]), 1)

    def test_the_choice_line_keeps_the_position_of_the_first_offered_dish(self):
        # A course that lists a fixed item, then the choice, must not get reordered.
        # Menu order is ADD order, so add the fixed dish first.
        self.event.dishes.clear()
        for dish in (self.potatoes, self.beef, self.salmon):
            self.event.dishes.add(dish)
        write_booking_courses(self.event, [{'name': 'Entrée', 'sort_order': 0}], {
            str(self.potatoes.id): 0, str(self.beef.id): 0, str(self.salmon.id): 0,
        })
        write_menu_choices(self.event, {str(self.beef.id): None, str(self.salmon.id): None})
        items = self._entree_items()
        self.assertEqual(items[0], self.potatoes.name)
        self.assertTrue(items[1].startswith('Choice of:'))

    def test_a_booking_with_no_choices_renders_exactly_as_before(self):  # AC13
        before = booking_menu_courses(self.event)
        write_menu_choices(self.event, {})
        self.assertEqual(booking_menu_courses(self.event), before)
        self.assertFalse(
            any(i.startswith('Choice of:') for g in before for i in g['items'])
        )

    def test_a_course_less_booking_is_untouched(self):  # AC13
        write_booking_courses(self.event, [], {})
        self.assertIsNone(booking_menu_courses(self.event))

    def test_choices_render_per_course_not_across_the_menu(self):
        write_booking_courses(self.event, [
            {'name': 'Entrée', 'sort_order': 0}, {'name': 'Dessert', 'sort_order': 1},
        ], {
            str(self.beef.id): 0, str(self.salmon.id): 0,
            str(self.veg.id): 1, str(self.potatoes.id): 1,
        })
        write_menu_choices(self.event, {
            str(self.beef.id): None, str(self.salmon.id): None,
            str(self.veg.id): None, str(self.potatoes.id): None,
        })
        groups = {g['name']: g['items'] for g in booking_menu_courses(self.event)}
        self.assertEqual(groups['Entrée'], [choice_line(self.event, [self.beef, self.salmon])])
        self.assertEqual(groups['Dessert'], [choice_line(self.event, [self.veg, self.potatoes])])


class ChoiceOfDocumentTests(TestCase):
    """The rendering as it reaches the client: sign page, both PDFs, signed copy."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.beef, self.salmon, self.potatoes = list(
            Dish.objects.filter(organisation=self.org)[:3]
        )
        self.contact = Contact.objects.create(organisation=self.org, name='Jane Host')
        self.quote = Quote.objects.create(
            organisation=self.org, primary_contact=self.contact,
            event_date=datetime.date(2026, 12, 1), guest_count=150,
            price_per_head=Decimal('80.00'), service_style='plated',
        )
        self.quote.dishes.set([self.beef, self.salmon, self.potatoes])
        write_booking_courses(self.quote, [{'name': 'Entrée', 'sort_order': 0}], {
            str(self.beef.id): 0, str(self.salmon.id): 0, str(self.potatoes.id): 0,
        })
        write_menu_choices(self.quote, {str(self.beef.id): None, str(self.salmon.id): None})
        self.quote.recalculate_totals()
        self.expected = choice_line(self.quote, [self.beef, self.salmon])

    def test_the_sign_page_payload_carries_the_choice_line(self):  # AC12
        pres = booking_presentation(self.quote)
        items = [i for g in pres['menu_courses'] for i in g['items']]
        self.assertIn(self.expected, items)
        self.assertIn(self.potatoes.name, items)

    def test_the_quote_pdf_renders_it(self):  # AC13
        text = pdf_text(generate_quote_pdf(self.quote))
        self.assertIn('Choice of:', text)
        self.assertIn(self.beef.name, text)
        self.assertIn(self.salmon.name, text)

    def test_the_frozen_signed_pdf_carries_it(self):  # AC14
        # Drive the REAL signing endpoint: the frozen copy is what the client agreed
        # to, and it must say the same thing forever even if the quote is edited after.
        from bookings.models import BookingSignature
        from bookings.models.quotes import QuoteStatus
        self.quote.status = QuoteStatus.SENT
        self.quote.save(update_fields=['status'])
        token = self.quote.ensure_public_token()

        res = APIClient().post(
            f'/api/public/bookings/{token}/sign/',
            {'signer_name': 'Jane Host', 'consent': True}, format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)

        self.quote.refresh_from_db()
        sig = BookingSignature.objects.get(event=self.quote.event)
        self.assertTrue(sig.signed_pdf)
        self.assertIn('Choice of:', pdf_text(bytes(sig.signed_pdf)))

    def test_the_event_pdf_renders_it_after_conversion(self):  # AC13, AC14
        from bookings.services.quote_acceptance import accept_quote
        event = accept_quote(self.quote)
        # The flags rode the conversion (AC3), so the function sheet says the same.
        items = [i for g in booking_menu_courses(event) for i in g['items']]
        self.assertIn(self.expected, items)
        event.refresh_from_db()
        self.assertIn('Choice of:', pdf_text(generate_event_pdf(event)))

    def test_a_quote_with_no_choices_never_says_choice_of(self):  # AC13
        write_menu_choices(self.quote, {})
        text = pdf_text(generate_quote_pdf(self.quote))
        self.assertNotIn('Choice of:', text)
        self.assertIn(self.beef.name, text)


class MenuLinesApiTests(TestCase):
    """AC13 — the in-app pages read the SAME rendered lines the documents use."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.beef, self.salmon = list(Dish.objects.filter(organisation=self.org)[:2])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.contact = Contact.objects.create(organisation=self.org, name='C')

    def _setup(self, booking):
        booking.dishes.set([self.beef, self.salmon])
        write_booking_courses(booking, [{'name': 'Entrée', 'sort_order': 0}], {
            str(self.beef.id): 0, str(self.salmon.id): 0,
        })
        write_menu_choices(booking, {str(self.beef.id): None, str(self.salmon.id): None})

    def test_the_quote_detail_exposes_the_rendered_menu(self):
        quote = Quote.objects.create(organisation=self.org, primary_contact=self.contact,
                                     event_date=datetime.date(2026, 12, 1), guest_count=50,
                                     service_style='plated')
        self._setup(quote)
        body = self.client.get(f'/api/bookings/quotes/{quote.id}/').json()
        self.assertEqual(body['menu_lines'], [{
            # `course_id` joined the group in REL-444 so a surface can hang extra
            # per-course content off it (the BEO's choice tallies) without matching
            # on a name two courses may share.
            'course_id': quote.courses.get().id,
            'name': 'Entrée', 'items': [choice_line(quote, [self.beef, self.salmon])],
        }])

    def test_the_event_detail_exposes_the_rendered_menu(self):
        event = Event.objects.create(organisation=self.org, name='E',
                                     event_date=datetime.date(2026, 12, 1), guest_count=50,
                                     service_style='plated')
        self._setup(event)
        body = self.client.get(f'/api/events/{event.id}/').json()
        self.assertEqual(body['menu_lines'], [{
            'course_id': event.courses.get().id,
            'name': 'Entrée', 'items': [choice_line(event, [self.beef, self.salmon])],
        }])

    def test_a_course_less_booking_sends_null(self):
        event = Event.objects.create(organisation=self.org, name='E',
                                     event_date=datetime.date(2026, 12, 1), guest_count=50)
        event.dishes.set([self.beef])
        body = self.client.get(f'/api/events/{event.id}/').json()
        self.assertIsNone(body['menu_lines'])

    def test_the_list_views_do_not_carry_it(self):
        # It reads the per-dish rows — a detail-view concern, not an N+1 on the list.
        # The earlier version of this test created no bookings, so the list came back
        # empty and it asserted nothing at all.
        event = Event.objects.create(organisation=self.org, name='E',
                                     event_date=datetime.date(2026, 12, 1), guest_count=50)
        self._setup(event)
        quote = Quote.objects.create(organisation=self.org, primary_contact=self.contact,
                                     event_date=datetime.date(2026, 12, 1), guest_count=50)
        self._setup(quote)

        rows = self.client.get('/api/events/').json()
        rows = rows['results'] if isinstance(rows, dict) else rows
        self.assertTrue(rows)
        self.assertNotIn('menu_lines', rows[0])

        qrows = self.client.get('/api/bookings/quotes/').json()
        qrows = qrows['results'] if isinstance(qrows, dict) else qrows
        self.assertTrue(qrows)
        self.assertNotIn('menu_lines', qrows[0])


class StaleFlagTests(TestCase):
    """A flag can outlive the state that gave it meaning. Every READ ignores it, so
    the client contract and the finals panel can never disagree with the editor."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.beef, self.salmon, self.rolls = list(Dish.objects.filter(organisation=self.org)[:3])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.event = Event.objects.create(
            organisation=self.org, name='Gala', event_date=datetime.date(2026, 12, 1),
            guest_count=150, status='confirmed', service_style='plated',
        )
        self.event.dishes.set([self.beef, self.salmon, self.rolls])
        write_booking_courses(self.event, [{'name': 'Entrée', 'sort_order': 0}], {
            str(self.beef.id): 0, str(self.salmon.id): 0,
        })
        write_menu_choices(self.event, {str(self.beef.id): None, str(self.salmon.id): None})

    def _lines(self):
        return booking_menu_courses(self.event)

    def test_switching_off_plated_stops_the_contract_saying_choice_of(self):
        # The Menu-choices card is plated-only, so switching to buffet takes away the
        # only way to untick. The flags must simply stop counting — otherwise a buffet
        # quote tells the client to pick one of two entrées.
        self.assertIn('Choice of:', str(self._lines()))
        self.event.service_style = 'buffet'
        self.event.save(update_fields=['service_style'])
        self.assertNotIn('Choice of:', str(self._lines()))
        self.assertIn(self.beef.name, str(self._lines()))

    def test_a_buffet_booking_has_no_choice_groups_to_tally(self):
        from events.models import choice_groups
        self.event.service_style = 'buffet'
        self.event.save(update_fields=['service_style'])
        self.assertEqual(choice_groups(self.event), [])
        # …so finals record cleanly instead of demanding tallies nobody was offered.
        res = self.client.post(f'/api/events/{self.event.id}/finals/',
                               {'final_count': 150}, format='json')
        self.assertEqual(res.status_code, 200, res.content)

    def test_moving_a_dish_out_of_its_course_clears_its_flag(self):
        write_booking_courses(self.event, [{'name': 'Entrée', 'sort_order': 0}],
                              {str(self.beef.id): 0})   # salmon unassigned
        from events.models import read_menu_choices
        self.assertNotIn(str(self.salmon.id), read_menu_choices(self.event))
        self.assertNotIn('Choice of:', str(self._lines()))

    def test_deleting_every_course_leaves_no_phantom_group(self):
        # The old behaviour: menu_lines went None (client saw no choice) while the
        # finals panel still demanded tallies for a group that no longer rendered.
        from events.models import choice_groups
        write_booking_courses(self.event, [], {})
        self.assertIsNone(self._lines())
        self.assertEqual(choice_groups(self.event), [])
        res = self.client.post(f'/api/events/{self.event.id}/finals/',
                               {'final_count': 150}, format='json')
        self.assertEqual(res.status_code, 200, res.content)

    def test_a_legacy_uncoursed_flag_is_ignored_everywhere(self):
        # Rows written before the course rule existed: flagged, but course-less.
        from events.models import EventDishComment, choice_groups
        write_booking_courses(self.event, [], {})
        EventDishComment.objects.filter(event=self.event).update(is_choice=True)
        self.assertEqual(choice_groups(self.event), [])
        self.assertIsNone(self._lines())


class DishNameEscapingTests(TestCase):
    """A dish name is free user text and every PDF Paragraph is parsed as reportlab
    mini-markup. Un-escaped, `Beef </b> oops` took the whole download down."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest("pypdf not installed")
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.dish, self.other = list(Dish.objects.filter(organisation=self.org)[:2])
        self.contact = Contact.objects.create(organisation=self.org, name='C')
        self.quote = Quote.objects.create(
            organisation=self.org, primary_contact=self.contact,
            event_date=datetime.date(2026, 12, 1), guest_count=50,
            price_per_head=Decimal('40.00'), service_style='plated',
        )
        self.quote.dishes.set([self.dish, self.other])
        self.quote.recalculate_totals()

    def _rename(self, name):
        self.dish.name = name
        self.dish.save(update_fields=['name'])

    def test_a_name_with_a_stray_closing_tag_does_not_kill_the_download(self):
        self._rename('Beef </b> oops')
        self.assertIn('Beef', pdf_text(generate_quote_pdf(self.quote)))

    def test_markup_in_a_name_is_shown_not_interpreted(self):
        self._rename('Salmon <b>Deluxe</b>')
        self.assertIn('Deluxe', pdf_text(generate_quote_pdf(self.quote)))

    def test_an_ampersand_survives(self):
        self._rename('Mac & Cheese')
        self.assertIn('Mac & Cheese', pdf_text(generate_quote_pdf(self.quote)))

    def test_the_same_holds_inside_a_choice_line(self):
        self._rename('Beef </b> oops')
        write_booking_courses(self.quote, [{'name': 'Entrée', 'sort_order': 0}],
                              {str(self.dish.id): 0, str(self.other.id): 0})
        write_menu_choices(self.quote, {str(self.dish.id): None, str(self.other.id): None})
        text = pdf_text(generate_quote_pdf(self.quote))
        self.assertIn('Choice of:', text)


class DegenerateChoiceTests(TestCase):
    """One offered dish is not a choice — the editor warns, and the contract simply
    reads it as the ordinary dish it is rather than "Choice of: Filet Mignon"."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.beef, self.salmon = list(Dish.objects.filter(organisation=self.org)[:2])
        self.event = Event.objects.create(
            organisation=self.org, name='Gala', event_date=datetime.date(2026, 12, 1),
            guest_count=150, status='confirmed', service_style='plated',
        )
        self.event.dishes.set([self.beef, self.salmon])
        write_booking_courses(self.event, [{'name': 'Entrée', 'sort_order': 0}], {
            str(self.beef.id): 0, str(self.salmon.id): 0,
        })

    def test_a_lone_offered_dish_renders_as_a_normal_line(self):
        write_menu_choices(self.event, {str(self.beef.id): None})
        items = booking_menu_courses(self.event)[0]['items']
        self.assertIn(self.beef.name, items)
        self.assertNotIn('Choice of:', str(items))

    def test_two_offered_dishes_collapse_as_usual(self):
        write_menu_choices(self.event,
                           {str(self.beef.id): None, str(self.salmon.id): None})
        self.assertIn('Choice of:', str(booking_menu_courses(self.event)[0]['items']))
