"""Event timeline entries + presets (REL-418).

Traced to the ticket's acceptance criteria:
  AC1 — entries persist in run-of-show order, labelled from org presets
  AC2 — reorder / remove persists
  AC3 — with NO entries, the four legacy time fields render exactly as today
  AC4 — with entries, they render INSTEAD of the four legacy fields
  AC5 — existing bookings have no entries and are never auto-migrated
  AC6 — preset CRUD in Settings, admin/owner only
  AC7 — quote ↔ event mirror, create and edit
  AC8 — survives save + reload (Playwright: frontend/e2e/booking-timeline.spec.ts)
"""
import datetime
import io
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import BookingLineItem, OrgSettings
from bookings.models.choices import TimelinePresetOption
from bookings.pdf import generate_event_pdf, generate_quote_pdf
from bookings.services.presentation import booking_presentation
from bookings.tests import _make_org, make_account, make_contact, make_quote
from events.models import BookingTimelineEntry, Event
from tests.base import get_test_user
from users.models import Organisation, User

try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except ImportError:  # pragma: no cover - pypdf is a declared dependency
    HAVE_PYPDF = False


def _dt(hour):
    return datetime.datetime(2026, 8, 1, hour, 0, tzinfo=datetime.timezone.utc)


def pdf_text(data):
    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() for page in reader.pages)


# ── AC6 — org presets ───────────────────────────────────────────────────────

class TimelinePresetSeedingTests(TestCase):
    def test_new_org_gets_starter_presets(self):
        org = Organisation.objects.create(name='Preset Co', slug='preset-co', country='US')
        labels = list(TimelinePresetOption.objects
                      .filter(organisation=org).values_list('label', flat=True))
        self.assertIn('Cocktail hour', labels)
        self.assertIn('Cake cutting', labels)

    def test_presets_are_offered_in_run_of_show_order_not_alphabetically(self):
        org = Organisation.objects.create(name='Order Co', slug='order-co', country='US')
        labels = list(TimelinePresetOption.objects
                      .filter(organisation=org).values_list('label', flat=True))
        # "Staff arrive" comes before "Cake cutting" in the day, though not A-Z.
        self.assertLess(labels.index('Staff arrive'), labels.index('Cake cutting'))

    def test_presets_are_org_scoped(self):
        a = Organisation.objects.create(name='P Org A', slug='p-org-a', country='US')
        b = Organisation.objects.create(name='P Org B', slug='p-org-b', country='US')
        TimelinePresetOption.objects.filter(organisation=a).delete()
        TimelinePresetOption.objects.create(
            organisation=a, value='fireworks', label='Fireworks', sort_order=0)
        self.assertEqual(
            list(TimelinePresetOption.objects.filter(organisation=a)
                 .values_list('label', flat=True)),
            ['Fireworks'],
        )
        self.assertNotIn('Fireworks',
                         TimelinePresetOption.objects.filter(organisation=b)
                         .values_list('label', flat=True))

    def test_backfill_command_fills_an_org_that_predates_presets(self):
        from django.core.management import call_command
        org = Organisation.objects.create(name='Old Co', slug='old-co', country='US')
        TimelinePresetOption.objects.filter(organisation=org).delete()
        call_command('seed_org_choices', verbosity=0)
        self.assertTrue(TimelinePresetOption.objects.filter(organisation=org).exists())

    def test_backfill_does_not_re_add_a_preset_the_org_deleted(self):
        from django.core.management import call_command
        org = Organisation.objects.create(name='Curated Org', slug='curated-org', country='US')
        TimelinePresetOption.objects.filter(organisation=org, value='dancing').delete()
        call_command('seed_org_choices', verbosity=0)
        self.assertFalse(
            TimelinePresetOption.objects.filter(organisation=org, value='dancing').exists())


class TimelinePresetApiTests(TestCase):
    """AC6: admins manage presets in Settings; everyone can read the picker."""

    def setUp(self):
        self.owner = get_test_user()
        self.org = self.owner.organisation
        # The default org is created by an early data migration, so it predates
        # these presets — exactly the "existing org" case `seed_org_choices`
        # backfills in production. Backfill it here the same way.
        from bookings.defaults import seed_choice_defaults
        seed_choice_defaults(self.org, only_if_empty=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def test_picker_lists_the_orgs_presets(self):
        resp = self.client.get('/api/bookings/timeline-presets/?page_size=all')
        self.assertEqual(resp.status_code, 200)
        labels = [o['label'] for o in resp.json()]
        self.assertIn('Cocktail hour', labels)

    def test_admin_can_add_a_preset_and_it_reaches_the_picker(self):
        resp = self.client.post('/api/bookings/settings/timeline-presets/',
                                {'label': 'Sparkler send-off'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(resp.json()['value'], 'a stable key is generated server-side')

        picker = self.client.get('/api/bookings/timeline-presets/?page_size=all')
        self.assertIn('Sparkler send-off', [o['label'] for o in picker.json()])

    def test_admin_can_rename_and_reorder(self):
        created = self.client.post('/api/bookings/settings/timeline-presets/',
                                   {'label': 'Toasts'}, format='json').json()
        resp = self.client.patch(
            f"/api/bookings/settings/timeline-presets/{created['id']}/",
            {'label': 'Speeches', 'sort_order': 99}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        row = TimelinePresetOption.objects.get(pk=created['id'])
        self.assertEqual(row.label, 'Speeches')
        self.assertEqual(row.sort_order, 99)
        # The generated key is stable across a rename — bookings referencing it
        # by label keep working.
        self.assertEqual(row.value, created['value'])

    def test_non_admin_cannot_manage_presets(self):
        chef = User.objects.create(email='chef@timeline.test', role='chef',
                                   organisation=self.org)
        client = APIClient()
        client.force_authenticate(user=chef)
        self.assertEqual(
            client.post('/api/bookings/settings/timeline-presets/',
                        {'label': 'Sneaky'}, format='json').status_code, 403)
        self.assertEqual(
            client.get('/api/bookings/settings/timeline-presets/').status_code, 403)
        # …but a chef can still read the picker to build a booking's timeline.
        self.assertEqual(
            client.get('/api/bookings/timeline-presets/').status_code, 200)

    def test_preset_list_has_no_n_plus_one(self):
        from tests.base import assert_list_queries_constant
        n = [0]

        def make_row():
            n[0] += 1
            TimelinePresetOption.objects.create(
                organisation=self.org, value=f'step_{n[0]}',
                label=f'Step {n[0]}', sort_order=n[0])

        assert_list_queries_constant(
            self, self.client, '/api/bookings/timeline-presets/?page_size=all',
            make_row, label='timeline presets')


# ── AC1 / AC2 / AC7 — writing the timeline through the API, quote AND event ──

class TimelineEntryApiTests(TestCase):
    """AC1, AC2, AC7 — the same nested field on both kinds of booking."""

    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.account = make_account(org=self.org)
        self.contact = make_contact(account=self.account, org=self.org)

    # -- quote --

    def _create_quote(self, entries):
        return self.client.post('/api/bookings/quotes/', {
            'primary_contact': self.contact.id,
            'event_date': '2026-08-01', 'guest_count': 50,
            'event_type': 'wedding', 'price_per_head': '25.00',
            'timeline_entries': entries,
        }, format='json')

    def test_quote_create_persists_entries_in_order(self):
        resp = self._create_quote([
            {'time': '15:00', 'label': 'Staff arrive'},
            {'time': '17:00', 'label': 'Cocktails'},
            {'time': '18:30', 'label': 'Dinner service'},
        ])
        self.assertEqual(resp.status_code, 201, resp.content)
        rows = list(BookingTimelineEntry.objects.filter(quote_id=resp.json()['id']))
        self.assertEqual([r.label for r in rows],
                         ['Staff arrive', 'Cocktails', 'Dinner service'])
        self.assertEqual([r.sort_order for r in rows], [0, 1, 2])
        self.assertEqual(rows[1].time, datetime.time(17, 0))

    def test_quote_detail_returns_entries(self):
        quote_id = self._create_quote([{'time': '18:30', 'label': 'Dinner'}]).json()['id']
        data = self.client.get(f'/api/bookings/quotes/{quote_id}/').json()
        self.assertEqual([(e['time'], e['label']) for e in data['timeline_entries']],
                         [('18:30:00', 'Dinner')])

    def test_quote_reorder_persists(self):
        quote_id = self._create_quote([
            {'time': '17:00', 'label': 'Cocktails'},
            {'time': '18:30', 'label': 'Dinner'},
        ]).json()['id']
        resp = self.client.patch(f'/api/bookings/quotes/{quote_id}/', {
            'timeline_entries': [
                {'time': '18:30', 'label': 'Dinner'},
                {'time': '17:00', 'label': 'Cocktails'},
            ],
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(
            [e['label'] for e in
             self.client.get(f'/api/bookings/quotes/{quote_id}/').json()['timeline_entries']],
            ['Dinner', 'Cocktails'],
        )

    def test_quote_remove_persists(self):
        quote_id = self._create_quote([
            {'time': '17:00', 'label': 'Cocktails'},
            {'time': '18:30', 'label': 'Dinner'},
        ]).json()['id']
        self.client.patch(f'/api/bookings/quotes/{quote_id}/', {
            'timeline_entries': [{'time': '18:30', 'label': 'Dinner'}],
        }, format='json')
        self.assertEqual(
            [e['label'] for e in
             self.client.get(f'/api/bookings/quotes/{quote_id}/').json()['timeline_entries']],
            ['Dinner'],
        )

    def test_clearing_the_timeline_falls_back_to_legacy(self):
        quote_id = self._create_quote([{'time': '18:30', 'label': 'Dinner'}]).json()['id']
        self.client.patch(f'/api/bookings/quotes/{quote_id}/',
                          {'timeline_entries': []}, format='json')
        self.assertEqual(
            self.client.get(f'/api/bookings/quotes/{quote_id}/').json()['timeline_entries'], [])

    def test_a_step_with_no_label_yet_saves(self):
        # Regression: `label` inherited allow_blank=False, so the very first click
        # on "+ Build a run-of-show" (which creates a blank-label row) 400'd the
        # WHOLE save — menu, totals and all — with an unattributed
        # "This field may not be blank."
        resp = self._create_quote([{'time': '17:00', 'label': ''}])
        self.assertEqual(resp.status_code, 201, resp.content)
        entry = BookingTimelineEntry.objects.get(quote_id=resp.json()['id'])
        self.assertEqual(entry.label, '')
        self.assertEqual(entry.time, datetime.time(17, 0))

    def test_a_step_with_no_label_saves_on_an_event_too(self):
        resp = self._create_event([{'time': '17:00', 'label': ''}])
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(
            BookingTimelineEntry.objects.get(event_id=resp.json()['id']).label, '')

    def test_omitting_the_field_leaves_existing_entries_alone(self):
        # A partial save from a screen that doesn't own the timeline must not
        # silently wipe it.
        quote_id = self._create_quote([{'time': '18:30', 'label': 'Dinner'}]).json()['id']
        self.client.patch(f'/api/bookings/quotes/{quote_id}/',
                          {'guest_count': 60}, format='json')
        self.assertEqual(
            len(self.client.get(f'/api/bookings/quotes/{quote_id}/').json()['timeline_entries']), 1)

    # -- event (the mirror) --

    def _create_event(self, entries):
        return self.client.post('/api/events/', {
            'name': 'Khan Wedding', 'date': '2026-08-01',
            'primary_contact': self.contact.id, 'guest_count': 50,
            'event_type': 'wedding', 'price_per_head': '25.00',
            'timeline_entries': entries,
        }, format='json')

    def test_event_create_persists_entries_in_order(self):
        resp = self._create_event([
            {'time': '15:00', 'label': 'Staff arrive'},
            {'time': '18:30', 'label': 'Dinner service'},
        ])
        self.assertEqual(resp.status_code, 201, resp.content)
        rows = list(BookingTimelineEntry.objects.filter(event_id=resp.json()['id']))
        self.assertEqual([r.label for r in rows], ['Staff arrive', 'Dinner service'])
        self.assertEqual([r.sort_order for r in rows], [0, 1])

    def test_event_detail_returns_entries(self):
        event_id = self._create_event([{'time': '18:30', 'label': 'Dinner'}]).json()['id']
        data = self.client.get(f'/api/events/{event_id}/').json()
        self.assertEqual([(e['time'], e['label']) for e in data['timeline_entries']],
                         [('18:30:00', 'Dinner')])

    def test_event_reorder_and_remove_persist(self):
        event_id = self._create_event([
            {'time': '17:00', 'label': 'Cocktails'},
            {'time': '18:30', 'label': 'Dinner'},
            {'time': '21:00', 'label': 'Cake'},
        ]).json()['id']
        resp = self.client.patch(f'/api/events/{event_id}/', {
            'timeline_entries': [
                {'time': '21:00', 'label': 'Cake'},
                {'time': '17:00', 'label': 'Cocktails'},
            ],
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(
            [e['label'] for e in
             self.client.get(f'/api/events/{event_id}/').json()['timeline_entries']],
            ['Cake', 'Cocktails'],
        )

    def test_entries_belong_to_exactly_one_booking(self):
        from django.db import IntegrityError, transaction
        quote = make_quote(org=self.org, primary_contact=self.contact)
        event = Event.objects.create(organisation=self.org, name='E',
                                     event_date=datetime.date(2026, 8, 1), guest_count=10)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                BookingTimelineEntry.objects.create(
                    quote=quote, event=event, time=datetime.time(18, 0), label='Both')


# ── AC7 — the timeline survives quote → event conversion ────────────────────

class TimelineConversionTests(TestCase):
    def test_accepting_a_quote_copies_its_run_of_show_to_the_event(self):
        from bookings.services.quote_acceptance import accept_quote
        user = get_test_user()
        org = user.organisation
        quote = make_quote(org=org, primary_contact=make_contact(org=org),
                           guest_count=20, price_per_head=Decimal('30'))
        BookingTimelineEntry.objects.create(quote=quote, time=datetime.time(15, 0),
                                            label='Staff arrive', sort_order=0)
        BookingTimelineEntry.objects.create(quote=quote, time=datetime.time(18, 30),
                                            label='Dinner service', sort_order=1)
        event = accept_quote(quote, user)
        self.assertEqual([(e.time, e.label) for e in event.timeline_entries.all()],
                         [(datetime.time(15, 0), 'Staff arrive'),
                          (datetime.time(18, 30), 'Dinner service')])
        # A copy, not a move — the quote is still a faithful record of what was sold.
        self.assertEqual(quote.timeline_entries.count(), 2)

    def test_a_quote_with_no_entries_converts_with_none(self):
        from bookings.services.quote_acceptance import accept_quote
        user = get_test_user()
        org = user.organisation
        quote = make_quote(org=org, primary_contact=make_contact(org=org, name='No TL'),
                           guest_count=20, price_per_head=Decimal('30'),
                           setup_time=_dt(15), meal_time=_dt(19))
        event = accept_quote(quote, user)
        self.assertEqual(event.timeline_entries.count(), 0)
        # The legacy slots still carry across, exactly as before.
        self.assertEqual(event.setup_time, _dt(15))


# ── AC3 / AC4 / AC5 — what renders ──────────────────────────────────────────

class TimelineRenderTests(TestCase):
    """AC3: no entries ⇒ the four legacy slots, unchanged.
       AC4: any entries ⇒ the entries, instead.
       AC5: an existing booking has no entries and is never migrated."""

    def setUp(self):
        self.org = _make_org(slug='tl-render')
        self.contact = make_contact(org=self.org)
        self.quote = make_quote(org=self.org, primary_contact=self.contact,
                                guest_count=10, price_per_head=Decimal('20'),
                                setup_time=_dt(15), guest_arrival_time=_dt(17),
                                meal_time=_dt(19), end_time=_dt(23))
        self.quote.recalculate_totals()
        self.quote.refresh_from_db()

    def test_existing_booking_has_no_entries(self):
        # AC5 — nothing back-filled them; the four columns are all it has.
        self.assertEqual(self.quote.timeline_entries.count(), 0)

    def test_presentation_falls_back_to_the_four_legacy_slots(self):
        pres = booking_presentation(self.quote)
        self.assertEqual([t['label'] for t in pres['timeline']],
                         ['Setup', 'Guest arrival', 'Meal service', 'End'])
        # Legacy slots keep their full ISO datetime and no pre-formatted string,
        # so the sign page renders them exactly as it always has.
        self.assertTrue(pres['timeline'][0]['time'].startswith('2026-08-01T15:00'))
        self.assertIsNone(pres['timeline'][0]['time_display'])

    def test_presentation_uses_entries_instead_when_present(self):
        BookingTimelineEntry.objects.create(quote=self.quote, time=datetime.time(17, 0),
                                            label='Cocktail hour', sort_order=0)
        BookingTimelineEntry.objects.create(quote=self.quote, time=datetime.time(18, 30),
                                            label='Dinner service', sort_order=1)
        pres = booking_presentation(self.quote)
        self.assertEqual([t['label'] for t in pres['timeline']],
                         ['Cocktail hour', 'Dinner service'])
        # The four legacy labels are gone — not merged in alongside.
        self.assertNotIn('Setup', [t['label'] for t in pres['timeline']])
        # Entries carry a pre-formatted time (a bare time isn't a parseable date).
        self.assertEqual(pres['timeline'][0]['time_display'], '17:00')

    def test_entry_times_honour_the_orgs_12h_preference(self):
        st = OrgSettings.for_org(self.org)
        st.time_format = '12h'
        st.save()
        BookingTimelineEntry.objects.create(quote=self.quote, time=datetime.time(18, 30),
                                            label='Dinner', sort_order=0)
        pres = booking_presentation(self.quote)
        # Unpadded hour, matching the frontend's formatTime — otherwise the sign
        # page would say "06:30 PM" for the entry the app shows as "6:30 PM".
        self.assertEqual(pres['timeline'][0]['time_display'], '6:30 PM')

    def test_morning_entry_times_are_not_zero_padded_in_12h(self):
        st = OrgSettings.for_org(self.org)
        st.time_format = '12h'
        st.save()
        BookingTimelineEntry.objects.create(quote=self.quote, time=datetime.time(9, 0),
                                            label='Load in', sort_order=0)
        self.assertEqual(booking_presentation(self.quote)['timeline'][0]['time_display'],
                         '9:00 AM')

    def test_sign_page_payload_shows_entries(self):
        from bookings.views.public_sign import serialize_public_booking
        BookingTimelineEntry.objects.create(quote=self.quote, time=datetime.time(21, 0),
                                            label='Cake cutting', sort_order=0)
        payload = serialize_public_booking(self.quote)
        self.assertEqual([t['label'] for t in payload['timeline']], ['Cake cutting'])


class TimelineQuotePDFTests(TestCase):
    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest('pypdf not installed')
        self.org = _make_org(slug='tl-quote-pdf')
        self.quote = make_quote(org=self.org, primary_contact=make_contact(org=self.org),
                                guest_count=10, price_per_head=Decimal('20'),
                                setup_time=_dt(15), meal_time=_dt(19))
        self.quote.recalculate_totals()
        self.quote.refresh_from_db()

    def test_legacy_slots_render_exactly_as_before(self):
        # AC3 — the wording and the full date+time are unchanged.
        text = pdf_text(generate_quote_pdf(self.quote)).replace('\n', ' ')
        self.assertIn('TIMELINE', text)
        self.assertIn('Setup Time:', text)
        self.assertIn('01 Aug 2026, 15:00', text)

    def test_entries_replace_the_legacy_slots(self):
        # AC4 — the run-of-show is what the customer sees, times only.
        BookingTimelineEntry.objects.create(quote=self.quote, time=datetime.time(17, 0),
                                            label='Cocktail hour', sort_order=0)
        BookingTimelineEntry.objects.create(quote=self.quote, time=datetime.time(18, 30),
                                            label='Dinner service', sort_order=1)
        text = pdf_text(generate_quote_pdf(self.quote)).replace('\n', ' ')
        self.assertIn('TIMELINE', text)
        self.assertIn('Cocktail hour', text)
        self.assertIn('18:30', text)
        self.assertNotIn('Setup Time:', text)
        self.assertLess(text.find('Cocktail hour'), text.find('Dinner service'))

    def test_no_timeline_section_with_neither(self):
        q = make_quote(org=self.org, primary_contact=make_contact(org=self.org, name='B'),
                       guest_count=10, price_per_head=Decimal('20'))
        q.recalculate_totals()
        q.refresh_from_db()
        self.assertNotIn('TIMELINE', pdf_text(generate_quote_pdf(q)))


class TimelineEventPDFTests(TestCase):
    """The event mirror — the ops team's function sheet must follow the same rule."""

    def setUp(self):
        if not HAVE_PYPDF:
            self.skipTest('pypdf not installed')
        self.org = _make_org(slug='tl-event-pdf')
        self.event = Event.objects.create(
            organisation=self.org, name='Khan Wedding',
            event_date=datetime.date(2026, 8, 1), guest_count=50,
            price_per_head=Decimal('40'), status='confirmed',
            setup_time=_dt(15), meal_time=_dt(19),
        )
        BookingLineItem.objects.create(
            event=self.event, category='labor', description='Waiters',
            quantity=Decimal('2'), unit='each', unit_price=Decimal('100'))
        self.event.recalculate_totals()

    def test_legacy_slots_render_exactly_as_before(self):
        text = pdf_text(generate_event_pdf(self.event)).replace('\n', ' ')
        self.assertIn('Setup Time:', text)
        self.assertIn('01 Aug 2026, 15:00', text)

    def test_entries_replace_the_legacy_slots(self):
        BookingTimelineEntry.objects.create(event=self.event, time=datetime.time(15, 0),
                                            label='Staff arrive', sort_order=0)
        BookingTimelineEntry.objects.create(event=self.event, time=datetime.time(21, 0),
                                            label='Cake cutting', sort_order=1)
        text = pdf_text(generate_event_pdf(self.event)).replace('\n', ' ')
        self.assertIn('Staff arrive', text)
        self.assertIn('Cake cutting', text)
        self.assertNotIn('Setup Time:', text)
        self.assertLess(text.find('Staff arrive'), text.find('Cake cutting'))


# ── Org isolation ───────────────────────────────────────────────────────────

class TimelineOrgScopingTests(TestCase):
    def test_an_org_cannot_read_another_orgs_timeline(self):
        user = get_test_user()
        other = _make_org(name='Other Co', slug='other-tl-co')
        event = Event.objects.create(organisation=other, name='Theirs',
                                     event_date=datetime.date(2026, 8, 1), guest_count=10)
        BookingTimelineEntry.objects.create(event=event, time=datetime.time(18, 0),
                                            label='Secret dinner', sort_order=0)
        client = APIClient()
        client.force_authenticate(user=user)
        self.assertEqual(client.get(f'/api/events/{event.id}/').status_code, 404)
