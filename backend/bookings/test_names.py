"""Name splitting/composition: the two-word rule, save-sync, and the backfill."""
from django.test import TestCase

from bookings.models import Contact, Lead
from bookings.names import compose_full_name, split_full_name
from tests.base import get_test_user


class SplitComposeTests(TestCase):
    def test_two_word_names_split(self):
        self.assertEqual(split_full_name('Batool Rizvi'), ('Batool', 'Rizvi'))

    def test_last_word_is_the_surname(self):
        self.assertEqual(split_full_name('Batool Rizvi Khan'), ('Batool Rizvi', 'Khan'))

    def test_single_word_is_a_first_name(self):
        self.assertEqual(split_full_name('Batool'), ('Batool', ''))

    def test_empty_shapes(self):
        self.assertEqual(split_full_name(''), ('', ''))
        self.assertEqual(split_full_name(None), ('', ''))

    def test_compose_joins_available_parts(self):
        self.assertEqual(compose_full_name('Batool', 'Rizvi'), 'Batool Rizvi')
        self.assertEqual(compose_full_name('Batool', ''), 'Batool')
        self.assertEqual(compose_full_name('', ''), '')


class LeadNameSyncTests(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation

    def test_parts_compose_the_display_name(self):
        lead = Lead.objects.create(
            organisation=self.org, contact_first_name='Batool',
            contact_last_name='Rizvi', status='new',
        )
        self.assertEqual(lead.contact_name, 'Batool Rizvi')

    def test_two_word_name_fills_the_parts(self):
        lead = Lead.objects.create(
            organisation=self.org, contact_name='Sam Jones', status='new',
        )
        self.assertEqual((lead.contact_first_name, lead.contact_last_name), ('Sam', 'Jones'))

    def test_three_word_name_splits_before_last_word(self):
        lead = Lead.objects.create(
            organisation=self.org, contact_name='Batool Rizvi Khan', status='new',
        )
        self.assertEqual(lead.contact_name, 'Batool Rizvi Khan')
        self.assertEqual((lead.contact_first_name, lead.contact_last_name), ('Batool Rizvi', 'Khan'))


class ContactNameSyncTests(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation

    def test_contact_same_rules(self):
        c = Contact.objects.create(organisation=self.org, first_name='Ada', last_name='Khan')
        self.assertEqual(c.name, 'Ada Khan')
        c2 = Contact.objects.create(organisation=self.org, name='Grace Hopper')
        self.assertEqual((c2.first_name, c2.last_name), ('Grace', 'Hopper'))


class BackfillMigrationTests(TestCase):
    def test_backfill_splits_all_multiword_names(self):
        import importlib
        from django.apps import apps as django_apps
        org = get_test_user().organisation
        # Bypass save() to simulate pre-migration rows
        two = Lead.objects.create(organisation=org, contact_name='placeholder', status='new')
        Lead.objects.filter(pk=two.pk).update(
            contact_name='Two Words', contact_first_name='', contact_last_name='')
        three = Lead.objects.create(organisation=org, contact_name='placeholder', status='new')
        Lead.objects.filter(pk=three.pk).update(
            contact_name='Three Word Name', contact_first_name='', contact_last_name='')

        mod = importlib.import_module('bookings.migrations.0062_split_existing_names')
        mod.split_two_word_names(django_apps, None)

        two.refresh_from_db(); three.refresh_from_db()
        self.assertEqual((two.contact_first_name, two.contact_last_name), ('Two', 'Words'))
        self.assertEqual((three.contact_first_name, three.contact_last_name), ('Three Word', 'Name'))
