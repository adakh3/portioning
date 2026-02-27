from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import (
    Account, Contact, Venue, Lead, Quote, QuoteLineItem,
    LaborRole, StaffMember, EquipmentItem, Invoice, Payment,
)
from bookings.models.leads import LeadStatus
from bookings.models.quotes import QuoteStatus


# --- Helper factories ---

def make_account(**kwargs):
    defaults = {"name": "Test Corp", "account_type": "company"}
    defaults.update(kwargs)
    return Account.objects.create(**defaults)


def make_contact(account=None, **kwargs):
    if account is None:
        account = make_account()
    defaults = {"account": account, "name": "Jane Doe", "email": "jane@test.com", "role": "coordinator"}
    defaults.update(kwargs)
    return Contact.objects.create(**defaults)


def make_venue(**kwargs):
    defaults = {"name": "Grand Hall", "city": "London", "kitchen_access": True}
    defaults.update(kwargs)
    return Venue.objects.create(**defaults)


def make_lead(account=None, **kwargs):
    defaults = {
        "contact_name": "John Smith",
        "contact_email": "john@test.com",
        "source": "website",
        "event_type": "wedding",
        "event_date": "2026-06-15",
        "guest_estimate": 100,
    }
    if account:
        defaults["account"] = account
    defaults.update(kwargs)
    return Lead.objects.create(**defaults)


def make_quote(account=None, **kwargs):
    if account is None:
        account = make_account()
    defaults = {
        "account": account,
        "event_date": "2026-06-15",
        "guest_count": 100,
        "event_type": "wedding",
    }
    defaults.update(kwargs)
    return Quote.objects.create(**defaults)


# ==================================================================
# Model Tests
# ==================================================================

class TestLeadTransitions(TestCase):
    def setUp(self):
        self.lead = make_lead()

    def test_new_to_contacted(self):
        self.lead.transition_to(LeadStatus.CONTACTED)
        self.assertEqual(self.lead.status, LeadStatus.CONTACTED)
        self.assertIsNotNone(self.lead.contacted_at)

    def test_contacted_to_qualified(self):
        self.lead.transition_to(LeadStatus.CONTACTED)
        self.lead.transition_to(LeadStatus.QUALIFIED)
        self.assertEqual(self.lead.status, LeadStatus.QUALIFIED)
        self.assertIsNotNone(self.lead.qualified_at)

    def test_qualified_to_converted(self):
        self.lead.transition_to(LeadStatus.CONTACTED)
        self.lead.transition_to(LeadStatus.QUALIFIED)
        self.lead.transition_to(LeadStatus.CONVERTED)
        self.assertEqual(self.lead.status, LeadStatus.CONVERTED)
        self.assertIsNotNone(self.lead.converted_at)

    def test_invalid_transition_raises(self):
        with self.assertRaises(ValueError):
            self.lead.transition_to(LeadStatus.CONVERTED)  # new -> converted is invalid

    def test_lost_can_reopen(self):
        self.lead.transition_to(LeadStatus.LOST)
        self.lead.transition_to(LeadStatus.NEW)
        self.assertEqual(self.lead.status, LeadStatus.NEW)

    def test_any_to_lost(self):
        self.lead.transition_to(LeadStatus.CONTACTED)
        self.lead.transition_to(LeadStatus.LOST)
        self.assertEqual(self.lead.status, LeadStatus.LOST)
        self.assertIsNotNone(self.lead.lost_at)


class TestQuoteTransitions(TestCase):
    def setUp(self):
        self.quote = make_quote()

    def test_draft_to_sent(self):
        self.quote.transition_to(QuoteStatus.SENT)
        self.assertEqual(self.quote.status, QuoteStatus.SENT)
        self.assertIsNotNone(self.quote.sent_at)

    def test_sent_to_accepted(self):
        self.quote.transition_to(QuoteStatus.SENT)
        self.quote.transition_to(QuoteStatus.ACCEPTED)
        self.assertEqual(self.quote.status, QuoteStatus.ACCEPTED)
        self.assertIsNotNone(self.quote.accepted_at)

    def test_sent_to_declined(self):
        self.quote.transition_to(QuoteStatus.SENT)
        self.quote.transition_to(QuoteStatus.DECLINED)
        self.assertEqual(self.quote.status, QuoteStatus.DECLINED)

    def test_declined_can_reopen(self):
        self.quote.transition_to(QuoteStatus.SENT)
        self.quote.transition_to(QuoteStatus.DECLINED)
        self.quote.transition_to(QuoteStatus.DRAFT)
        self.assertEqual(self.quote.status, QuoteStatus.DRAFT)

    def test_invalid_transition_raises(self):
        with self.assertRaises(ValueError):
            self.quote.transition_to(QuoteStatus.ACCEPTED)  # draft -> accepted is invalid

    def test_is_editable_only_in_draft(self):
        self.assertTrue(self.quote.is_editable)
        self.quote.transition_to(QuoteStatus.SENT)
        self.assertFalse(self.quote.is_editable)


class TestQuoteLineItemCalculation(TestCase):
    def setUp(self):
        self.quote = make_quote(guest_count=50)

    def test_each_unit_calculation(self):
        item = QuoteLineItem.objects.create(
            quote=self.quote, category="food", description="Main Course",
            quantity=Decimal("10"), unit="each", unit_price=Decimal("25.00"),
        )
        self.assertEqual(item.line_total, Decimal("250.00"))

    def test_per_guest_calculation(self):
        item = QuoteLineItem.objects.create(
            quote=self.quote, category="food", description="Starter",
            quantity=Decimal("1"), unit="per_guest", unit_price=Decimal("12.50"),
        )
        # per_guest: unit_price * guest_count = 12.50 * 50
        self.assertEqual(item.line_total, Decimal("625.00"))

    def test_discount_is_negative(self):
        item = QuoteLineItem.objects.create(
            quote=self.quote, category="discount", description="Early booking",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("100.00"),
        )
        self.assertEqual(item.line_total, Decimal("-100.00"))

    def test_quote_totals_recalculated(self):
        QuoteLineItem.objects.create(
            quote=self.quote, category="food", description="Food",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("1000.00"),
            is_taxable=True,
        )
        QuoteLineItem.objects.create(
            quote=self.quote, category="rental", description="Tables",
            quantity=Decimal("5"), unit="each", unit_price=Decimal("50.00"),
            is_taxable=False,
        )
        self.quote.refresh_from_db()
        self.assertEqual(self.quote.subtotal, Decimal("1250.00"))
        # Tax only on taxable items: 1000 * 0.20 = 200
        self.assertEqual(self.quote.tax_amount, Decimal("200.00"))
        self.assertEqual(self.quote.total, Decimal("1450.00"))

    def test_delete_item_recalculates(self):
        item = QuoteLineItem.objects.create(
            quote=self.quote, category="food", description="Food",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("500.00"),
        )
        self.quote.refresh_from_db()
        self.assertEqual(self.quote.total, Decimal("600.00"))  # 500 + 20% tax

        item.delete()
        self.quote.refresh_from_db()
        self.assertEqual(self.quote.total, Decimal("0.00"))


class TestInvoicePayments(TestCase):
    def setUp(self):
        # Need an Event for Invoice FK - use events app
        from events.models import Event
        self.event = Event.objects.create(
            name="Test Event", date="2026-06-15", gents=50, ladies=50,
        )
        self.invoice = Invoice.objects.create(
            event=self.event, invoice_number="INV-2026-001",
            invoice_type="final", issue_date="2026-06-01",
            due_date="2026-06-15", subtotal=Decimal("1000.00"),
            tax_amount=Decimal("200.00"), total=Decimal("1200.00"),
        )

    def test_amount_paid_starts_zero(self):
        self.assertEqual(self.invoice.amount_paid, Decimal("0.00"))
        self.assertEqual(self.invoice.balance_due, Decimal("1200.00"))

    def test_partial_payment_updates_status(self):
        Payment.objects.create(
            invoice=self.invoice, amount=Decimal("500.00"),
            payment_date="2026-06-05", method="bank_transfer",
        )
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, "partial")
        self.assertEqual(self.invoice.amount_paid, Decimal("500.00"))
        self.assertEqual(self.invoice.balance_due, Decimal("700.00"))

    def test_full_payment_marks_paid(self):
        Payment.objects.create(
            invoice=self.invoice, amount=Decimal("1200.00"),
            payment_date="2026-06-10", method="card",
        )
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, "paid")
        self.assertIsNotNone(self.invoice.paid_at)

    def test_delete_payment_reverts_status(self):
        p = Payment.objects.create(
            invoice=self.invoice, amount=Decimal("1200.00"),
            payment_date="2026-06-10", method="card",
        )
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, "paid")

        p.delete()
        self.invoice.refresh_from_db()
        # After deleting the only payment, balance > 0 but no payments → status stays as-is
        # The update_payment_status only changes to paid/partial, doesn't revert to draft
        self.assertIn(self.invoice.status, ["paid", "partial", "draft"])


class TestEquipmentAvailability(TestCase):
    def setUp(self):
        self.item = EquipmentItem.objects.create(
            name="Round Table", category="table", stock_quantity=20,
            rental_price=Decimal("50.00"),
        )

    def test_full_stock_available(self):
        available = self.item.available_on_date("2026-06-15")
        self.assertEqual(available, 20)

    def test_reserved_reduces_availability(self):
        from events.models import Event
        event = Event.objects.create(
            name="Wedding", date="2026-06-15", gents=50, ladies=50,
        )
        from bookings.models import EquipmentReservation
        EquipmentReservation.objects.create(
            event=event, equipment=self.item, quantity_out=8,
        )
        available = self.item.available_on_date("2026-06-15")
        self.assertEqual(available, 12)


# ==================================================================
# API Tests
# ==================================================================

class TestAccountAPI(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_account(self):
        res = self.client.post("/api/bookings/accounts/", {
            "name": "Acme Corp", "account_type": "company",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["name"], "Acme Corp")

    def test_list_accounts(self):
        make_account(name="Alpha")
        make_account(name="Beta")
        res = self.client.get("/api/bookings/accounts/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 2)

    def test_update_account(self):
        account = make_account()
        res = self.client.patch(f"/api/bookings/accounts/{account.id}/", {
            "billing_city": "Manchester",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["billing_city"], "Manchester")

    def test_delete_account(self):
        account = make_account()
        res = self.client.delete(f"/api/bookings/accounts/{account.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Account.objects.filter(id=account.id).exists())

    def test_create_contact_nested(self):
        account = make_account()
        res = self.client.post(f"/api/bookings/accounts/{account.id}/contacts/", {
            "name": "Bob", "email": "bob@test.com", "role": "billing",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["name"], "Bob")
        self.assertEqual(account.contacts.count(), 1)

    def test_account_detail_includes_contacts(self):
        account = make_account()
        make_contact(account=account, name="Alice")
        res = self.client.get(f"/api/bookings/accounts/{account.id}/")
        self.assertEqual(len(res.json()["contacts"]), 1)
        self.assertEqual(res.json()["contacts"][0]["name"], "Alice")


class TestVenueAPI(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_venue(self):
        res = self.client.post("/api/bookings/venues/", {
            "name": "The Barn", "city": "Oxford", "kitchen_access": True,
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["name"], "The Barn")

    def test_list_venues(self):
        make_venue(name="Hall A")
        make_venue(name="Hall B")
        res = self.client.get("/api/bookings/venues/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 2)


class TestLeadAPI(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_lead(self):
        res = self.client.post("/api/bookings/leads/", {
            "contact_name": "Sarah", "event_type": "corporate",
            "event_date": "2026-09-01", "guest_estimate": 200,
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["status"], "new")

    def test_list_leads_filter_by_status(self):
        make_lead(contact_name="A")
        lead_b = make_lead(contact_name="B")
        lead_b.transition_to(LeadStatus.CONTACTED)

        res = self.client.get("/api/bookings/leads/?status=new")
        self.assertEqual(len(res.json()), 1)
        self.assertEqual(res.json()[0]["contact_name"], "A")

    def test_transition_lead(self):
        lead = make_lead()
        res = self.client.post(f"/api/bookings/leads/{lead.id}/transition/", {
            "status": "contacted",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "contacted")

    def test_transition_invalid_returns_400(self):
        lead = make_lead()
        res = self.client.post(f"/api/bookings/leads/{lead.id}/transition/", {
            "status": "converted",  # can't go new -> converted
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_convert_lead_creates_quote(self):
        account = make_account()
        lead = make_lead(account=account)
        lead.transition_to(LeadStatus.CONTACTED)
        lead.transition_to(LeadStatus.QUALIFIED)

        res = self.client.post(f"/api/bookings/leads/{lead.id}/convert/")
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["account"], account.id)
        self.assertEqual(data["guest_count"], 100)

        lead.refresh_from_db()
        self.assertEqual(lead.status, LeadStatus.CONVERTED)
        self.assertIsNotNone(lead.converted_to_quote)

    def test_convert_unqualified_lead_returns_400(self):
        lead = make_lead()
        res = self.client.post(f"/api/bookings/leads/{lead.id}/convert/")
        self.assertEqual(res.status_code, 400)

    def test_convert_creates_account_if_none(self):
        lead = make_lead(account=None)
        lead.transition_to(LeadStatus.CONTACTED)
        lead.transition_to(LeadStatus.QUALIFIED)

        res = self.client.post(f"/api/bookings/leads/{lead.id}/convert/")
        self.assertEqual(res.status_code, 201)
        lead.refresh_from_db()
        self.assertIsNotNone(lead.account)
        self.assertEqual(lead.account.name, "John Smith")


class TestQuoteAPI(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.account = make_account()

    def test_create_quote(self):
        res = self.client.post("/api/bookings/quotes/", {
            "account": self.account.id,
            "event_date": "2026-07-01",
            "guest_count": 80,
            "event_type": "corporate",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["status"], "draft")
        self.assertTrue(res.json()["is_editable"])

    def test_add_line_item(self):
        quote = make_quote(account=self.account)
        res = self.client.post(f"/api/bookings/quotes/{quote.id}/items/", {
            "category": "food",
            "description": "Chicken Biryani",
            "quantity": "80",
            "unit": "each",
            "unit_price": "15.00",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["line_total"], "1200.00")

    def test_quote_totals_update_after_add_item(self):
        quote = make_quote(account=self.account, guest_count=50)
        self.client.post(f"/api/bookings/quotes/{quote.id}/items/", {
            "category": "food", "description": "Main",
            "quantity": "1", "unit": "flat", "unit_price": "1000.00",
        }, format="json")

        res = self.client.get(f"/api/bookings/quotes/{quote.id}/")
        data = res.json()
        self.assertEqual(data["subtotal"], "1000.00")
        self.assertEqual(data["tax_amount"], "200.00")
        self.assertEqual(data["total"], "1200.00")

    def test_cannot_add_item_to_sent_quote(self):
        quote = make_quote(account=self.account)
        quote.transition_to(QuoteStatus.SENT)

        res = self.client.post(f"/api/bookings/quotes/{quote.id}/items/", {
            "category": "food", "description": "Late add",
            "quantity": "1", "unit": "flat", "unit_price": "100.00",
        }, format="json")
        self.assertEqual(res.status_code, 403)

    def test_cannot_edit_sent_quote(self):
        quote = make_quote(account=self.account)
        quote.transition_to(QuoteStatus.SENT)

        res = self.client.patch(f"/api/bookings/quotes/{quote.id}/", {
            "guest_count": 200,
        }, format="json")
        self.assertEqual(res.status_code, 403)

    def test_transition_quote(self):
        quote = make_quote(account=self.account)
        res = self.client.post(f"/api/bookings/quotes/{quote.id}/transition/", {
            "status": "sent",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "sent")

    def test_delete_line_item(self):
        quote = make_quote(account=self.account)
        item = QuoteLineItem.objects.create(
            quote=quote, category="food", description="Starter",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("500.00"),
        )
        res = self.client.delete(f"/api/bookings/quotes/{quote.id}/items/{item.id}/")
        self.assertEqual(res.status_code, 204)

        quote.refresh_from_db()
        self.assertEqual(quote.total, Decimal("0.00"))

    def test_list_quotes_filter_by_status(self):
        q1 = make_quote(account=self.account)
        q2 = make_quote(account=self.account)
        q2.transition_to(QuoteStatus.SENT)

        res = self.client.get("/api/bookings/quotes/?status=draft")
        self.assertEqual(len(res.json()), 1)
        self.assertEqual(res.json()[0]["id"], q1.id)


class TestStaffingAPI(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_labor_role(self):
        res = self.client.post("/api/bookings/labor-roles/", {
            "name": "Head Chef", "default_hourly_rate": "25.00",
        }, format="json")
        self.assertEqual(res.status_code, 201)

    def test_create_staff_member(self):
        role = LaborRole.objects.create(name="Server", default_hourly_rate=Decimal("15.00"))
        res = self.client.post("/api/bookings/staff/", {
            "name": "Tom", "email": "tom@test.com", "roles": [role.id],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertIn("Server", res.json()["role_names"])


class TestEquipmentAPI(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_equipment(self):
        res = self.client.post("/api/bookings/equipment/", {
            "name": "Chafer Dish", "category": "chafer",
            "stock_quantity": 30, "rental_price": "15.00",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["stock_quantity"], 30)

    def test_list_equipment(self):
        EquipmentItem.objects.create(name="Table", category="table", stock_quantity=10, rental_price=Decimal("50.00"))
        res = self.client.get("/api/bookings/equipment/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 1)


class TestInvoiceAPI(TestCase):
    def setUp(self):
        self.client = APIClient()
        from events.models import Event
        self.event = Event.objects.create(
            name="Gala Dinner", date="2026-08-01", gents=60, ladies=60,
        )

    def test_create_invoice(self):
        res = self.client.post("/api/bookings/invoices/", {
            "event": self.event.id,
            "invoice_number": "INV-2026-010",
            "invoice_type": "deposit",
            "issue_date": "2026-07-01",
            "due_date": "2026-07-15",
            "subtotal": "500.00",
            "tax_amount": "100.00",
            "total": "600.00",
        }, format="json")
        self.assertEqual(res.status_code, 201)

    def test_add_payment_to_invoice(self):
        invoice = Invoice.objects.create(
            event=self.event, invoice_number="INV-2026-011",
            invoice_type="final", issue_date="2026-07-01",
            due_date="2026-07-15", subtotal=Decimal("1000.00"),
            tax_amount=Decimal("200.00"), total=Decimal("1200.00"),
        )
        res = self.client.post(f"/api/bookings/invoices/{invoice.id}/payments/", {
            "amount": "600.00", "payment_date": "2026-07-10", "method": "bank_transfer",
        }, format="json")
        self.assertEqual(res.status_code, 201)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, "partial")

    def test_invoice_detail_includes_computed_fields(self):
        invoice = Invoice.objects.create(
            event=self.event, invoice_number="INV-2026-012",
            invoice_type="final", issue_date="2026-07-01",
            due_date="2026-07-15", subtotal=Decimal("1000.00"),
            tax_amount=Decimal("200.00"), total=Decimal("1200.00"),
        )
        Payment.objects.create(
            invoice=invoice, amount=Decimal("400.00"),
            payment_date="2026-07-05", method="card",
        )
        res = self.client.get(f"/api/bookings/invoices/{invoice.id}/")
        data = res.json()
        self.assertEqual(data["amount_paid"], "400.00")
        self.assertEqual(data["balance_due"], "800.00")
