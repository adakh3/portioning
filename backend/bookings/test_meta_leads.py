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
from users.models import Organisation

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
