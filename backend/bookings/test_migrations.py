"""Data-migration test for the person-first flip (bookings.0035 / events.0017).

The normal suite builds the test DB straight at the latest migration, so the
backfill never runs on real rows. This drives the migration on synthetic
old-shape data (individual + company accounts, a quote/event with no contact)
and asserts the backfill: every contact gets an org, B2C individual accounts
collapse to a customer-only booking, and B2B company bookings keep their account.
"""
from datetime import date

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class TestPersonFirstBackfill(TransactionTestCase):
    migrate_from = [
        ('bookings', '0034_alter_lead_source'),
        ('events', '0016_merge_0008_event_product_0015_perf_indexes'),
    ]
    migrate_to = [
        ('bookings', '0035_person_first_bookings'),
        ('events', '0017_event_is_b2b_person_first'),
    ]

    def _migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        # Leave the DB at the latest migration for the rest of the suite.
        self._migrate(self.migrate_to)

    def test_backfill(self):
        old = self._migrate(self.migrate_from)
        Org = old.get_model('users', 'Organisation')
        Account = old.get_model('bookings', 'Account')
        Quote = old.get_model('bookings', 'Quote')
        Event = old.get_model('events', 'Event')

        org = Org.objects.create(name='MigOrg', slug='mig-org', country='PK')
        indiv = Account.objects.create(organisation=org, name='Jane Person', account_type='individual')
        company = Account.objects.create(organisation=org, name='Acme Ltd', account_type='company')

        q_b2c = Quote.objects.create(organisation=org, account=indiv,
                                     event_date=date(2026, 9, 1), guest_count=10)
        q_b2b = Quote.objects.create(organisation=org, account=company,
                                     event_date=date(2026, 9, 1), guest_count=10)
        e_b2c = Event.objects.create(organisation=org, account=indiv, name='E1',
                                     date=date(2026, 9, 1), gents=5, ladies=5)

        new = self._migrate(self.migrate_to)
        Quote2 = new.get_model('bookings', 'Quote')
        Event2 = new.get_model('events', 'Event')
        Contact2 = new.get_model('bookings', 'Contact')

        qb2c = Quote2.objects.get(pk=q_b2c.pk)
        self.assertFalse(qb2c.is_b2b)
        self.assertIsNone(qb2c.account_id)            # individual account collapsed
        self.assertIsNotNone(qb2c.primary_contact_id)  # customer backfilled

        qb2b = Quote2.objects.get(pk=q_b2b.pk)
        self.assertTrue(qb2b.is_b2b)
        self.assertEqual(qb2b.account_id, company.pk)  # company kept
        self.assertIsNotNone(qb2b.primary_contact_id)

        eb2c = Event2.objects.get(pk=e_b2c.pk)
        self.assertFalse(eb2c.is_b2b)
        self.assertIsNone(eb2c.account_id)
        self.assertIsNotNone(eb2c.primary_contact_id)

        # Every contact created during backfill is org-scoped.
        self.assertTrue(Contact2.objects.exists())
        self.assertFalse(Contact2.objects.filter(organisation__isnull=True).exists())
