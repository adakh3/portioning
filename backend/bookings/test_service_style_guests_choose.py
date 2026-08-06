"""Service styles decide whether guests choose — the flag, not the slug (REL-452).

Whether a booking can offer the guest a choice of dish used to be a hardcoded
comparison against the slug ``'plated'``. It is now ``guests_choose`` on the org's own
``ServiceStyleOption``, so an org that does boxed lunches can say so, and an org that
adds "Plated (duet)" isn't silently excluded by a slug nobody can see.

These cover both directions of the switch: the styles that gained the behaviour, and —
more importantly — that no existing booking changed on the day it shipped.
"""
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from django.core.management import call_command

from bookings.models import Contact, Quote
from bookings.models.choices import ServiceStyleOption
from bookings.services.presentation import booking_menu_courses
from events.models import (
    Event, booking_offers_choices, choice_groups, write_booking_courses,
    write_menu_choices,
)
from users.models import Organisation

User = get_user_model()


def _style(org, value):
    """The org's row for a style, created if this org's fixture lacks it. The tests
    are about the flag, not about which styles a given fixture happens to seed."""
    style, _ = ServiceStyleOption.objects.get_or_create(
        organisation=org, value=value, defaults={'label': value.title()},
    )
    return style


class ServiceStyleSeedDefaultsTests(TestCase):
    """AC1/AC2 — a new org starts with exactly one style offering choices."""

    def setUp(self):
        self.org = Organisation.objects.create(name='Seeded Co', slug='seeded-co')

    def test_plated_ships_with_the_flag_on_and_nothing_else_does(self):
        flags = dict(
            ServiceStyleOption.objects.filter(organisation=self.org)
            .values_list('value', 'guests_choose')
        )
        self.assertTrue(flags['plated'])
        self.assertEqual(
            sorted(v for v, on in flags.items() if on), ['plated'],
            'only plated should offer choices out of the box',
        )
        # The rest are seeded and explicitly off — not merely absent.
        for value in ('buffet', 'family', 'stations', 'passed', 'dropoff'):
            self.assertFalse(flags[value], f'{value} should not offer choices by default')


class BookingOffersChoicesTests(TestCase):
    """AC4 — the gate reads the org's flag, in both directions."""

    def setUp(self):
        self.org = Organisation.objects.create(name='Gate Co', slug='gate-co')
        self.event = Event.objects.create(
            organisation=self.org, name='E', event_date=date(2026, 9, 1),
            guest_count=100, service_style='plated',
        )

    def test_a_style_with_the_flag_offers_choices(self):
        self.assertTrue(booking_offers_choices(self.event))

    def test_a_style_without_it_does_not(self):
        self.event.service_style = 'buffet'
        self.assertFalse(booking_offers_choices(self.event))

    def test_turning_it_on_for_drop_off_is_all_it_takes(self):
        # The boxed-lunch case: every guest pre-picks, so the split has to be known
        # before the day — exactly what the old slug check could never express.
        self.event.service_style = 'dropoff'
        self.assertFalse(booking_offers_choices(self.event))
        s = _style(self.org, 'dropoff')
        s.guests_choose = True
        s.save()
        self.assertTrue(booking_offers_choices(self.event))

    def test_turning_it_off_for_plated_is_honoured_too(self):
        s = _style(self.org, 'plated')
        s.guests_choose = False
        s.save()
        self.assertFalse(booking_offers_choices(self.event))

    def test_a_blank_or_unknown_style_offers_nothing(self):
        for style in ('', None, 'not_a_style_this_org_has'):
            self.event.service_style = style
            self.assertFalse(
                booking_offers_choices(self.event),
                f'{style!r} should not offer choices',
            )

    def test_another_org_ticking_it_does_not_leak(self):
        # The flag is per-org data. Org B enabling buffet must not change org A's
        # buffet booking — the lookup is scoped, not global.
        other = Organisation.objects.create(name='Other Co', slug='other-co')
        s = _style(other, 'buffet')
        s.guests_choose = True
        s.save()
        self.event.service_style = 'buffet'
        self.assertFalse(booking_offers_choices(self.event))


class ChoiceGroupsHonourTheFlagTests(TestCase):
    """AC7/AC8 — what the contract renders follows the flag, and unticking is safe."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        from dishes.models import Dish
        from tests.base import get_test_user

        self.org = get_test_user().organisation
        self.a, self.b = list(Dish.objects.filter(organisation=self.org)[:2])
        self.event = Event.objects.create(
            organisation=self.org, name='E', event_date=date(2026, 9, 1),
            guest_count=100, service_style='dropoff',
        )
        self.event.dishes.set([self.a, self.b])
        write_booking_courses(self.event, [{'name': 'Entrée', 'sort_order': 0}],
                              {str(self.a.id): 0, str(self.b.id): 0})
        write_menu_choices(self.event, {str(self.a.id): None, str(self.b.id): None})

    def test_marked_choices_stay_invisible_until_the_style_says_so(self):
        # The flags are already on the rows — the style is the only thing stopping them.
        self.assertEqual(choice_groups(self.event), [])

    def test_ticking_the_style_makes_them_a_real_choice(self):
        s = _style(self.org, 'dropoff')
        s.guests_choose = True
        s.save()
        groups = choice_groups(self.event)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['course_name'], 'Entrée')
        self.assertEqual(groups[0]['dish_ids'], sorted([self.a.id, self.b.id]))

    def test_unticking_hides_them_without_destroying_them(self):
        from events.models import EventDishComment

        s = _style(self.org, 'dropoff')
        s.guests_choose = True
        s.save()
        self.assertEqual(len(choice_groups(self.event)), 1)

        s.guests_choose = False
        s.save()
        self.assertEqual(choice_groups(self.event), [])
        # AC8: the rows survive untouched, so re-ticking restores the booking exactly.
        self.assertEqual(
            EventDishComment.objects.filter(event=self.event, is_choice=True).count(), 2,
        )
        s.guests_choose = True
        s.save()
        self.assertEqual(len(choice_groups(self.event)), 1)

    def test_the_contract_says_choice_of_only_when_the_style_does(self):
        from bookings.services.presentation import booking_menu_courses

        def rendered():
            return [
                item
                for group in (booking_menu_courses(self.event) or [])
                for item in group['items']
            ]

        self.assertFalse(
            any('Choice of' in line for line in rendered()),
            'a style that does not offer choices must not print one',
        )
        s = _style(self.org, 'dropoff')
        s.guests_choose = True
        s.save()
        self.assertTrue(
            any('Choice of' in line for line in rendered()),
            'ticking the style must reach the client-facing contract',
        )


class ChoiceOfReachesTheDocumentsTests(TestCase):
    """AC7 — the payoff, on a style that is NOT called plated.

    The rendering itself is REL-419's and unchanged; what's new is that a drop-off
    booking can reach it at all. Render-and-extract rather than eyeballing: the whole
    point of the flag is that the client-facing paper says "Choice of".
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_data', verbosity=0)

    def setUp(self):
        import io
        from dishes.models import Dish
        from tests.base import get_test_user

        self.org = get_test_user().organisation
        self.a, self.b = list(Dish.objects.filter(organisation=self.org)[:2])
        contact = Contact.objects.create(organisation=self.org, first_name='Ada')
        self.event = Event.objects.create(
            organisation=self.org, name='Boxed lunch drop', event_date=date(2026, 9, 1),
            guest_count=40, service_style='dropoff', status='confirmed',
            primary_contact=contact,
        )
        self.quote = Quote.objects.create(
            organisation=self.org, primary_contact=contact,
            event_date=date(2026, 9, 1), guest_count=40, service_style='dropoff',
        )
        for booking in (self.event, self.quote):
            booking.dishes.set([self.a, self.b])
            write_booking_courses(booking, [{'name': 'Entrée', 'sort_order': 0}],
                                  {str(self.a.id): 0, str(self.b.id): 0})
            write_menu_choices(booking, {str(self.a.id): None, str(self.b.id): None})

    def _pdf_text(self, pdf_bytes):
        import io
        from pypdf import PdfReader
        return '\n'.join(page.extract_text() for page in PdfReader(io.BytesIO(pdf_bytes)).pages)

    def test_both_pdfs_print_the_choice_once_the_style_allows_it(self):
        from bookings.pdf import generate_event_pdf, generate_quote_pdf

        # Off: the flags are on the rows, but drop-off doesn't offer choices yet.
        self.assertNotIn('Choice of', self._pdf_text(generate_event_pdf(self.event)))
        self.assertNotIn('Choice of', self._pdf_text(generate_quote_pdf(self.quote)))

        style = _style(self.org, 'dropoff')
        style.guests_choose = True
        style.save()

        # On: the same booking, on a style that isn't plated, now reads as a choice.
        event_text = self._pdf_text(generate_event_pdf(self.event))
        quote_text = self._pdf_text(generate_quote_pdf(self.quote))
        for text, label in ((event_text, 'event'), (quote_text, 'quote')):
            self.assertIn('Choice of', text, f'{label} PDF should offer the choice')
            self.assertIn(self.a.name, text)
            self.assertIn(self.b.name, text)

    def test_the_public_sign_page_agrees_with_the_pdf(self):
        from bookings.services.presentation import booking_presentation

        style = _style(self.org, 'dropoff')
        style.guests_choose = True
        style.save()
        items = [
            item
            for group in (booking_presentation(self.quote) or {}).get('menu_courses', [])
            for item in group['items']
        ]
        self.assertTrue(
            any('Choice of' in item for item in items),
            'the page the client signs must say the same thing as the PDF',
        )


class ServiceStyleSettingsApiTests(TestCase):
    """AC6 — the flag round-trips through the Settings API, admin/owner only."""

    def setUp(self):
        self.org = Organisation.objects.create(name='Api Co', slug='api-co')
        self.owner = User.objects.create_user(
            email='owner@api.test', password='pw', organisation=self.org, role='owner',
        )
        self.chef = User.objects.create_user(
            email='chef@api.test', password='pw', organisation=self.org, role='chef',
        )
        self.style = _style(self.org, 'dropoff')
        self.url = f'/api/bookings/settings/service-styles/{self.style.id}/'
        self.client = APIClient()

    def test_the_read_endpoint_exposes_the_flag(self):
        # The booking pages read it from here — the Menu card must never offer a
        # choice the API would then ignore.
        self.client.force_authenticate(self.owner)
        res = self.client.get('/api/bookings/service-styles/')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        rows = body['results'] if isinstance(body, dict) else body
        flags = {row['value']: row['guests_choose'] for row in rows}
        self.assertTrue(flags['plated'])
        self.assertFalse(flags['dropoff'])

    def test_an_owner_can_tick_it(self):
        self.client.force_authenticate(self.owner)
        res = self.client.patch(self.url, {'guests_choose': True}, format='json')
        self.assertEqual(res.status_code, 200)
        self.style.refresh_from_db()
        self.assertTrue(self.style.guests_choose)

    def test_renaming_the_style_leaves_the_flag_alone(self):
        # Renaming is the common edit, and it must not silently change behaviour —
        # the whole complaint about slugs.
        self.style.guests_choose = True
        self.style.save()
        self.client.force_authenticate(self.owner)
        res = self.client.patch(self.url, {'label': 'Boxed lunches'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.style.refresh_from_db()
        self.assertEqual(self.style.label, 'Boxed lunches')
        self.assertTrue(self.style.guests_choose)
        self.assertEqual(self.style.value, 'dropoff')   # the stored key never moves

    def test_a_chef_cannot(self):
        self.client.force_authenticate(self.chef)
        res = self.client.patch(self.url, {'guests_choose': True}, format='json')
        self.assertIn(res.status_code, (403, 404))
        self.style.refresh_from_db()
        self.assertFalse(self.style.guests_choose)


class GuestsChooseBackfillMigrationTests(TransactionTestCase):
    """AC3 — every existing org keeps today's behaviour, exactly.

    The suite builds the DB at the latest migration, so the backfill never runs on
    real rows. This drives it on old-shape data: the org's own styles, including a
    renamed plated row and a hand-added one, and asserts only the row whose value is
    literally `plated` comes out ticked — which is what the old code did.
    """
    migrate_from = [('bookings', '0076_alter_quote_gratuity_pct_and_more')]
    migrate_to = [('bookings', '0078_servicestyle_guests_choose_backfill')]

    def _migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        from django.core.management import call_command
        call_command('migrate', verbosity=0)

    def test_only_the_plated_slug_is_ticked(self):
        old = self._migrate(self.migrate_from)
        Org = old.get_model('users', 'Organisation')
        Style = old.get_model('bookings', 'ServiceStyleOption')

        org = Org.objects.create(name='OldCo', slug='old-co', country='US')
        rows = [
            ('plated', 'Plated / Sit-down'),   # renamed label, slug survived
            ('buffet', 'Buffet'),
            ('plated_duet', 'Plated (duet)'),  # the org's own addition
            ('boxed', 'Boxed / Individual'),
        ]
        for i, (value, label) in enumerate(rows):
            Style.objects.create(organisation=org, value=value, label=label, sort_order=i)

        new = self._migrate(self.migrate_to)
        NewStyle = new.get_model('bookings', 'ServiceStyleOption')
        flags = dict(
            NewStyle.objects.filter(organisation_id=org.id)
            .values_list('value', 'guests_choose')
        )
        # The renamed row keeps working; nothing else gains or loses anything.
        self.assertTrue(flags['plated'])
        self.assertFalse(flags['buffet'])
        self.assertFalse(flags['plated_duet'])
        self.assertFalse(flags['boxed'])


class QuoteKeepsTheSameRuleTests(TestCase):
    """The mirror: quotes go through the same gate as events, on the same data."""

    def setUp(self):
        self.org = Organisation.objects.create(name='Quote Co', slug='quote-co')
        contact = Contact.objects.create(organisation=self.org, first_name='Ada')
        self.quote = Quote.objects.create(
            organisation=self.org,
            primary_contact=contact,
            event_date=date.today() + timedelta(days=30),
            guest_count=80,
            service_style='dropoff',
        )

    def test_a_quote_follows_its_orgs_flag(self):
        self.assertFalse(booking_offers_choices(self.quote))
        s = _style(self.org, 'dropoff')
        s.guests_choose = True
        s.save()
        self.assertTrue(booking_offers_choices(self.quote))
