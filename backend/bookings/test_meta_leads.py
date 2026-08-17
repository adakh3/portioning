"""Meta lead-ads ingestion: webhook → Graph fetch → Lead, with dedup (REL-507).

No real Meta app is contacted — the Graph client (`bookings.services.meta`) is
patched. The webhook is exercised end to end through the URL with real
`X-Hub-Signature-256` HMAC headers.
"""
import hashlib
import hmac
import json
from datetime import date
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from bookings.models import (
    ConnectedMetaPage, Lead, MetaAccountConnection, MetaWebhookEvent,
)
from bookings.models.activity import ActivityLog
from bookings.services import meta_leads
from bookings.services.leads import default_status_for
from payments.models import Subscription
from tests.base import get_test_user
from users.models import Organisation, User

WEBHOOK_URL = '/api/bookings/meta/webhook/'
CRON_URL = '/api/bookings/cron/sync-meta-leads/'

APP = dict(
    META_LEADS_ENABLED=True, META_APP_ID='app-id', META_APP_SECRET='app-secret',
    META_WEBHOOK_VERIFY_TOKEN='verify-me', CRON_SECRET='cron-secret',
)


def _sign(body: bytes, secret='app-secret') -> str:
    return 'sha256=' + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _leadgen_payload(page_id='PAGE1', leadgen_id='LEAD1'):
    return {
        'object': 'page',
        'entry': [{
            'id': page_id,
            'changes': [{
                'field': 'leadgen',
                'value': {
                    'leadgen_id': leadgen_id, 'page_id': page_id,
                    'form_id': 'FORM1', 'created_time': 1723800000,
                },
            }],
        }],
    }


def _lead_object(leadgen_id='LEAD1', platform='fb', email='jane@example.com',
                 phone='+15551234567'):
    field_data = [
        {'name': 'full_name', 'values': ['Jane Doe']},
        {'name': 'event_date', 'values': ['2026-12-01']},
    ]
    if email:
        field_data.append({'name': 'email', 'values': [email]})
    if phone:
        field_data.append({'name': 'phone_number', 'values': [phone]})
    return {
        'id': leadgen_id, 'created_time': '2026-08-16T10:00:00+0000',
        'platform': platform, 'field_data': field_data,
    }


def _connect_page(org, page_id='PAGE1'):
    conn = MetaAccountConnection(organisation=org)
    conn.user_access_token = 'user-token'
    conn.save()
    page = ConnectedMetaPage(organisation=org, connection=conn, page_id=page_id,
                             page_name='Vinci Events')
    page.page_access_token = 'page-token'
    page.save()
    return page


def _other_org():
    org = Organisation.objects.create(name='Rival', slug='rival', country='US')
    Subscription.objects.filter(organisation=org).update(comped=True)
    return org


def _post(client, payload, secret='app-secret', sign=True):
    body = json.dumps(payload).encode()
    extra = {'HTTP_X_HUB_SIGNATURE_256': _sign(body, secret)} if sign else {}
    return client.post(WEBHOOK_URL, data=body, content_type='application/json', **extra)


@override_settings(**APP)
class TestMetaWebhookHandshake(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_echoes_challenge_when_verify_token_matches(self):
        resp = self.client.get(WEBHOOK_URL, {
            'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me',
            'hub.challenge': '12345',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content.decode(), '12345')

    def test_rejects_a_bad_verify_token(self):
        resp = self.client.get(WEBHOOK_URL, {
            'hub.mode': 'subscribe', 'hub.verify_token': 'wrong',
            'hub.challenge': '12345',
        })
        self.assertEqual(resp.status_code, 403)


@override_settings(**APP)
class TestMetaWebhookSignature(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        _connect_page(self.org)
        self.client = APIClient()

    def test_a_bad_signature_is_rejected_and_nothing_is_stored(self):
        body = json.dumps(_leadgen_payload()).encode()
        resp = self.client.post(
            WEBHOOK_URL, data=body, content_type='application/json',
            HTTP_X_HUB_SIGNATURE_256='sha256=deadbeef',
        )
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(MetaWebhookEvent.objects.exists())
        self.assertFalse(Lead.objects.filter(meta_leadgen_id='LEAD1').exists())

    def test_a_missing_signature_is_rejected(self):
        resp = _post(self.client, _leadgen_payload(), sign=False)
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(MetaWebhookEvent.objects.exists())


@override_settings(**APP)
class TestMetaLeadIngestion(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.page = _connect_page(self.org)
        self.client = APIClient()

    @patch('bookings.services.meta.fetch_lead')
    def test_happy_path_creates_a_mapped_lead(self, fetch):
        """AC1."""
        fetch.return_value = _lead_object()
        resp = _post(self.client, _leadgen_payload())
        self.assertEqual(resp.status_code, 200)

        lead = Lead.objects.get(meta_leadgen_id='LEAD1')
        self.assertEqual(lead.organisation, self.org)
        self.assertEqual(lead.contact_name, 'Jane Doe')
        self.assertEqual(lead.contact_email, 'jane@example.com')
        self.assertIn('5551234567', lead.contact_phone)
        self.assertEqual(lead.source, 'facebook')
        self.assertEqual(lead.lead_date, date(2026, 8, 16))
        self.assertIn('2026-12-01', lead.notes)   # unmapped answer kept verbatim
        self.assertEqual(lead.status, default_status_for(self.org))
        # Activity log recorded.
        self.assertTrue(ActivityLog.objects.filter(action='created', object_id=lead.pk).exists())
        # Raw event persisted + marked processed.
        event = MetaWebhookEvent.objects.get(page_id='PAGE1')
        self.assertIsNotNone(event.processed_at)

    @patch('bookings.services.meta.fetch_lead')
    def test_instagram_platform_sets_the_instagram_source(self, fetch):
        fetch.return_value = _lead_object(platform='ig')
        _post(self.client, _leadgen_payload())
        self.assertEqual(Lead.objects.get(meta_leadgen_id='LEAD1').source, 'instagram')

    @patch('bookings.services.meta.fetch_lead')
    def test_a_repeated_leadgen_id_creates_exactly_one_lead(self, fetch):
        """AC2 — Meta retries the same event."""
        fetch.return_value = _lead_object()
        _post(self.client, _leadgen_payload())
        _post(self.client, _leadgen_payload())
        self.assertEqual(Lead.objects.filter(meta_leadgen_id='LEAD1').count(), 1)
        # The second delivery short-circuits before re-fetching.
        self.assertEqual(fetch.call_count, 1)

    @patch('bookings.services.meta.fetch_lead')
    def test_matching_open_lead_is_deduped_with_an_activity_not_a_duplicate(self, fetch):
        """AC3."""
        existing = Lead.objects.create(
            organisation=self.org, contact_name='Jane D',
            contact_email='jane@example.com', status=default_status_for(self.org) or 'new',
        )
        fetch.return_value = _lead_object()
        _post(self.client, _leadgen_payload())

        self.assertFalse(Lead.objects.filter(meta_leadgen_id='LEAD1').exists())
        self.assertEqual(Lead.objects.filter(contact_email='jane@example.com').count(), 1)
        self.assertTrue(ActivityLog.objects.filter(action='updated', object_id=existing.pk).exists())

    @patch('bookings.services.meta.fetch_lead')
    @patch('bookings.services.meta.list_form_leads')
    @patch('bookings.services.meta.list_lead_forms')
    def test_a_merged_submission_is_not_relogged_by_the_backfill(self, forms, form_leads, fetch):
        """Regression: the idempotency ledger must cover the merge path, or the
        hourly backfill re-logs a duplicate activity on the matched lead forever."""
        existing = Lead.objects.create(
            organisation=self.org, contact_name='Jane D',
            contact_email='jane@example.com', status=default_status_for(self.org) or 'new',
        )
        fetch.return_value = _lead_object()
        _post(self.client, _leadgen_payload())  # merges via webhook, logs one activity
        self.assertEqual(ActivityLog.objects.filter(action='updated', object_id=existing.pk).count(), 1)

        # The hourly sweep re-sees the very same submission.
        forms.return_value = ['FORM1']
        form_leads.return_value = [_lead_object()]
        meta_leads.backfill_all()

        # No second activity, no stray Lead.
        self.assertEqual(ActivityLog.objects.filter(action='updated', object_id=existing.pk).count(), 1)
        self.assertFalse(Lead.objects.filter(meta_leadgen_id='LEAD1').exists())

    @patch('bookings.services.meta.fetch_lead')
    def test_a_transient_fetch_failure_keeps_the_raw_event_for_backfill(self, fetch):
        """AC5 — nothing lost; the event is stored with an error."""
        fetch.side_effect = meta_leads.meta.MetaApiError('graph down')
        resp = _post(self.client, _leadgen_payload())

        self.assertEqual(resp.status_code, 200)   # never make Meta retry-then-disable
        self.assertFalse(Lead.objects.filter(meta_leadgen_id='LEAD1').exists())
        event = MetaWebhookEvent.objects.get(page_id='PAGE1')
        self.assertIn('graph down', event.error)
        self.assertIsNone(event.processed_at)

    @patch('bookings.services.meta.fetch_lead')
    def test_unknown_page_is_recorded_and_ignored(self, fetch):
        """AC6."""
        resp = _post(self.client, _leadgen_payload(page_id='NOPAGE'))
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Lead.objects.exists())
        event = MetaWebhookEvent.objects.get(page_id='NOPAGE')
        self.assertIsNone(event.organisation)
        fetch.assert_not_called()

    @patch('bookings.services.meta.fetch_lead')
    def test_routes_to_the_org_that_connected_the_page(self, fetch):
        """AC7 — page_id decides the org."""
        other = _other_org()
        _connect_page(other, page_id='OTHERPAGE')
        fetch.return_value = _lead_object()

        _post(self.client, _leadgen_payload(page_id='OTHERPAGE'))
        lead = Lead.objects.get(meta_leadgen_id='LEAD1')
        self.assertEqual(lead.organisation, other)


@override_settings(**APP)
class TestMetaLeadBackfill(TestCase):
    def setUp(self):
        self.org = get_test_user().organisation
        self.page = _connect_page(self.org)

    @patch('bookings.services.meta.list_form_leads')
    @patch('bookings.services.meta.list_lead_forms')
    def test_backfill_creates_missing_leads_and_is_idempotent(self, forms, form_leads):
        forms.return_value = ['FORM1']
        form_leads.return_value = [_lead_object(leadgen_id='BACKFILL1')]

        first = meta_leads.backfill_all()
        self.assertEqual(first, 1)
        self.assertTrue(Lead.objects.filter(meta_leadgen_id='BACKFILL1').exists())

        # Second sweep sees the same submission and creates nothing new.
        second = meta_leads.backfill_all()
        self.assertEqual(second, 0)
        self.assertEqual(Lead.objects.filter(meta_leadgen_id='BACKFILL1').count(), 1)

    @patch('bookings.services.meta.list_lead_forms', return_value=[])
    def test_cron_endpoint_requires_the_secret(self, _forms):
        # list_lead_forms mocked so the authorised call can't reach the network.
        client = APIClient()
        self.assertEqual(client.post(CRON_URL).status_code, 403)
        self.assertEqual(
            client.post(CRON_URL, HTTP_X_CRON_SECRET='cron-secret').status_code, 200,
        )


# ──────────────────────────────────────────────────────────────────────
# REL-512 — product mapping + auto-assign on ingest
# ──────────────────────────────────────────────────────────────────────

from bookings.models import OrgSettings, ProductLine  # noqa: E402
from bookings.serializers.settings import OrgSettingsSerializer  # noqa: E402

PAGE_PRODUCT_URL = '/api/integrations/meta/page-product/'


def _product_line(org, name='Weddings', salespeople=()):
    pl = ProductLine.objects.create(organisation=org, name=name, is_active=True)
    for sp in salespeople:
        pl.salespeople.add(sp)
    return pl


def _salesperson(org, email):
    return User.objects.create(email=email, role='salesperson', organisation=org, is_active=True)


@override_settings(**APP)
class TestMetaLeadProduct(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.page = _connect_page(self.org)
        ProductLine.objects.filter(organisation=self.org).delete()  # start clean

    @patch('bookings.services.meta.fetch_lead')
    def test_per_page_mapping_stamps_that_product(self, fetch):
        """AC1."""
        weddings = _product_line(self.org, 'Weddings')
        _product_line(self.org, 'Corporate')  # a second line, so no smart default
        self.page.default_product_line = weddings
        self.page.save()
        fetch.return_value = _lead_object()

        meta_leads.ingest_lead(self.page, 'LEAD1')
        self.assertEqual(Lead.objects.get(meta_leadgen_id='LEAD1').product, weddings)

    @patch('bookings.services.meta.fetch_lead')
    def test_single_product_org_gets_that_line_automatically(self, fetch):
        """AC2 — zero config for single-product orgs."""
        only = _product_line(self.org, 'Catering')
        fetch.return_value = _lead_object()

        meta_leads.ingest_lead(self.page, 'LEAD1')
        self.assertEqual(Lead.objects.get(meta_leadgen_id='LEAD1').product, only)

    @patch('bookings.services.meta.fetch_lead')
    def test_multi_product_without_mapping_leaves_product_null(self, fetch):
        _product_line(self.org, 'Weddings')
        _product_line(self.org, 'Corporate')
        fetch.return_value = _lead_object()

        meta_leads.ingest_lead(self.page, 'LEAD1')
        self.assertIsNone(Lead.objects.get(meta_leadgen_id='LEAD1').product_id)


@override_settings(**APP)
class TestMetaLeadAutoAssign(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.page = _connect_page(self.org)
        ProductLine.objects.filter(organisation=self.org).delete()

    def _opt_in(self, on=True):
        OrgSettings.objects.filter(organisation=self.org).update(auto_assign_integration_leads=on)

    @patch('bookings.services.meta.fetch_lead')
    def test_toggle_off_leaves_the_lead_unassigned(self, fetch):
        """AC3."""
        _product_line(self.org, 'Catering', salespeople=[_salesperson(self.org, 'sp1@t.com')])
        self._opt_in(False)
        fetch.return_value = _lead_object()

        meta_leads.ingest_lead(self.page, 'LEAD1')
        self.assertIsNone(Lead.objects.get(meta_leadgen_id='LEAD1').assigned_to_id)

    @patch('bookings.services.meta.fetch_lead')
    def test_toggle_on_assigns_by_round_robin_with_activity(self, fetch):
        """AC4."""
        sp = _salesperson(self.org, 'sp1@t.com')
        _product_line(self.org, 'Catering', salespeople=[sp])
        self._opt_in(True)
        fetch.return_value = _lead_object()

        meta_leads.ingest_lead(self.page, 'LEAD1')
        lead = Lead.objects.get(meta_leadgen_id='LEAD1')
        self.assertEqual(lead.assigned_to_id, sp.pk)
        self.assertTrue(ActivityLog.objects.filter(
            action='updated', field_name='assigned_to', object_id=lead.pk,
        ).exists())

    @patch('bookings.services.meta.fetch_lead')
    def test_toggle_on_but_no_resolvable_product_stays_unassigned(self, fetch):
        """AC5 — never misroute a productless lead."""
        _product_line(self.org, 'Weddings')
        _product_line(self.org, 'Corporate')  # multi-product, no mapping ⇒ no product
        self._opt_in(True)
        fetch.return_value = _lead_object()

        meta_leads.ingest_lead(self.page, 'LEAD1')
        self.assertIsNone(Lead.objects.get(meta_leadgen_id='LEAD1').assigned_to_id)


@override_settings(**APP)
class TestMetaPageProductEndpoint(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.page = _connect_page(self.org)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_sets_and_clears_the_product_mapping(self):
        pl = _product_line(self.org, 'Weddings')
        resp = self.client.post(PAGE_PRODUCT_URL, {'page_id': 'PAGE1', 'product_line_id': pl.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.page.refresh_from_db()
        self.assertEqual(self.page.default_product_line_id, pl.pk)

        self.client.post(PAGE_PRODUCT_URL, {'page_id': 'PAGE1', 'product_line_id': None}, format='json')
        self.page.refresh_from_db()
        self.assertIsNone(self.page.default_product_line_id)

    def test_rejects_a_product_line_from_another_org(self):
        other_pl = ProductLine.objects.create(organisation=_other_org(), name='Foreign', is_active=True)
        resp = self.client.post(PAGE_PRODUCT_URL, {'page_id': 'PAGE1', 'product_line_id': other_pl.pk}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_cannot_map_another_orgs_page(self):
        _connect_page(_other_org(), page_id='RIVAL')
        resp = self.client.post(PAGE_PRODUCT_URL, {'page_id': 'RIVAL', 'product_line_id': None}, format='json')
        self.assertEqual(resp.status_code, 404)

    @override_settings(META_LEADS_ENABLED=False)
    def test_flag_off_is_404(self):
        self.assertEqual(
            self.client.post(PAGE_PRODUCT_URL, {'page_id': 'PAGE1'}, format='json').status_code, 404,
        )

    def test_managers_cannot_set_the_mapping(self):
        mgr = User.objects.create(email='mgr@t.com', role='manager', organisation=self.org, is_active=True)
        client = APIClient()
        client.force_authenticate(mgr)
        self.assertIn(client.post(PAGE_PRODUCT_URL, {'page_id': 'PAGE1'}, format='json').status_code, (401, 403))


class TestAutoAssignSettingSerialized(TestCase):
    def test_toggle_is_exposed_and_writable(self):
        org = get_test_user().organisation
        settings_row = OrgSettings.objects.get(organisation=org)
        ser = OrgSettingsSerializer(settings_row, data={'auto_assign_integration_leads': True}, partial=True)
        self.assertTrue(ser.is_valid(), ser.errors)
        ser.save()
        settings_row.refresh_from_db()
        self.assertTrue(settings_row.auto_assign_integration_leads)
