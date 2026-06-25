"""N+1 guardrail for list endpoints — a recurring source of slow pages.

Each high-traffic list endpoint is registered here with a row factory; the shared
`assert_list_queries_constant` helper asserts the query count does NOT grow as
rows are added. When you add a new list endpoint, add an entry here. When a list
serializer gains a field that reads a related object, this fails until the
view's queryset select_related/prefetch_related's it.

See docs/CODE_MAINTENANCE.md → "Query efficiency".
"""
from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import ProductLine
from bookings.tests import make_account, make_contact, make_lead, make_quote
from tests.base import assert_list_queries_constant, get_test_org, get_test_user
from users.models import User


class TestListEndpointQueryEfficiency(TestCase):
    def setUp(self):
        self.org = get_test_org()
        self.client = APIClient()
        self.client.force_authenticate(get_test_user())  # owner — sees all rows
        self.account = make_account(org=self.org)
        self.contact = make_contact(account=self.account, org=self.org)
        self._i = 0

    def _next(self):
        self._i += 1
        return self._i

    def _user(self, i):
        return User.objects.create(email=f"qe{i}@ex.com", role="salesperson", organisation=self.org)

    def _product(self, i):
        return ProductLine.objects.create(organisation=self.org, name=f"Line {i}")

    def test_quotes_list(self):
        def row():
            i = self._next()
            make_quote(org=self.org, account=self.account, primary_contact=self.contact,
                       product=self._product(i), created_by=self._user(i))
        assert_list_queries_constant(self, self.client, "/api/bookings/quotes/", row, "quotes")

    def test_leads_list(self):
        def row():
            i = self._next()
            make_lead(org=self.org, account=self.account,
                      product=self._product(i), assigned_to=self._user(i), created_by=self._user(i + 1000))
        assert_list_queries_constant(self, self.client, "/api/bookings/leads/", row, "leads")

    def test_events_list(self):
        from events.models import Event

        def row():
            i = self._next()
            Event.objects.create(organisation=self.org, name=f"E{i}", date="2026-09-01",
                                 gents=10, ladies=10, account=self.account,
                                 product=self._product(i), created_by=self._user(i))
        assert_list_queries_constant(self, self.client, "/api/events/", row, "events")
