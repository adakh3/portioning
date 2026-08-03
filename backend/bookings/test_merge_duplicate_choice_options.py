"""Merging the duplicate choice options existing orgs inherited (REL-435).

The seeding bug is fixed for NEW orgs (see `users/test_choice_option_seeding.py`),
but every org created while both seeders ran still carries duplicate rows —
"Family Style" as both `family` and `family_style`, "Drop-off / Delivery" as both
`drop_off` and `dropoff`, "Holiday Party" as both `holiday` and `holiday_party` —
with real bookings, leads and staffing rules pointing at either slug.

`merge_duplicate_choice_options` repairs those. What matters most here is what it
REFUSES to touch: the command rewrites live customer data, so every guard against
over-reach is pinned below.
"""
from datetime import date
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from bookings.models import Contact
from bookings.models.choices import EventTypeOption, ServiceStyleOption
from bookings.models.leads import Lead
from bookings.models.quotes import Quote
from events.models import Event
from staff.models import AllocationRule, LaborRole
from users.models import Organisation


def run(apply=False, org=None):
    """Run the command, returning its output."""
    out = StringIO()
    args = []
    if apply:
        args.append('--apply')
    if org:
        args += ['--org', org]
    call_command('merge_duplicate_choice_options', *args, stdout=out, stderr=out)
    return out.getvalue()


class MergeDuplicateChoiceOptionsTests(TestCase):
    def setUp(self):
        # The post_save signal seeds defaults.py's slugs (family / dropoff /
        # holiday_party). Add the old catalog seeder's rival slugs by hand to
        # recreate an org from the double-seeding window.
        self.org = Organisation.objects.create(name='Legacy Co', slug='legacy-co')
        self.legacy_family = ServiceStyleOption.objects.create(
            organisation=self.org, value='family_style', label='Family Style', sort_order=3)
        self.legacy_dropoff = ServiceStyleOption.objects.create(
            organisation=self.org, value='drop_off', label='Drop-off / Delivery', sort_order=4)
        self.legacy_holiday = EventTypeOption.objects.create(
            organisation=self.org, value='holiday', label='Holiday Party', sort_order=4)
        # A catalog-only option that is NOT a duplicate — nothing in defaults.py
        # shares its label, so it is this org's real option.
        self.private_dinner = EventTypeOption.objects.create(
            organisation=self.org, value='private_dinner', label='Private Dinner', sort_order=5)

        self.contact = Contact.objects.create(organisation=self.org, name='Client')

        # The canonical rows come from the org-creation signal. Assert them, or a
        # change to that seeding would make the merge tests pass VACUOUSLY —
        # nothing to merge trivially satisfies every "left alone" assertion.
        for model, value in (
            (ServiceStyleOption, 'family'), (ServiceStyleOption, 'dropoff'),
            (EventTypeOption, 'holiday_party'),
        ):
            self.assertTrue(
                model.objects.filter(organisation=self.org, value=value).exists(),
                f'fixture assumes the org signal seeds {value!r}',
            )

    def _quote(self, **kw):
        return Quote.objects.create(
            organisation=self.org, primary_contact=self.contact,
            event_date=date(2026, 9, 1), guest_count=50, **kw)

    def _event(self, **kw):
        return Event.objects.create(
            organisation=self.org, name='Party', event_date=date(2026, 9, 1), **kw)

    def _lead(self, **kw):
        return Lead.objects.create(organisation=self.org, contact_name='Lead', **kw)

    def _rule(self, **kw):
        role = LaborRole.objects.create(
            organisation=self.org, name='Server', default_hourly_rate=Decimal('20'))
        return AllocationRule.objects.create(
            organisation=self.org, role=role, guests_per_staff=30, **kw)

    # ── The merge itself ──────────────────────────────────────────────────────

    def test_the_duplicate_row_is_removed_and_the_defaults_slug_survives(self):
        run(apply=True)
        values = set(ServiceStyleOption.objects.filter(organisation=self.org)
                     .values_list('value', flat=True))
        self.assertNotIn('family_style', values)
        self.assertNotIn('drop_off', values)
        self.assertIn('family', values)      # bookings/defaults.py owns the slug
        self.assertIn('dropoff', values)

        event_values = set(EventTypeOption.objects.filter(organisation=self.org)
                           .values_list('value', flat=True))
        self.assertNotIn('holiday', event_values)
        self.assertIn('holiday_party', event_values)

    def test_the_label_appears_exactly_once_afterwards(self):
        run(apply=True)
        labels = list(ServiceStyleOption.objects.filter(organisation=self.org)
                      .values_list('label', flat=True))
        self.assertEqual(labels.count('Family Style'), 1)
        self.assertEqual(labels.count('Drop-off / Delivery'), 1)

    def test_bookings_leads_and_staffing_rules_are_all_repointed(self):
        # The whole point: nothing may be left pointing at a deleted option.
        quote = self._quote(service_style='family_style', event_type='holiday')
        event = self._event(service_style='drop_off', event_type='holiday')
        lead = self._lead(service_style='family_style', event_type='holiday')
        rule = self._rule(event_type='holiday')

        run(apply=True)

        quote.refresh_from_db(); event.refresh_from_db()
        lead.refresh_from_db(); rule.refresh_from_db()
        self.assertEqual(quote.service_style, 'family')
        self.assertEqual(quote.event_type, 'holiday_party')
        self.assertEqual(event.service_style, 'dropoff')
        self.assertEqual(event.event_type, 'holiday_party')
        self.assertEqual(lead.service_style, 'family')
        self.assertEqual(lead.event_type, 'holiday_party')
        self.assertEqual(rule.event_type, 'holiday_party')

    def test_no_booking_is_left_on_a_slug_with_no_option_row(self):
        # The failure this command exists to prevent, asserted directly.
        self._quote(service_style='family_style', event_type='holiday')
        self._event(service_style='drop_off')
        run(apply=True)

        styles = set(ServiceStyleOption.objects.filter(organisation=self.org)
                     .values_list('value', flat=True))
        types = set(EventTypeOption.objects.filter(organisation=self.org)
                    .values_list('value', flat=True))
        for q in Quote.objects.filter(organisation=self.org):
            self.assertIn(q.service_style, styles)
            self.assertIn(q.event_type, types)
        for e in Event.objects.filter(organisation=self.org):
            if e.service_style:
                self.assertIn(e.service_style, styles)

    def test_bookings_already_on_the_canonical_slug_are_untouched(self):
        quote = self._quote(service_style='family', event_type='holiday_party')
        run(apply=True)
        quote.refresh_from_db()
        self.assertEqual(quote.service_style, 'family')
        self.assertEqual(quote.event_type, 'holiday_party')

    # ── What it must NOT do ───────────────────────────────────────────────────

    def test_dry_run_is_the_default_and_writes_nothing(self):
        quote = self._quote(service_style='family_style')
        out = run()                      # no --apply

        self.assertIn('DRY RUN', out)
        quote.refresh_from_db()
        self.assertEqual(quote.service_style, 'family_style', 'dry run rewrote a booking')
        self.assertTrue(
            ServiceStyleOption.objects.filter(organisation=self.org, value='family_style').exists(),
            'dry run deleted an option row',
        )

    def test_an_org_with_only_the_legacy_slug_is_left_alone(self):
        # A real org in the dev DB looks exactly like this: `family_style` and no
        # `family`. That is not a duplicate — it is the org's own option, and
        # renaming it to a slug they never used would silently rewrite live data.
        other = Organisation.objects.create(name='Solo Co', slug='solo-co')
        ServiceStyleOption.objects.filter(organisation=other, value='family').delete()
        ServiceStyleOption.objects.create(
            organisation=other, value='family_style', label='Family Style')
        contact = Contact.objects.create(organisation=other, name='C')
        quote = Quote.objects.create(
            organisation=other, primary_contact=contact,
            event_date=date(2026, 9, 1), guest_count=10, service_style='family_style')

        run(apply=True)

        quote.refresh_from_db()
        self.assertEqual(quote.service_style, 'family_style')
        self.assertTrue(
            ServiceStyleOption.objects.filter(organisation=other, value='family_style').exists())

    def test_a_renamed_duplicate_is_left_alone(self):
        # Once an org edits one of the two, they are no longer the same thing.
        # Merging would destroy a deliberate distinction.
        self.legacy_family.label = 'Family Style (shared platters)'
        self.legacy_family.save()

        out = run(apply=True)

        self.assertTrue(
            ServiceStyleOption.objects.filter(organisation=self.org, value='family_style').exists(),
            'merged two options the org had deliberately made different',
        )
        self.assertIn('no longer share a label', out)

    def test_a_catalog_only_option_is_never_removed(self):
        run(apply=True)
        self.assertTrue(
            EventTypeOption.objects.filter(organisation=self.org, value='private_dinner').exists(),
            '"Private Dinner" is not a duplicate — it exists in only one seeder',
        )

    def test_another_org_is_not_touched(self):
        other = Organisation.objects.create(name='Other Co', slug='other-co')
        ServiceStyleOption.objects.create(
            organisation=other, value='family_style', label='Family Style')
        contact = Contact.objects.create(organisation=other, name='C')
        quote = Quote.objects.create(
            organisation=other, primary_contact=contact,
            event_date=date(2026, 9, 1), guest_count=10, service_style='family_style')

        run(apply=True, org='Legacy Co')

        quote.refresh_from_db()
        self.assertEqual(quote.service_style, 'family_style', 'crossed an org boundary')
        self.assertTrue(
            ServiceStyleOption.objects.filter(organisation=other, value='family_style').exists())

    # ── Behaviour of the surviving row ────────────────────────────────────────

    def test_the_option_stays_visible_if_either_copy_was_active(self):
        # An org that hid one copy and kept using the other must not lose the
        # option entirely when the two are merged.
        ServiceStyleOption.objects.filter(
            organisation=self.org, value='family').update(is_active=False)

        run(apply=True)

        survivor = ServiceStyleOption.objects.get(organisation=self.org, value='family')
        self.assertTrue(survivor.is_active)

    def test_the_survivor_keeps_the_earlier_position(self):
        # So the entry doesn't appear to jump down the dropdown after the merge.
        ServiceStyleOption.objects.filter(
            organisation=self.org, value='dropoff').update(sort_order=9)
        self.legacy_dropoff.sort_order = 4
        self.legacy_dropoff.save()

        run(apply=True)

        survivor = ServiceStyleOption.objects.get(organisation=self.org, value='dropoff')
        self.assertEqual(survivor.sort_order, 4)

    # ── Safe to run twice ─────────────────────────────────────────────────────

    def test_running_twice_changes_nothing_the_second_time(self):
        quote = self._quote(service_style='family_style')
        run(apply=True)
        after_first = list(ServiceStyleOption.objects.filter(organisation=self.org)
                           .order_by('value').values_list('value', 'label', 'sort_order'))

        run(apply=True)

        after_second = list(ServiceStyleOption.objects.filter(organisation=self.org)
                            .order_by('value').values_list('value', 'label', 'sort_order'))
        self.assertEqual(after_first, after_second)
        quote.refresh_from_db()
        self.assertEqual(quote.service_style, 'family')

    def test_it_reports_unknown_duplicates_without_merging_them(self):
        # Two options an org may have created itself: surfaced, never guessed at.
        ServiceStyleOption.objects.create(
            organisation=self.org, value='buffet_style', label='Buffet')

        out = run(apply=True)

        # Once, not once per pair sharing that choice type.
        self.assertEqual(out.count('not a known pair'), 1)
        self.assertTrue(
            ServiceStyleOption.objects.filter(organisation=self.org, value='buffet_style').exists())

    # ── Rows already stranded before the merge ────────────────────────────────

    def test_a_booking_on_a_deleted_option_is_reported_not_ignored(self):
        # Reachable in prod today: the choice-option manage endpoints have no
        # in-use guard, so an org can delete "Family Style" while bookings still
        # point at it. There is no duplicate left for the merge to key off, so
        # without an explicit report the run says "0 merged" and reads as clean.
        ServiceStyleOption.objects.filter(
            organisation=self.org, value__in=['family', 'family_style']).delete()
        quote = self._quote(service_style='family_style')

        out = run(apply=True)

        self.assertIn('family_style', out)
        self.assertIn('no option row', out)
        quote.refresh_from_db()
        self.assertEqual(quote.service_style, 'family_style', 'must report, not rewrite')

    def test_a_clean_org_reports_nothing_stranded(self):
        # The other direction: the warning must not cry wolf on healthy data.
        self._quote(service_style='family_style', event_type='holiday')
        out = run(apply=True)
        self.assertNotIn('no option row', out)

    def test_a_blank_choice_is_not_reported_as_stranded(self):
        self._quote(service_style='', event_type='')
        out = run(apply=True)
        self.assertNotIn('no option row', out)

    # ── Ambiguous --org ───────────────────────────────────────────────────────

    def test_an_ambiguous_org_name_is_refused_rather_than_guessed(self):
        # Organisation.name is not unique. Picking one silently would rewrite one
        # org and quietly leave its namesake broken.
        Organisation.objects.create(name='Legacy Co', slug='legacy-co-2')
        with self.assertRaises(CommandError) as ctx:
            run(apply=True, org='Legacy Co')
        self.assertIn('Re-run with --org <id>', str(ctx.exception))

    def test_an_ambiguous_name_can_still_be_resolved_by_id(self):
        Organisation.objects.create(name='Legacy Co', slug='legacy-co-2')
        run(apply=True, org=str(self.org.pk))
        self.assertFalse(
            ServiceStyleOption.objects.filter(organisation=self.org, value='family_style').exists())

    # ── Staffing rules that collide after the merge ───────────────────────────

    def test_it_warns_when_the_merge_collides_two_staffing_rules(self):
        # AllocationRule has no uniqueness on (role, event_type), so a role with
        # a rule under each slug ends up with two for the same event type.
        role = LaborRole.objects.create(
            organisation=self.org, name='Server', default_hourly_rate=Decimal('20'))
        AllocationRule.objects.create(
            organisation=self.org, role=role, guests_per_staff=30, event_type='holiday')
        AllocationRule.objects.create(
            organisation=self.org, role=role, guests_per_staff=50, event_type='holiday_party')

        out = run(apply=True)

        self.assertIn('staffing rules', out)
        self.assertEqual(
            AllocationRule.objects.filter(
                organisation=self.org, role=role, event_type='holiday_party').count(),
            2, 'rules must be reported, never silently merged — that would be guessing',
        )
