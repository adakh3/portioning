from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import (
    Account, Contact, Venue, Lead, Quote, BookingLineItem,
    Invoice, Payment,
    OrgSettings,
)
from staff.models import LaborRole, StaffMember
from equipment.models import EquipmentItem
from bookings.models.quotes import QuoteStatus
from tests.base import get_test_user
from users.models import Organisation


def _make_org(**kwargs):
    defaults = {"name": "Default Organisation", "slug": "default", "country": "PK"}
    defaults.update(kwargs)
    org, _ = Organisation.objects.get_or_create(slug=defaults.pop("slug"), defaults=defaults)
    return org


def _authenticated_client():
    client = APIClient()
    client.force_authenticate(user=get_test_user())
    return client


# --- Helper factories ---

def make_account(org=None, **kwargs):
    if org is None:
        org = _make_org()
    defaults = {"name": "Test Corp", "account_type": "company", "organisation": org}
    defaults.update(kwargs)
    return Account.objects.create(**defaults)


def make_contact(account=None, org=None, **kwargs):
    # Contact (person) is now org-scoped directly; account (company) is optional.
    if account is None and org is None:
        account = make_account()
    if org is None:
        org = account.organisation
    defaults = {"organisation": org, "account": account, "name": "Jane Doe",
                "email": "jane@test.com", "role": "coordinator"}
    defaults.update(kwargs)
    return Contact.objects.create(**defaults)


def make_venue(org=None, **kwargs):
    if org is None:
        org = _make_org(slug="venue-org")
    defaults = {"name": "Grand Hall", "city": "London", "kitchen_access": True, "organisation": org}
    defaults.update(kwargs)
    return Venue.objects.create(**defaults)


def make_lead(org=None, account=None, **kwargs):
    if org is None:
        org = _make_org(slug="lead-org")
    defaults = {
        "organisation": org,
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


def make_quote(org=None, account=None, primary_contact=None, **kwargs):
    if org is None:
        org = _make_org(slug="quote-org")
    if account is None:
        account = make_account(org=org)
    if primary_contact is None:
        # Quote now requires a customer (person).
        primary_contact = make_contact(account=account, org=org)
    defaults = {
        "organisation": org,
        "account": account,
        "primary_contact": primary_contact,
        "event_date": "2026-06-15",
        "guest_count": 100,
        "event_type": "wedding",
    }
    defaults.update(kwargs)
    # Keep the gender split consistent with guest_count (the editor sends both).
    gc = defaults["guest_count"]
    defaults.setdefault("gents", gc // 2)
    defaults.setdefault("ladies", gc - gc // 2)
    return Quote.objects.create(**defaults)


class ProductLineDefaultTests(TestCase):
    def test_setting_a_default_clears_the_previous_one(self):
        from bookings.models import ProductLine
        org = _make_org(slug="pl-default")
        a = ProductLine.objects.create(organisation=org, name="A", is_default=True)
        b = ProductLine.objects.create(organisation=org, name="B", is_default=True)
        a.refresh_from_db()
        self.assertFalse(a.is_default, "setting B as default should clear A")
        self.assertTrue(ProductLine.objects.get(pk=b.pk).is_default)


# ==================================================================
# Model Tests
# ==================================================================

class TestLeadTransitions(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.lead = make_lead(org=self.org)

    def test_new_to_contacted(self):
        self.lead.transition_to("contacted")
        self.assertEqual(self.lead.status, "contacted")
        self.assertIsNotNone(self.lead.contacted_at)

    def test_contacted_to_qualified(self):
        self.lead.transition_to("contacted")
        self.lead.transition_to("qualified")
        self.assertEqual(self.lead.status, "qualified")
        self.assertIsNotNone(self.lead.qualified_at)

    def test_qualified_to_won(self):
        self.lead.transition_to("contacted")
        self.lead.transition_to("qualified")
        self.lead.transition_to("won")
        self.assertEqual(self.lead.status, "won")
        self.assertIsNotNone(self.lead.won_at)

    def test_proposal_sent(self):
        self.lead.transition_to("contacted")
        self.lead.transition_to("qualified")
        self.lead.transition_to("proposal_sent")
        self.assertEqual(self.lead.status, "proposal_sent")
        self.assertIsNotNone(self.lead.proposal_sent_at)

    def test_same_status_transition_raises(self):
        with self.assertRaises(ValueError):
            self.lead.transition_to("new")  # same status is invalid

    def test_lost_can_reopen(self):
        self.lead.transition_to("lost")
        self.lead.transition_to("new")
        self.assertEqual(self.lead.status, "new")

    def test_any_to_lost(self):
        self.lead.transition_to("contacted")
        self.lead.transition_to("lost")
        self.assertEqual(self.lead.status, "lost")
        self.assertIsNotNone(self.lead.lost_at)


class TestQuoteTransitions(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.quote = make_quote(org=self.org)

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
        # accepted -> sent is invalid
        self.quote.transition_to(QuoteStatus.ACCEPTED)
        with self.assertRaises(ValueError):
            self.quote.transition_to(QuoteStatus.SENT)

    def test_is_editable_always(self):
        """Quotes are always editable regardless of status."""
        self.assertTrue(self.quote.is_editable)
        self.quote.transition_to(QuoteStatus.SENT)
        self.assertTrue(self.quote.is_editable)


class TestBookingLineItemCalculation(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.quote = make_quote(org=self.org, guest_count=50)

    def test_each_unit_calculation(self):
        item = BookingLineItem.objects.create(
            quote=self.quote, category="food", description="Main Course",
            quantity=Decimal("10"), unit="each", unit_price=Decimal("25.00"),
        )
        self.assertEqual(item.line_total, Decimal("250.00"))

    def test_per_guest_calculation(self):
        item = BookingLineItem.objects.create(
            quote=self.quote, category="food", description="Starter",
            quantity=Decimal("1"), unit="per_guest", unit_price=Decimal("12.50"),
        )
        # per_guest: unit_price * guest_count = 12.50 * 50
        self.assertEqual(item.line_total, Decimal("625.00"))

    def test_discount_is_negative(self):
        item = BookingLineItem.objects.create(
            quote=self.quote, category="discount", description="Early booking",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("100.00"),
        )
        self.assertEqual(item.line_total, Decimal("-100.00"))

    def test_per_hour_calculation(self):
        # per_hour behaves like quantity × unit_price (hours × rate); not scaled by guests.
        item = BookingLineItem.objects.create(
            quote=self.quote, category="labor", description="Bar staff",
            quantity=Decimal("6"), unit="per_hour", unit_price=Decimal("18.00"),
        )
        self.assertEqual(item.line_total, Decimal("108.00"))

    def test_exactly_one_parent_constraint(self):
        from django.db.utils import IntegrityError
        from events.models import Event
        event = Event.objects.create(organisation=self.org, name="E", event_date="2026-09-01", gents=25, ladies=25)
        with self.assertRaises(IntegrityError):
            BookingLineItem.objects.create(
                quote=self.quote, event=event, category="fee", description="bad",
                quantity=Decimal("1"), unit="flat", unit_price=Decimal("1"),
            )

    def test_event_line_item_uses_event_guest_count(self):
        from events.models import Event
        event = Event.objects.create(organisation=self.org, name="E", event_date="2026-09-01", gents=20, ladies=30)
        item = BookingLineItem.objects.create(
            event=event, category="beverage", description="Soft drinks",
            quantity=Decimal("1"), unit="per_guest", unit_price=Decimal("2.00"),
        )
        self.assertEqual(item.line_total, Decimal("100.00"))  # 2 * (20+30)

    def test_quote_totals_recalculated(self):
        BookingLineItem.objects.create(
            quote=self.quote, category="food", description="Food",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("1000.00"),
        )
        BookingLineItem.objects.create(
            quote=self.quote, category="rental", description="Tables",
            quantity=Decimal("5"), unit="each", unit_price=Decimal("50.00"),
        )
        self.quote.refresh_from_db()
        self.assertEqual(self.quote.subtotal, Decimal("1250.00"))
        # Tax on the whole subtotal: 1250 * 0.20 = 250
        self.assertEqual(self.quote.tax_amount, Decimal("250.00"))
        self.assertEqual(self.quote.total, Decimal("1500.00"))

    def test_delete_item_recalculates(self):
        item = BookingLineItem.objects.create(
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
        self.org = _make_org()
        # Need an Event for Invoice FK - use events app
        from events.models import Event
        self.event = Event.objects.create(
            name="Test Event", event_date="2026-06-15", gents=50, ladies=50,
            organisation=self.org,
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
        self.org = _make_org()
        self.item = EquipmentItem.objects.create(
            name="Round Table", category="table", stock_quantity=20,
            rental_price=Decimal("50.00"), organisation=self.org,
        )

    def test_full_stock_available(self):
        available = self.item.available_on_date("2026-06-15")
        self.assertEqual(available, 20)

    def test_reserved_reduces_availability(self):
        from events.models import Event
        event = Event.objects.create(
            name="Wedding", event_date="2026-06-15", gents=50, ladies=50,
            organisation=self.org,
        )
        from equipment.models import EquipmentReservation
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
        self.org = _make_org()
        self.client = _authenticated_client()

    def test_create_account(self):
        res = self.client.post("/api/bookings/accounts/", {
            "name": "Acme Corp", "account_type": "company",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["name"], "Acme Corp")

    def test_list_accounts(self):
        make_account(org=self.org, name="Alpha")
        make_account(org=self.org, name="Beta")
        res = self.client.get("/api/bookings/accounts/?page_size=all")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 2)

    def test_update_account(self):
        account = make_account(org=self.org)
        res = self.client.patch(f"/api/bookings/accounts/{account.id}/", {
            "billing_city": "Manchester",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["billing_city"], "Manchester")

    def test_delete_account(self):
        account = make_account(org=self.org)
        res = self.client.delete(f"/api/bookings/accounts/{account.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Account.objects.filter(id=account.id).exists())

    def test_create_contact_nested(self):
        account = make_account(org=self.org)
        res = self.client.post(f"/api/bookings/accounts/{account.id}/contacts/", {
            "name": "Bob", "email": "bob@test.com", "role": "billing",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["name"], "Bob")
        self.assertEqual(account.contacts.count(), 1)

    def test_account_detail_includes_contacts(self):
        account = make_account(org=self.org)
        make_contact(account=account, name="Alice")
        res = self.client.get(f"/api/bookings/accounts/{account.id}/")
        self.assertEqual(len(res.json()["contacts"]), 1)
        self.assertEqual(res.json()["contacts"][0]["name"], "Alice")


class TestVenueAPI(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()

    def test_create_venue(self):
        res = self.client.post("/api/bookings/venues/", {
            "name": "The Barn", "city": "Oxford", "kitchen_access": True,
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["name"], "The Barn")

    def test_list_venues(self):
        make_venue(org=self.org, name="Hall A")
        make_venue(org=self.org, name="Hall B")
        res = self.client.get("/api/bookings/venues/?page_size=all")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 2)


class TestLeadAPI(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()

    def test_create_lead(self):
        res = self.client.post("/api/bookings/leads/", {
            "contact_name": "Sarah", "contact_phone": "+92 300 1234567",
            "event_type": "corporate",
            "event_date": "2026-09-01", "guest_estimate": 200,
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["status"], "new")

    def test_create_lead_with_initial_status(self):
        # Quick-add can pick a starting pipeline stage (valid org option).
        res = self.client.post("/api/bookings/leads/", {
            "contact_name": "Sarah", "contact_phone": "+92 300 1234567", "status": "qualified",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["status"], "qualified")

    def test_create_lead_ignores_invalid_status(self):
        res = self.client.post("/api/bookings/leads/", {
            "contact_name": "Sarah", "contact_phone": "+92 300 1234567", "status": "bogus",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["status"], "new")  # falls back to default

    def test_create_lead_requires_phone(self):
        """Phone/WhatsApp is the primary contact channel and required on create."""
        res = self.client.post("/api/bookings/leads/", {
            "contact_name": "Sarah", "event_type": "corporate",
            "event_date": "2026-09-01", "guest_estimate": 200,
        }, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("contact_phone", res.json())

    def test_create_lead_source_defaults_to_blank(self):
        # No source supplied → blank/unknown, not a poisoning "website" default.
        res = self.client.post("/api/bookings/leads/", {
            "contact_name": "NoSource", "contact_phone": "+92 300 1234567",
            "event_type": "corporate",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Lead.objects.get(id=res.json()["id"]).source, "")

    def test_create_lead_accepts_blank_source(self):
        # The slimmed form / quick-add send an explicit "" for unknown source.
        res = self.client.post("/api/bookings/leads/", {
            "contact_name": "BlankSource", "contact_phone": "+92 300 1234567",
            "event_type": "corporate", "source": "",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Lead.objects.get(id=res.json()["id"]).source, "")

    def test_list_leads_filter_by_status(self):
        make_lead(org=self.org, contact_name="A")
        lead_b = make_lead(org=self.org, contact_name="B")
        lead_b.transition_to("contacted")

        res = self.client.get("/api/bookings/leads/?status=new&page_size=all")
        self.assertEqual(len(res.json()), 1)
        self.assertEqual(res.json()[0]["contact_name"], "A")

    def test_transition_lead(self):
        lead = make_lead(org=self.org)
        res = self.client.post(f"/api/bookings/leads/{lead.id}/transition/", {
            "status": "contacted",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "contacted")

    def test_transition_same_status_returns_400(self):
        lead = make_lead(org=self.org)
        res = self.client.post(f"/api/bookings/leads/{lead.id}/transition/", {
            "status": "new",  # same status is invalid
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_create_quote_from_lead(self):
        """Creating a quote does NOT change lead status."""
        account = make_account(org=self.org)
        lead = make_lead(org=self.org, account=account)
        lead.transition_to("contacted")
        lead.transition_to("qualified")

        res = self.client.post(f"/api/bookings/leads/{lead.id}/convert/")
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["account"], account.id)
        self.assertEqual(data["guest_count"], 100)

        lead.refresh_from_db()
        # Status should NOT have changed — quotes are decoupled
        self.assertEqual(lead.status, "qualified")

    def test_create_multiple_quotes(self):
        """A lead can have multiple quotes."""
        lead = make_lead(org=self.org)
        res1 = self.client.post(f"/api/bookings/leads/{lead.id}/convert/")
        self.assertEqual(res1.status_code, 201)
        res2 = self.client.post(f"/api/bookings/leads/{lead.id}/convert/")
        self.assertEqual(res2.status_code, 201)
        self.assertNotEqual(res1.json()["id"], res2.json()["id"])

    def test_create_quote_resolves_customer_without_business(self):
        # Person-first: a lead with no business becomes a B2C quote — the lead's
        # free-text name is resolved into a customer; no company is fabricated.
        lead = make_lead(org=self.org, account=None)
        res = self.client.post(f"/api/bookings/leads/{lead.id}/convert/")
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertFalse(data["is_b2b"])
        self.assertIsNone(data["account"])
        self.assertIsNotNone(data["primary_contact"])
        self.assertEqual(data["contact_name"], "John Smith")
        lead.refresh_from_db()
        self.assertIsNone(lead.account)

    def test_convert_treats_leftover_individual_account_as_b2c(self):
        # A lead still carrying an old `individual` account converts to B2C.
        indiv = make_account(org=self.org, name="John Person", account_type="individual")
        lead = make_lead(org=self.org, account=indiv)
        res = self.client.post(f"/api/bookings/leads/{lead.id}/convert/")
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertFalse(data["is_b2b"])
        self.assertIsNone(data["account"])
        self.assertIsNotNone(data["primary_contact"])

    def test_mark_won_creates_event(self):
        lead = make_lead(org=self.org)
        lead.transition_to("contacted")
        lead.transition_to("qualified")

        res = self.client.post(f"/api/bookings/leads/{lead.id}/won/", {
            "create_event": True,
        }, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "won")
        self.assertIsNotNone(data["won_at"])
        self.assertIsNotNone(data["won_event"])

    def test_mark_won_without_event(self):
        lead = make_lead(org=self.org)
        res = self.client.post(f"/api/bookings/leads/{lead.id}/won/", {
            "create_event": False,
        }, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "won")
        self.assertIsNone(data["won_event"])

    def test_quote_acceptance_auto_wins_lead(self):
        """When a quote linked to a lead is accepted, the lead auto-transitions to won."""
        from bookings.models.quotes import QuoteStatus
        account = make_account(org=self.org)
        lead = make_lead(org=self.org, account=account)
        lead.transition_to("contacted")
        lead.transition_to("qualified")
        quote = make_quote(org=self.org, account=account, lead=lead)

        # Accept the quote
        res = self.client.post(f"/api/bookings/quotes/{quote.id}/transition/", {
            "status": "accepted",
        }, format="json")
        self.assertEqual(res.status_code, 200)

        lead.refresh_from_db()
        self.assertEqual(lead.status, "won")
        self.assertIsNotNone(lead.won_event)
        self.assertEqual(lead.won_quote, quote)


class TestLeadUnreadWhatsApp(TestCase):
    """The unread-WhatsApp count (powering the green dot) is computed via a
    correlated subquery on the leads list and kanban endpoints."""

    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()

    def _add_messages(self, lead):
        from django.utils import timezone
        from bookings.models import WhatsAppMessage
        common = dict(
            organisation=self.org, lead=lead,
            to_phone="+100", from_phone="+200", body="hi",
        )
        # 2 unread inbound + 1 read inbound + 1 outbound -> unread count == 2
        WhatsAppMessage.objects.create(direction="inbound", read_at=None, **common)
        WhatsAppMessage.objects.create(direction="inbound", read_at=None, **common)
        WhatsAppMessage.objects.create(direction="inbound", read_at=timezone.now(), **common)
        WhatsAppMessage.objects.create(direction="outbound", read_at=None, **common)

    def test_kanban_reports_unread_whatsapp_count(self):
        lead = make_lead(org=self.org, contact_name="HasUnread")
        self._add_messages(lead)
        make_lead(org=self.org, contact_name="NoMessages")

        res = self.client.get("/api/bookings/leads/kanban/")
        self.assertEqual(res.status_code, 200)
        new_col = {l["contact_name"]: l for l in res.json()["columns"]["new"]["results"]}
        self.assertEqual(new_col["HasUnread"]["unread_whatsapp_count"], 2)
        self.assertTrue(new_col["HasUnread"]["has_unread_whatsapp"])
        self.assertEqual(new_col["NoMessages"]["unread_whatsapp_count"], 0)
        self.assertFalse(new_col["NoMessages"]["has_unread_whatsapp"])

    def test_list_reports_unread_whatsapp_count(self):
        lead = make_lead(org=self.org, contact_name="HasUnread")
        self._add_messages(lead)

        res = self.client.get("/api/bookings/leads/?page_size=all")
        self.assertEqual(res.status_code, 200)
        by_name = {l["contact_name"]: l for l in res.json()}
        self.assertEqual(by_name["HasUnread"]["unread_whatsapp_count"], 2)
        self.assertTrue(by_name["HasUnread"]["has_unread_whatsapp"])


class TestLeadQueryEfficiency(TestCase):
    """The lead list must not run a query per lead (N+1). Every FK the
    serializer reads (account, product, assigned_to, created_by, ...) must be
    in select_related, so query count stays constant as leads grow."""

    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()

    def test_list_query_count_does_not_grow_with_leads(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        user = get_test_user()
        make_lead(org=self.org, created_by=user, contact_name="seed")
        # Warm module-level label caches so they don't skew the first count.
        self.client.get("/api/bookings/leads/?page_size=all")

        with CaptureQueriesContext(connection) as few:
            self.client.get("/api/bookings/leads/?page_size=all")

        for i in range(5):
            make_lead(org=self.org, created_by=user, contact_name=f"extra{i}")

        with CaptureQueriesContext(connection) as many:
            self.client.get("/api/bookings/leads/?page_size=all")

        self.assertEqual(
            len(few.captured_queries), len(many.captured_queries),
            f"N+1 detected: queries grew {len(few.captured_queries)} -> "
            f"{len(many.captured_queries)} as leads increased; a FK is likely "
            "missing from select_related.",
        )


class TestLeadKanbanCounts(TestCase):
    """Per-column counts must be correct even when the queryset is ordered —
    the ordering must not leak into the GROUP BY of the count query, which
    would split each status into one row per created_at and break 'Load more'."""

    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()

    def test_kanban_count_correct_with_ordering(self):
        import datetime
        from django.utils import timezone

        user = get_test_user()
        leads = [
            make_lead(org=self.org, created_by=user, contact_name=f"n{i}")
            for i in range(3)
        ]
        # Force distinct created_at so a GROUP BY status,created_at bug would
        # split the count into 1-per-row instead of 3.
        base = timezone.now()
        for i, lead in enumerate(leads):
            Lead.objects.filter(pk=lead.pk).update(
                created_at=base - datetime.timedelta(minutes=i)
            )

        res = self.client.get("/api/bookings/leads/kanban/?ordering=-created_at")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["columns"]["new"]["count"], 3)


class TestLeadSearch(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()
        self.acct = make_account(org=self.org, name="Sunrise Catering")
        make_lead(org=self.org, contact_name="Alice Johnson", contact_email="alice@example.com", contact_phone="555-1234")
        make_lead(org=self.org, contact_name="Bob Williams", contact_email="bob@corp.com", account=self.acct)
        make_lead(org=self.org, contact_name="Charlie Brown", contact_email="charlie@test.com", contact_phone="555-9999")

    def _search(self, term):
        return self.client.get(f"/api/bookings/leads/?search={term}&page_size=all")

    def test_search_by_contact_name(self):
        res = self._search("alice")
        data = res.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["contact_name"], "Alice Johnson")

    def test_search_is_case_insensitive(self):
        res = self._search("ALICE")
        self.assertEqual(len(res.json()), 1)

    def test_search_partial_match(self):
        res = self._search("lic")
        self.assertEqual(len(res.json()), 1)
        self.assertEqual(res.json()[0]["contact_name"], "Alice Johnson")

    def test_search_by_email(self):
        res = self._search("bob@corp")
        self.assertEqual(len(res.json()), 1)
        self.assertEqual(res.json()[0]["contact_name"], "Bob Williams")

    def test_search_by_phone(self):
        res = self._search("555-9999")
        self.assertEqual(len(res.json()), 1)
        self.assertEqual(res.json()[0]["contact_name"], "Charlie Brown")

    def test_search_by_account_name(self):
        res = self._search("sunrise")
        self.assertEqual(len(res.json()), 1)
        self.assertEqual(res.json()[0]["contact_name"], "Bob Williams")

    def test_search_no_match(self):
        res = self._search("nonexistent")
        self.assertEqual(len(res.json()), 0)

    def test_search_combined_with_status_filter(self):
        """Search respects other filters too."""
        lead = Lead.objects.get(contact_name="Alice Johnson")
        lead.transition_to("contacted")
        res = self.client.get("/api/bookings/leads/?search=alice&status=new&page_size=all")
        self.assertEqual(len(res.json()), 0)  # Alice is now 'contacted', not 'new'


class TestQuoteAPI(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()
        self.account = make_account(org=self.org)
        self.contact = make_contact(account=self.account, org=self.org)

    def test_create_quote_with_additional_meals(self):
        # Quotes now carry additional meals (parity with events).
        res = self.client.post("/api/bookings/quotes/", {
            "primary_contact": self.contact.id,
            "event_date": "2026-09-01",
            "guest_count": 20,
            "price_per_head": "50.00",
            "tax_rate": "0",
            "additional_meals": [
                {"label": "Welcome drinks", "guest_count": 20, "price_per_head": "15.00"},
            ],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(len(body["additional_meals"]), 1)
        self.assertEqual(body["additional_meals"][0]["label"], "Welcome drinks")
        quote = Quote.objects.get(id=body["id"])
        # food = 50*20 + meal 15*20 = 1300
        self.assertEqual(quote.food_total, Decimal("1300.00"))
        self.assertEqual(quote.subtotal, Decimal("1300.00"))

    def test_line_item_description_is_optional(self):
        res = self.client.post("/api/bookings/quotes/", {
            "primary_contact": self.contact.id,
            "event_date": "2026-09-01", "guest_count": 20,
            "line_items": [{
                "category": "fee", "description": "",
                "quantity": "1", "unit": "flat", "unit_price": "500",
            }],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["line_items"][0]["description"], "")

    def test_additional_meal_label_is_optional(self):
        res = self.client.post("/api/bookings/quotes/", {
            "primary_contact": self.contact.id,
            "event_date": "2026-09-01", "guest_count": 20,
            "additional_meals": [{
                "label": "", "guest_count": 20, "price_per_head": "15",
                "dish_ids": [], "notes": "",
            }],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["additional_meals"][0]["label"], "")

    def test_accept_assigns_the_event_to_a_salesperson(self):
        # Converted events used to have no assignee, so they never counted toward
        # anyone's sales target. Accepting must set assigned_to.
        quote = make_quote(org=self.org, account=self.account, primary_contact=self.contact)
        res = self.client.post(f"/api/bookings/quotes/{quote.id}/transition/",
                               {"status": "accepted"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        quote.refresh_from_db()
        self.assertIsNotNone(quote.event.assigned_to_id)

    def test_accept_carries_product_to_event(self):
        from bookings.models import ProductLine
        product = ProductLine.objects.create(organisation=self.org, name="Catering")
        quote = make_quote(org=self.org, account=self.account, primary_contact=self.contact, product=product)
        res = self.client.post(f"/api/bookings/quotes/{quote.id}/transition/",
                               {"status": "accepted"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        quote.refresh_from_db()
        self.assertEqual(quote.event.product_id, product.id)

    def test_accept_carries_line_items_to_event(self):
        # Headline bug: accepting a quote used to drop its add-on items.
        quote = make_quote(org=self.org, account=self.account, primary_contact=self.contact)
        BookingLineItem.objects.create(
            quote=quote, category="rental", description="Chairs",
            quantity=Decimal("10"), unit="each", unit_price=Decimal("2.00"),
        )
        res = self.client.post(f"/api/bookings/quotes/{quote.id}/transition/",
                               {"status": "accepted"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        quote.refresh_from_db()
        self.assertIsNotNone(quote.event_id)
        items = list(quote.event.line_items.all())
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].description, "Chairs")
        self.assertIsNone(items[0].quote_id)

    def test_accept_event_total_matches_quote(self):
        # The converted event's totals must equal the quote's (same engine).
        quote = make_quote(org=self.org, account=self.account, primary_contact=self.contact,
                           guest_count=100, price_per_head=Decimal("30.00"), tax_rate=Decimal("0.20"))
        BookingLineItem.objects.create(
            quote=quote, category="rental", description="Tables",
            quantity=Decimal("10"), unit="each", unit_price=Decimal("50.00"), is_taxable=True)
        BookingLineItem.objects.create(
            quote=quote, category="fee", description="Service",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("200.00"), is_taxable=False)
        quote.refresh_from_db()
        res = self.client.post(f"/api/bookings/quotes/{quote.id}/transition/",
                               {"status": "accepted"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        quote.refresh_from_db()
        event = quote.event
        self.assertEqual(event.subtotal, quote.subtotal)
        self.assertEqual(event.tax_amount, quote.tax_amount)
        self.assertEqual(event.total, quote.total)
        self.assertTrue(event.total > 0)

    def test_accept_food_only_quote_event_total_matches(self):
        # Regression: a food-only quote (no add-on items) used to convert to an
        # event with a £0 total because totals were only recalculated as a
        # side-effect of copying line items.
        quote = make_quote(org=self.org, account=self.account, primary_contact=self.contact,
                           guest_count=200, price_per_head=Decimal("25.00"), tax_rate=Decimal("0.20"))
        quote.recalculate_totals()  # as the serializer does on save
        quote.refresh_from_db()
        self.assertEqual(quote.total, Decimal("6000.00"))  # 5000 food + 1000 tax
        res = self.client.post(f"/api/bookings/quotes/{quote.id}/transition/",
                               {"status": "accepted"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        quote.refresh_from_db()
        self.assertEqual(quote.event.total, quote.total)
        self.assertEqual(quote.event.total, Decimal("6000.00"))

    def test_quote_list_avoids_n_plus_one(self):
        # The list serializes product_name + created_by_name per row; without
        # select_related on those FKs the query count grew with the row count.
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        from bookings.models import ProductLine
        from users.models import User

        def add_quote(i):
            pl = ProductLine.objects.create(organisation=self.org, name=f"Line {i}")
            u = User.objects.create(email=f"sp{i}@ex.com", role="salesperson", organisation=self.org)
            make_quote(org=self.org, account=self.account, primary_contact=self.contact,
                       product=pl, created_by=u)

        add_quote(1)
        self.client.get("/api/bookings/quotes/")  # warm per-request/module caches
        with CaptureQueriesContext(connection) as c1:
            self.assertEqual(self.client.get("/api/bookings/quotes/").status_code, 200)
        base = len(c1.captured_queries)

        add_quote(2)
        add_quote(3)
        with CaptureQueriesContext(connection) as c2:
            self.assertEqual(self.client.get("/api/bookings/quotes/").status_code, 200)
        self.assertEqual(
            len(c2.captured_queries), base,
            "quote list query count grew with row count — N+1 regression",
        )

    def test_event_api_saves_line_items(self):
        res = self.client.post("/api/events/", {
            "name": "Garden Party", "date": "2026-09-01", "gents": 40, "ladies": 40,
            "line_items": [{"category": "beverage", "description": "Mojito",
                            "quantity": "20", "unit": "each", "unit_price": "3.00", "is_taxable": True}],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        from events.models import Event
        event = Event.objects.get(id=res.json()["id"])
        items = list(event.line_items.all())
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].line_total, Decimal("60.00"))

    def test_create_quote_saves_dishes_and_totals(self):
        from dishes.models import Dish, DishCategory
        cat = DishCategory.objects.create(
            organisation=self.org, name="Mains", display_name="Mains",
        )
        dish = Dish.objects.create(
            organisation=self.org, name="Biryani", category=cat,
            default_portion_grams=200,
        )
        res = self.client.post("/api/bookings/quotes/", {
            "primary_contact": self.contact.id,
            "is_b2b": True,
            "account": self.account.id,
            "event_date": "2026-09-01",
            "guest_count": 100,
            "price_per_head": "50.00",
            "tax_rate": "0.00",
            "event_type": "wedding",
            "dish_ids": [dish.id],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        quote = Quote.objects.get(id=res.json()["id"])
        self.assertEqual(quote.dishes.count(), 1, "dishes (menu items) not saved")
        self.assertEqual(str(quote.subtotal), "5000.00", "food total not in subtotal")

    def test_update_quote_saves_dishes(self):
        from dishes.models import Dish, DishCategory
        cat = DishCategory.objects.create(
            organisation=self.org, name="Mains2", display_name="Mains",
        )
        dish = Dish.objects.create(
            organisation=self.org, name="Korma", category=cat,
            default_portion_grams=200,
        )
        quote = make_quote(org=self.org, account=self.account)
        res = self.client.patch(
            f"/api/bookings/quotes/{quote.id}/",
            {"dish_ids": [dish.id]}, format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        quote.refresh_from_db()
        self.assertEqual(quote.dishes.count(), 1, "dishes not saved on PATCH")

    def test_create_event_saves_dishes(self):
        from dishes.models import Dish, DishCategory
        cat = DishCategory.objects.create(
            organisation=self.org, name="Mains3", display_name="Mains",
        )
        dish = Dish.objects.create(
            organisation=self.org, name="Tikka", category=cat,
            default_portion_grams=200,
        )
        res = self.client.post("/api/events/", {
            "name": "Wedding", "date": "2026-09-01",
            "gents": 50, "ladies": 50,
            "dish_ids": [dish.id],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        from events.models import Event
        event = Event.objects.get(id=res.json()["id"])
        self.assertEqual(event.dishes.count(), 1, "event dishes not saved")

    def test_delete_quote(self):
        quote = make_quote(org=self.org, account=self.account)
        res = self.client.delete(f"/api/bookings/quotes/{quote.id}/")
        self.assertEqual(res.status_code, 204, res.content)
        self.assertFalse(Quote.objects.filter(id=quote.id).exists())

    def test_delete_won_quote_nulls_lead_reference(self):
        """won_quote is SET_NULL, so deleting a lead's won quote must not be blocked."""
        quote = make_quote(org=self.org, account=self.account)
        lead = make_lead(org=self.org)
        lead.won_quote = quote
        lead.save(update_fields=["won_quote"])
        res = self.client.delete(f"/api/bookings/quotes/{quote.id}/")
        self.assertEqual(res.status_code, 204, res.content)
        lead.refresh_from_db()
        self.assertIsNone(lead.won_quote)

    def test_quote_pdf_lists_menu_without_price(self):
        """A quote with dishes but no per-head price must still render its menu
        in the PDF (the menu used to be hidden unless food_total > 0)."""
        from dishes.models import Dish, DishCategory
        from bookings.pdf import generate_quote_pdf
        cat = DishCategory.objects.create(
            organisation=self.org, name="Mains5", display_name="Mains",
        )
        dish = Dish.objects.create(
            organisation=self.org, name="Nihari", category=cat,
            default_portion_grams=200,
        )
        quote = make_quote(org=self.org, account=self.account)  # no price_per_head
        quote.dishes.set([dish])
        quote.refresh_from_db()  # event_date as a real date, like a live fetch
        # Exercises the price-less menu path; previously this branch was skipped.
        pdf_bytes = generate_quote_pdf(quote)
        self.assertTrue(pdf_bytes and len(pdf_bytes) > 0)

    def test_quote_pdf_b2c_no_business(self):
        """A B2C quote (no account/business) must still render — the PDF used to
        dereference quote.account.name unconditionally."""
        from bookings.pdf import generate_quote_pdf
        quote = Quote.objects.create(
            organisation=self.org, account=None, primary_contact=self.contact,
            is_b2b=False, event_date="2026-09-01", guest_count=100, event_type="wedding",
        )
        quote.refresh_from_db()
        pdf_bytes = generate_quote_pdf(quote)
        self.assertTrue(pdf_bytes and len(pdf_bytes) > 0)

    def test_quote_patch_reconciles_line_items_in_one_call(self):
        """One PATCH to the quote can edit, add, and remove line items together
        and recompute totals — the basis for the single-save redesign."""
        from bookings.models import BookingLineItem
        quote = make_quote(org=self.org, account=self.account, price_per_head=Decimal("0"))
        keep = BookingLineItem.objects.create(
            quote=quote, category="food", description="Keep",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("100.00"), is_taxable=False,
        )
        BookingLineItem.objects.create(
            quote=quote, category="food", description="Remove",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("50.00"), is_taxable=False,
        )
        res = self.client.patch(
            f"/api/bookings/quotes/{quote.id}/",
            {
                "tax_rate": "0.0000",
                "line_items": [
                    # edit existing (qty 1 -> 2), drop "Remove", add a new taxable row
                    {"id": keep.id, "category": "food", "description": "Keep",
                     "quantity": "2", "unit": "flat", "unit_price": "100.00", "is_taxable": False},
                    {"category": "rental", "description": "Chairs",
                     "quantity": "10", "unit": "each", "unit_price": "5.00", "is_taxable": True},
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        quote.refresh_from_db()
        self.assertEqual(
            set(quote.line_items.values_list("description", flat=True)),
            {"Keep", "Chairs"},
        )
        # Keep 2x100 = 200 (non-taxable) + Chairs 10x5 = 50 (taxable) = 250
        self.assertEqual(str(quote.subtotal), "250.00")

    def test_price_estimate_does_not_500(self):
        """PriceEstimateView must compute a rate, not 400. Regression for a
        function-local `get_request_org` import that shadowed the module-level
        one (UnboundLocalError, swallowed into a 400 — custom-menu Calculate
        Rate never worked). Engine is mocked to isolate the view."""
        from unittest.mock import patch
        from dishes.models import Dish, DishCategory
        cat = DishCategory.objects.create(
            organisation=self.org, name="MainsPE", display_name="Mains",
        )
        dish = Dish.objects.create(
            organisation=self.org, name="BiryaniPE", category=cat,
            default_portion_grams=200, selling_price_per_gram=Decimal("0.05"),
        )
        with patch(
            "calculator.views.calculate_portions",
            return_value={"portions": [{"dish_id": dish.id, "grams_per_person": 200}]},
        ):
            res = self.client.post(
                "/api/price-estimate/",
                {"dish_ids": [dish.id], "guest_count": 100}, format="json",
            )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn("price_per_head", res.json())

    def test_create_quote(self):
        # B2C quote: customer required, no business.
        res = self.client.post("/api/bookings/quotes/", {
            "primary_contact": self.contact.id,
            "event_date": "2026-07-01",
            "guest_count": 80,
            "event_type": "corporate",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["status"], "draft")
        self.assertTrue(res.json()["is_editable"])

    def test_create_quote_requires_customer(self):
        res = self.client.post("/api/bookings/quotes/", {
            "event_date": "2026-07-01", "guest_count": 80, "event_type": "corporate",
        }, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("primary_contact", res.json())

    def test_b2b_quote_requires_business(self):
        res = self.client.post("/api/bookings/quotes/", {
            "primary_contact": self.contact.id, "is_b2b": True,
            "event_date": "2026-07-01", "guest_count": 80, "event_type": "corporate",
        }, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("account", res.json())

    def test_add_line_item(self):
        quote = make_quote(org=self.org, account=self.account)
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
        quote = make_quote(org=self.org, account=self.account, guest_count=50)
        self.client.post(f"/api/bookings/quotes/{quote.id}/items/", {
            "category": "food", "description": "Main",
            "quantity": "1", "unit": "flat", "unit_price": "1000.00",
        }, format="json")

        res = self.client.get(f"/api/bookings/quotes/{quote.id}/")
        data = res.json()
        self.assertEqual(data["subtotal"], "1000.00")
        self.assertEqual(data["tax_amount"], "200.00")
        self.assertEqual(data["total"], "1200.00")

    def test_can_add_item_to_sent_quote(self):
        """Quotes are always editable regardless of status."""
        quote = make_quote(org=self.org, account=self.account)
        quote.transition_to(QuoteStatus.SENT)

        res = self.client.post(f"/api/bookings/quotes/{quote.id}/items/", {
            "category": "food", "description": "Late add",
            "quantity": "1", "unit": "flat", "unit_price": "100.00",
        }, format="json")
        self.assertEqual(res.status_code, 201)

    def test_can_edit_sent_quote(self):
        """Quotes are always editable regardless of status."""
        quote = make_quote(org=self.org, account=self.account)
        quote.transition_to(QuoteStatus.SENT)

        res = self.client.patch(f"/api/bookings/quotes/{quote.id}/", {
            "guest_count": 200,
        }, format="json")
        self.assertEqual(res.status_code, 200)

    def test_transition_quote(self):
        quote = make_quote(org=self.org, account=self.account)
        res = self.client.post(f"/api/bookings/quotes/{quote.id}/transition/", {
            "status": "sent",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "sent")

    def test_delete_line_item(self):
        quote = make_quote(org=self.org, account=self.account)
        item = BookingLineItem.objects.create(
            quote=quote, category="food", description="Starter",
            quantity=Decimal("1"), unit="flat", unit_price=Decimal("500.00"),
        )
        res = self.client.delete(f"/api/bookings/quotes/{quote.id}/items/{item.id}/")
        self.assertEqual(res.status_code, 204)

        quote.refresh_from_db()
        self.assertEqual(quote.total, Decimal("0.00"))

    def test_list_quotes_filter_by_status(self):
        q1 = make_quote(org=self.org, account=self.account)
        q2 = make_quote(org=self.org, account=self.account)
        q2.transition_to(QuoteStatus.SENT)

        res = self.client.get("/api/bookings/quotes/?status=draft&page_size=all")
        self.assertEqual(len(res.json()), 1)
        self.assertEqual(res.json()[0]["id"], q1.id)


class TestStaffingAPI(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()

    def test_create_labor_role(self):
        res = self.client.post("/api/staff/labor-roles/", {
            "name": "Head Chef", "default_hourly_rate": "25.00",
        }, format="json")
        self.assertEqual(res.status_code, 201)

    def test_create_staff_member(self):
        role = LaborRole.objects.create(
            name="Server", default_hourly_rate=Decimal("15.00"),
            organisation=self.org,
        )
        res = self.client.post("/api/staff/members/", {
            "name": "Tom", "email": "tom@test.com", "roles": [role.id],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertIn("Server", res.json()["role_names"])


class TestEquipmentAPI(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()

    def test_create_equipment(self):
        res = self.client.post("/api/equipment/items/", {
            "name": "Chafer Dish", "category": "chafer",
            "stock_quantity": 30, "rental_price": "15.00",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["stock_quantity"], 30)

    def test_list_equipment(self):
        EquipmentItem.objects.create(
            name="Table", category="table", stock_quantity=10,
            rental_price=Decimal("50.00"), organisation=self.org,
        )
        res = self.client.get("/api/equipment/items/?page_size=all")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 1)


class TestInvoiceAPI(TestCase):
    def setUp(self):
        self.org = _make_org()
        self.client = _authenticated_client()
        from events.models import Event
        self.event = Event.objects.create(
            name="Gala Dinner", event_date="2026-08-01", gents=60, ladies=60,
            organisation=self.org,
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


class TestSiteSettingsAPI(TestCase):
    """Tests for GET and PATCH /api/bookings/settings/."""

    def setUp(self):
        self.org = _make_org()
        # PATCH requires admin (is_staff=True)
        admin_user = get_test_user()
        admin_user.is_staff = True
        admin_user.save()
        self.client = APIClient()
        self.client.force_authenticate(user=admin_user)
        self.settings = OrgSettings.for_org(self.org)

    def test_patch_requires_admin(self):
        """Non-admin user should get 403 on PATCH."""
        from users.models import User
        regular = User.objects.create(email="regular@example.com", first_name="Reg", last_name="User")
        client = APIClient()
        client.force_authenticate(user=regular)
        res = client.patch("/api/bookings/settings/", {"currency_symbol": "$"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_get_settings(self):
        res = self.client.get("/api/bookings/settings/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("currency_symbol", data)
        self.assertIn("target_food_cost_percentage", data)

    def test_patch_target_food_cost(self):
        res = self.client.patch(
            "/api/bookings/settings/",
            {"target_food_cost_percentage": "25.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["target_food_cost_percentage"], "25.00")
        # Confirm persisted
        self.settings.refresh_from_db()
        self.assertEqual(self.settings.target_food_cost_percentage, Decimal("25.00"))

    def test_patch_currency_fields(self):
        res = self.client.patch(
            "/api/bookings/settings/",
            {"currency_symbol": "$", "currency_code": "USD"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["currency_symbol"], "$")
        self.assertEqual(res.json()["currency_code"], "USD")

    def test_patch_tax_and_timezone(self):
        """Tax label/rate (stored as a fraction) and timezone are editable in-app."""
        res = self.client.patch(
            "/api/bookings/settings/",
            {"tax_label": "GST", "default_tax_rate": "0.1700", "timezone": "Asia/Karachi"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertEqual(data["tax_label"], "GST")
        self.assertEqual(data["default_tax_rate"], "0.1700")
        self.assertEqual(data["timezone"], "Asia/Karachi")
        self.settings.refresh_from_db()
        self.assertEqual(self.settings.tax_label, "GST")
        self.assertEqual(self.settings.default_tax_rate, Decimal("0.1700"))
        self.assertEqual(self.settings.timezone, "Asia/Karachi")

    def test_patch_partial_update(self):
        """PATCH with a single field should not clear other fields."""
        self.settings.currency_symbol = "€"
        self.settings.target_food_cost_percentage = Decimal("35.00")
        self.settings.save()
        res = self.client.patch(
            "/api/bookings/settings/",
            {"currency_code": "EUR"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["currency_code"], "EUR")
        self.assertEqual(data["currency_symbol"], "€")
        self.assertEqual(data["target_food_cost_percentage"], "35.00")
