"""Phone normalization: the inference rules and the save hooks."""
from django.test import TestCase

from bookings.models import Contact, Lead, OrgSettings
from bookings.phones import normalize_phone
from tests.base import get_test_user


class NormalizeRuleTests(TestCase):
    def test_domestic_leading_zero_gets_the_org_dial_code(self):
        self.assertEqual(normalize_phone('03001269792', 'PK'), '+923001269792')

    def test_bare_national_number_gets_the_dial_code(self):
        self.assertEqual(normalize_phone('3001269792', 'PK'), '+923001269792')
        self.assertEqual(normalize_phone('4155551234', 'US'), '+14155551234')

    def test_declared_country_code_wins_over_org_country(self):
        self.assertEqual(normalize_phone('+44 7911 123456', 'PK'), '+447911123456')
        self.assertEqual(normalize_phone('00447911123456', 'PK'), '+447911123456')

    def test_formatting_noise_is_stripped(self):
        self.assertEqual(normalize_phone('0300-126 (9792)', 'PK'), '+923001269792')

    def test_junk_is_left_untouched(self):
        self.assertEqual(normalize_phone('000', 'PK'), '000')
        self.assertEqual(normalize_phone('call after 5', 'PK'), 'call after 5')
        self.assertEqual(normalize_phone('', 'PK'), '')

    def test_unknown_org_country_leaves_domestic_numbers_alone(self):
        self.assertEqual(normalize_phone('03001269792', 'XX'), '03001269792')


class SaveHookTests(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        self.org.country = 'PK'
        self.org.save()

    def test_lead_phone_normalized_on_save(self):
        lead = Lead.objects.create(
            organisation=self.org, contact_name='Sam Jones',
            contact_phone='0300 1269792', status='new',
        )
        self.assertEqual(lead.contact_phone, '+923001269792')

    def test_contact_phone_normalized_on_save(self):
        c = Contact.objects.create(
            organisation=self.org, name='Ada Khan', phone='03001269792',
        )
        self.assertEqual(c.phone, '+923001269792')

    def test_org_sender_number_normalized_on_save(self):
        s = OrgSettings.for_org(self.org)
        s.twilio_whatsapp_number = '0300 000 0000'
        s.save()
        self.assertEqual(s.twilio_whatsapp_number, '+923000000000')

    def test_migration_backfills(self):
        import importlib
        from django.apps import apps as django_apps
        lead = Lead.objects.create(
            organisation=self.org, contact_name='Old Row', status='new',
        )
        Lead.objects.filter(pk=lead.pk).update(contact_phone='03334455667')
        mod = importlib.import_module('bookings.migrations.0065_normalize_phone_numbers')
        mod.normalize_existing(django_apps, None)
        lead.refresh_from_db()
        self.assertEqual(lead.contact_phone, '+923334455667')
