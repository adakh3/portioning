"""REL-417 — courses & service styles on bookings.

Courses (Starter/Entrée/Dessert + service style) group a booking's menu; each dish
is assigned to a course. Additive & optional: a course-less booking resolves to a
flat menu unchanged (AC4). Covers AC1–AC3, AC5, AC7 + the confirm-portion interaction
(course rows must not disable / collide with portion auto-calc).
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from tests.base import get_test_user
from events.models import (
    Event, BookingCourse, EventDishComment, QuoteDishComment,
    resolve_booking_menu, write_booking_courses,
)
from bookings.models import Quote, Contact


class CourseModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        from dishes.models import Dish
        self.d1, self.d2, self.d3 = list(Dish.objects.filter(organisation=self.org)[:3])
        self.event = Event.objects.create(organisation=self.org, name='E', event_date='2026-05-01')
        self.event.dishes.set([self.d1, self.d2, self.d3])

    def test_course_less_menu_resolves_to_none(self):  # AC4
        self.assertIsNone(resolve_booking_menu(self.event))

    def test_write_courses_persists_order_and_style(self):  # AC1
        write_booking_courses(self.event, [
            {'name': 'Starter', 'service_style': 'plated', 'sort_order': 0},
            {'name': 'Entrée', 'service_style': 'buffet', 'sort_order': 1},
        ], {})
        courses = list(self.event.courses.all())
        self.assertEqual([(c.name, c.service_style) for c in courses],
                         [('Starter', 'plated'), ('Entrée', 'buffet')])

    def test_assigns_dishes_and_groups_them(self):  # AC2
        write_booking_courses(self.event, [
            {'name': 'Starter', 'sort_order': 0}, {'name': 'Entrée', 'sort_order': 1},
        ], {str(self.d1.id): 1, str(self.d2.id): 0})
        groups = resolve_booking_menu(self.event)
        by_name = {g['course'].name: g['dish_ids'] for g in groups if g['course']}
        self.assertEqual(by_name['Entrée'], [self.d1.id])
        self.assertEqual(by_name['Starter'], [self.d2.id])
        # d3 was left unassigned → trailing None group (AC5).
        unassigned = [g for g in groups if g['course'] is None]
        self.assertEqual(unassigned[0]['dish_ids'], [self.d3.id])

    def test_reorder_courses_changes_group_order(self):  # AC3
        write_booking_courses(self.event, [
            {'name': 'Dessert', 'sort_order': 0}, {'name': 'Starter', 'sort_order': 1},
        ], {})
        # Re-write with swapped sort_order.
        write_booking_courses(self.event, [
            {'name': 'Starter', 'sort_order': 0}, {'name': 'Dessert', 'sort_order': 1},
        ], {})
        self.assertEqual([c.name for c in self.event.courses.all()], ['Starter', 'Dessert'])

    def test_pdf_renders_the_menu_grouped_by_course(self):  # AC2 render
        try:
            from pypdf import PdfReader
        except ImportError:
            self.skipTest("pypdf not installed")
        import io
        from bookings.pdf import generate_event_pdf
        from bookings.models.choices import ServiceStyleOption
        ServiceStyleOption.objects.get_or_create(
            organisation=self.org, value='plated', defaults={'label': 'Plated'})
        write_booking_courses(self.event, [
            {'name': 'Starter', 'service_style': 'plated', 'sort_order': 0},
            {'name': 'Dessert', 'service_style': '', 'sort_order': 1},
        ], {str(self.d1.id): 0, str(self.d3.id): 1})
        self.event.refresh_from_db()  # get a real date object for the PDF renderer
        text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(generate_event_pdf(self.event))).pages)
        self.assertIn('Starter', text)
        self.assertIn('Plated', text)          # resolved service-style label
        self.assertIn('Dessert', text)
        # Course order: Starter section precedes Dessert section.
        self.assertLess(text.find('Starter'), text.find('Dessert'))

    def test_write_ignores_a_dish_not_on_the_booking(self):
        # Review #2: a stale/foreign dish_id in the payload must not create a row.
        other = self.d3  # will NOT be added to the booking's dishes
        self.event.dishes.set([self.d1, self.d2])
        write_booking_courses(self.event, [{'name': 'Starter', 'sort_order': 0}],
                              {str(self.d1.id): 0, str(other.id): 0})
        self.assertTrue(EventDishComment.objects.filter(event=self.event, dish=self.d1).exists())
        self.assertFalse(EventDishComment.objects.filter(event=self.event, dish=other).exists())

    def test_pdf_escapes_a_course_name_with_special_chars(self):
        # Review #5: free-text course names must be XML-escaped for reportlab.
        try:
            from pypdf import PdfReader
        except ImportError:
            self.skipTest("pypdf not installed")
        import io
        from bookings.pdf import generate_event_pdf
        write_booking_courses(self.event, [{'name': 'Cheese & Crackers', 'sort_order': 0}], {str(self.d1.id): 0})
        self.event.refresh_from_db()
        text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(generate_event_pdf(self.event))).pages)
        self.assertIn('Cheese & Crackers', text)  # renders (no markup crash)

    def test_reassign_clears_a_dropped_assignment(self):
        write_booking_courses(self.event, [{'name': 'Starter', 'sort_order': 0}], {str(self.d1.id): 0})
        self.assertEqual(EventDishComment.objects.get(event=self.event, dish=self.d1).course.name, 'Starter')
        # Re-save with the dish unassigned → its course clears (row kept).
        write_booking_courses(self.event, [{'name': 'Starter', 'sort_order': 0}], {})
        self.assertIsNone(EventDishComment.objects.get(event=self.event, dish=self.d1).course)


class CourseApiTests(TestCase):
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

    def test_event_course_round_trip(self):  # AC7 (event) + AC8 survive save
        payload = {
            'name': 'Gala', 'date': '2026-05-01', 'guest_count': 50,
            'dish_ids': [self.d1.id, self.d2.id],
            'courses': [{'name': 'Starter', 'service_style': 'plated', 'sort_order': 0},
                        {'name': 'Entrée', 'service_style': 'buffet', 'sort_order': 1}],
            'dish_courses': {str(self.d1.id): 0, str(self.d2.id): 1},
        }
        res = self.client.post('/api/events/', payload, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual([c['name'] for c in body['courses']], ['Starter', 'Entrée'])
        self.assertEqual(body['dish_courses'], {str(self.d1.id): 0, str(self.d2.id): 1})
        # Reload independently — the assignment persisted.
        got = self.client.get(f"/api/events/{body['id']}/").json()
        self.assertEqual(got['dish_courses'], {str(self.d1.id): 0, str(self.d2.id): 1})

    def test_quote_course_round_trip(self):  # AC7 (quote)
        contact = Contact.objects.create(organisation=self.org, name='C')
        payload = {
            'primary_contact': contact.id, 'event_date': '2026-05-01', 'guest_count': 50,
            'dish_ids': [self.d1.id],
            'courses': [{'name': 'Dessert', 'service_style': 'plated', 'sort_order': 0}],
            'dish_courses': {str(self.d1.id): 0},
        }
        res = self.client.post('/api/bookings/quotes/', payload, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['courses'][0]['name'], 'Dessert')
        self.assertEqual(res.json()['dish_courses'], {str(self.d1.id): 0})
        self.assertTrue(QuoteDishComment.objects.filter(quote_id=res.json()['id'], dish=self.d1).exists())

    def test_courses_survive_quote_to_event_acceptance(self):  # AC7 conversion
        from bookings.services.quote_acceptance import accept_quote
        contact = Contact.objects.create(organisation=self.org, name='C')
        quote = Quote.objects.create(organisation=self.org, primary_contact=contact,
                                     event_date='2026-05-01', guest_count=50)
        quote.dishes.set([self.d1, self.d2])
        write_booking_courses(quote, [
            {'name': 'Starter', 'service_style': 'plated', 'sort_order': 0},
            {'name': 'Entrée', 'service_style': 'buffet', 'sort_order': 1},
        ], {str(self.d1.id): 0, str(self.d2.id): 1})

        event = accept_quote(quote)

        groups = resolve_booking_menu(event)
        by_name = {g['course'].name: (g['course'].service_style, g['dish_ids']) for g in groups if g['course']}
        self.assertEqual(by_name['Starter'], ('plated', [self.d1.id]))
        self.assertEqual(by_name['Entrée'], ('buffet', [self.d2.id]))

    def test_template_detail_exposes_its_courses_and_dish_assignment(self):  # AC6
        from menus.models import MenuTemplate, MenuDishPortion, MenuCourse
        tpl = MenuTemplate.objects.create(organisation=self.org, name='Plated Dinner')
        starter = MenuCourse.objects.create(menu=tpl, name='Starter', service_style='plated', sort_order=0)
        MenuCourse.objects.create(menu=tpl, name='Dessert', service_style='buffet', sort_order=1)
        MenuDishPortion.objects.create(menu=tpl, dish=self.d1, portion_grams=100, course=starter)
        MenuDishPortion.objects.create(menu=tpl, dish=self.d2, portion_grams=80)  # unassigned
        body = self.client.get(f'/api/menus/{tpl.id}/').json()
        self.assertEqual([c['name'] for c in body['courses']], ['Starter', 'Dessert'])
        self.assertEqual(body['courses'][0]['service_style'], 'plated')
        self.assertEqual(body['dish_courses'], {str(self.d1.id): 0})  # d2 unassigned → absent

    def test_patch_without_courses_key_preserves_courses(self):
        # Review #6: a PATCH that omits `courses` must NOT wipe existing courses.
        ev_id = self.client.post('/api/events/', {
            'name': 'C', 'date': '2026-05-01', 'guest_count': 50, 'dish_ids': [self.d1.id],
            'courses': [{'name': 'Starter', 'service_style': 'plated', 'sort_order': 0}],
            'dish_courses': {str(self.d1.id): 0},
        }, format='json').json()['id']
        res = self.client.patch(f'/api/events/{ev_id}/', {'guest_count': 60}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual([c['name'] for c in res.json()['courses']], ['Starter'])  # untouched

    def test_confirming_still_calculates_portions_with_course_rows_present(self):
        # The interaction fix: a course-only EventDishComment must not disable the
        # confirm-time portion auto-calc, and the calc must upsert (not collide).
        ev_id = self.client.post('/api/events/', {
            'name': 'Conf', 'date': '2026-05-01', 'guest_count': 50,
            'dish_ids': [self.d1.id],
            'courses': [{'name': 'Entrée', 'sort_order': 0}],
            'dish_courses': {str(self.d1.id): 0},
        }, format='json').json()['id']
        res = self.client.patch(f'/api/events/{ev_id}/', {'status': 'confirmed'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        row = EventDishComment.objects.get(event_id=ev_id, dish=self.d1)
        self.assertIsNotNone(row.portion_grams)      # portion computed
        self.assertEqual(row.course.name, 'Entrée')  # course assignment preserved
