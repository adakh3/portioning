"""Client payment tracking on events (advances / part / full).

Covers the settlement math (amount_paid / balance_due / payment_status) and the
event-payment API (record / list / delete, org-scoping, received_by).
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from users.models import Organisation, User
from events.models import Event, EventPayment


def make_event(org, total="1000.00", **kw):
    ev = Event.objects.create(
        organisation=org, name=kw.pop("name", "Gala"),
        event_date=kw.pop("event_date", date(2026, 7, 1)), gents=20, ladies=20, **kw,
    )
    # Set the total directly — payment tracking is independent of the pricing engine.
    ev.total = Decimal(total)
    ev.save(update_fields=["total"])
    return ev


class EventPaymentMathTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="Cater Co", slug="cater", country="PK")
        self.user = User.objects.create(email="rep@cater.test", role="salesperson",
                                        organisation=self.org, is_active=True)
        self.event = make_event(self.org, total="1000.00")

    def _pay(self, amount, **kw):
        return EventPayment.objects.create(
            event=self.event, amount=Decimal(amount),
            payment_date=kw.pop("payment_date", date(2026, 6, 1)),
            method=kw.pop("method", "cash"), received_by=kw.pop("received_by", self.user), **kw,
        )

    def test_no_payments_is_unpaid_full_balance(self):
        self.assertEqual(self.event.amount_paid, Decimal("0.00"))
        self.assertEqual(self.event.balance_due, Decimal("1000.00"))
        self.assertEqual(self.event.payment_status, "unpaid")

    def test_partial_payment(self):
        self._pay("400.00")
        self.assertEqual(self.event.amount_paid, Decimal("400.00"))
        self.assertEqual(self.event.balance_due, Decimal("600.00"))
        self.assertEqual(self.event.payment_status, "partial")

    def test_multiple_payments_sum(self):
        self._pay("500.00")   # 50% advance
        self._pay("500.00")   # balance
        self.assertEqual(self.event.amount_paid, Decimal("1000.00"))
        self.assertEqual(self.event.balance_due, Decimal("0.00"))
        self.assertEqual(self.event.payment_status, "paid")

    def test_overpaid_is_paid_negative_balance(self):
        self._pay("1200.00")
        self.assertEqual(self.event.amount_paid, Decimal("1200.00"))
        self.assertEqual(self.event.balance_due, Decimal("-200.00"))
        self.assertEqual(self.event.payment_status, "paid")

    def test_deleting_a_payment_restores_balance(self):
        p1 = self._pay("500.00")
        self._pay("300.00")
        self.assertEqual(self.event.amount_paid, Decimal("800.00"))
        p1.delete()
        self.assertEqual(self.event.amount_paid, Decimal("300.00"))
        self.assertEqual(self.event.balance_due, Decimal("700.00"))
        self.assertEqual(self.event.payment_status, "partial")

    def test_received_by_records_the_user(self):
        p = self._pay("100.00", received_by=self.user)
        self.assertEqual(p.received_by, self.user)

    def test_received_by_survives_user_deletion(self):
        other = User.objects.create(email="tmp@cater.test", role="chef",
                                    organisation=self.org, is_active=True)
        p = self._pay("100.00", received_by=other)
        other.delete()
        p.refresh_from_db()
        self.assertIsNone(p.received_by)  # SET_NULL — the payment record survives


class EventPaymentAPITests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name="Cater Co", slug="cater", country="PK")
        self.owner = User.objects.create(email="owner@cater.test", role="owner",
                                         organisation=self.org, is_active=True)
        self.event = make_event(self.org, total="1000.00")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def url(self, event=None):
        return f"/api/events/{(event or self.event).id}/payments/"

    def test_record_and_list_payment(self):
        res = self.client.post(self.url(), {
            "amount": "500.00", "payment_date": "2026-06-01", "method": "bank_transfer",
            "reference": "TXN-1",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        # received_by defaults to the current user when omitted.
        self.assertEqual(res.json()["received_by"], self.owner.id)

        lst = self.client.get(self.url())
        rows = lst.json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["amount"], "500.00")

    def test_balance_reflected_on_event_endpoint(self):
        self.client.post(self.url(), {
            "amount": "400.00", "payment_date": "2026-06-01", "method": "cash",
        }, format="json")
        ev = self.client.get(f"/api/events/{self.event.id}/").json()
        self.assertEqual(ev["amount_paid"], "400.00")
        self.assertEqual(ev["balance_due"], "600.00")
        self.assertEqual(ev["payment_status"], "partial")

    def test_delete_payment_restores_balance(self):
        pid = self.client.post(self.url(), {
            "amount": "1000.00", "payment_date": "2026-06-01", "method": "cash",
        }, format="json").json()["id"]
        self.client.delete(f"{self.url()}{pid}/")
        ev = self.client.get(f"/api/events/{self.event.id}/").json()
        self.assertEqual(ev["amount_paid"], "0.00")
        self.assertEqual(ev["payment_status"], "unpaid")

    def test_can_set_received_by_to_another_user(self):
        other = User.objects.create(email="rep@cater.test", role="salesperson",
                                    organisation=self.org, is_active=True)
        res = self.client.post(self.url(), {
            "amount": "100.00", "payment_date": "2026-06-01", "method": "cash",
            "received_by": other.id,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["received_by"], other.id)

    def test_cannot_record_against_another_orgs_event(self):
        other_org = Organisation.objects.create(name="Rival", slug="rival", country="PK")
        other_event = make_event(other_org, total="500.00", name="Rival Gala")
        res = self.client.post(self.url(other_event), {
            "amount": "100.00", "payment_date": "2026-06-01", "method": "cash",
        }, format="json")
        # Another org's event is invisible → not found (or rejected), never created.
        self.assertIn(res.status_code, (400, 403, 404), res.content)
        self.assertEqual(other_event.payments.count(), 0)

    def test_cannot_list_another_orgs_event_payments(self):
        other_org = Organisation.objects.create(name="Rival", slug="rival", country="PK")
        other_event = make_event(other_org, total="500.00", name="Rival Gala")
        EventPayment.objects.create(event=other_event, amount=Decimal("100.00"),
                                    payment_date=date(2026, 6, 1), method="cash")
        res = self.client.get(self.url(other_event))
        rows = res.json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertEqual(len(rows), 0)
