"""The four live money bugs from the 2026-08-06 audit (REL-462).

Each one produced a WRONG STORED NUMBER on the current architecture, and each was
invisible: no error, no warning, a 200 from the API. They are pinned here together
because they share a shape — the stored money stops matching what the engine would
compute, and only the customer's invoice shows it.

1. lead→event conversion carried price/head and tax but not the service charge or
   gratuity, so an event won through the lead board priced BELOW its quote;
2. `.quantize()` defaults to HALF_EVEN, so a stored line total could land a cent
   under the live preview, which rounds half-up;
3. Django admin let money outputs be typed directly, and never recomputed after an
   input changed;
4. `per_guest` line totals were trusted, so a PATCH that moved `guest_count` without
   resending the lines summed stale values.
"""
from decimal import Decimal

from django.contrib.admin.sites import AdminSite
from django.test import TestCase
from rest_framework.test import APIClient

from bookings.admin import QuoteAdmin
from bookings.models import Contact, Lead, Quote
from bookings.models.addons import BookingLineItem
from bookings.models.quotes import LineItemCategory, LineItemUnit
from events.admin import EventAdmin
from events.models import BookingGuestCount, BookingMeal, Event
from rules.models import GuestSegment
from tests.base import get_test_user


class MoneyBleedingBase(TestCase):
    def setUp(self):
        self.user = get_test_user()
        self.org = self.user.organisation
        self.contact = Contact.objects.create(organisation=self.org, name='Client')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _quote(self, **kwargs):
        fields = dict(
            organisation=self.org, primary_contact=self.contact,
            event_date='2026-05-01', guest_count=100, price_per_head=Decimal('50'),
            is_taxable=False, tax_rate=Decimal('0'),
        )
        fields.update(kwargs)
        quote = Quote.objects.create(**fields)
        quote.recalculate_totals()
        quote.refresh_from_db()
        return quote

    def _event(self, **kwargs):
        fields = dict(
            organisation=self.org, name='Ev', event_date='2026-05-01',
            guest_count=100, price_per_head=Decimal('50'),
            is_taxable=False, tax_rate=Decimal('0'), status='confirmed',
        )
        fields.update(kwargs)
        event = Event.objects.create(**fields)
        event.recalculate_totals()
        event.refresh_from_db()
        return event


# ── Bug 1: the conversion that under-bills ────────────────────────────────────

class LeadConversionCarriesPricingTests(MoneyBleedingBase):
    """AC1–AC2. Quote acceptance was fixed for this in an earlier ticket; winning the
    lead was the same conversion by another door, and still dropped the charges."""

    def _lead(self):
        return Lead.objects.create(
            organisation=self.org, contact_name='Lead Person',
            contact_email='lead@example.com', event_date='2026-05-01',
            guest_estimate=100,
        )

    def _win(self, lead, quote=None):
        res = self.client.post(
            f'/api/bookings/leads/{lead.id}/won/',
            {'create_event': True, **({'quote_id': quote.id} if quote else {})},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)
        lead.refresh_from_db()
        return lead.won_event

    def test_the_won_event_carries_the_service_charge_and_gratuity(self):
        """AC1. THE regression: 20% service charge + 15% gratuity on a £5,000 quote is
        £6,750. Dropping them made the same booking £5,000 — a £1,750 hole."""
        lead = self._lead()
        quote = self._quote(
            lead=lead, service_charge_pct=Decimal('20'),
            service_charge_taxable=True, gratuity_pct=Decimal('15'),
        )
        # Guard the fixture: the charges really are ON.
        self.assertEqual(quote.total, Decimal('6750.00'))

        event = self._win(lead, quote)

        self.assertEqual(event.service_charge_pct, Decimal('20'))
        self.assertEqual(event.service_charge_taxable, True)
        self.assertEqual(event.gratuity_pct, Decimal('15'))
        self.assertEqual(event.service_charge, Decimal('1000.00'))
        self.assertEqual(event.gratuity, Decimal('750.00'))
        self.assertEqual(event.total, quote.total)

    def test_a_non_taxable_service_charge_carries_its_flag(self):
        """AC1, OFF state of the flag — carrying `service_charge_pct` but defaulting
        `service_charge_taxable` to True would over-tax instead of under-bill."""
        lead = self._lead()
        quote = self._quote(
            lead=lead, service_charge_pct=Decimal('20'), service_charge_taxable=False,
            gratuity_pct=Decimal('0'), is_taxable=True, tax_rate=Decimal('0.10'),
        )
        event = self._win(lead, quote)

        self.assertEqual(event.service_charge_taxable, False)
        self.assertEqual(event.tax_amount, quote.tax_amount)
        self.assertEqual(event.total, quote.total)

    def test_the_won_event_carries_the_meals_and_the_segment_breakdown(self):
        """AC2. Both feed the food total, and the segments also drive portioning."""
        lead = self._lead()
        quote = self._quote(lead=lead)
        kids = GuestSegment.objects.create(
            organisation=self.org, name='Kids REL462', counts_toward_total=True,
            price_multiplier=Decimal('0.5000'), portion_multiplier=0.6, sort_order=7,
        )
        BookingGuestCount.objects.create(quote=quote, segment=kids, count=12)
        BookingMeal.objects.create(
            quote=quote, label='Welcome canapés', guest_count=30,
            price_per_head=Decimal('10'),
        )
        quote.recalculate_totals()
        quote.refresh_from_db()

        event = self._win(lead, quote)

        self.assertEqual(
            [(r.segment.name, r.count) for r in event.guest_counts.all()],
            [(kids.name, 12)],
        )
        self.assertEqual(
            [(m.label, m.guest_count, m.price_per_head)
             for m in event.additional_meals.all()],
            [('Welcome canapés', 30, Decimal('10.00'))],
        )
        # The meal food is IN the subtotal, and the kids are priced at half rate.
        self.assertEqual(event.subtotal, quote.subtotal)
        self.assertEqual(event.food_total, quote.food_total)

    def test_a_non_taxable_quote_does_not_become_a_taxable_event(self):
        """The lead path used to decide taxability from the RATE alone
        (`bool(quote.tax_rate > 0)`), ignoring the quote's own `is_taxable` flag — so
        a quote explicitly marked non-taxable produced an event that charged tax.
        Sharing acceptance's rule fixes it; this pins the direction."""
        lead = self._lead()
        quote = self._quote(lead=lead, is_taxable=False, tax_rate=Decimal('0.20'))
        self.assertEqual(quote.tax_amount, Decimal('0.00'))

        event = self._win(lead, quote)

        self.assertFalse(event.is_taxable)
        self.assertEqual(event.tax_amount, Decimal('0.00'))
        self.assertEqual(event.total, quote.total)

    def test_the_separate_create_event_endpoint_carries_the_charges_too(self):
        """The other door onto the same conversion: a lead already won, then
        `POST /create-event/`. It delegates to the same `_create_event`, and this
        asserts that surface rather than trusting the delegation."""
        lead = self._lead()
        quote = self._quote(
            lead=lead, service_charge_pct=Decimal('20'), gratuity_pct=Decimal('15'),
        )
        res = self.client.post(
            f'/api/bookings/leads/{lead.id}/won/', {'create_event': False}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)

        res = self.client.post(
            f'/api/bookings/leads/{lead.id}/create-event/',
            {'quote_id': quote.id}, format='json',
        )
        self.assertEqual(res.status_code, 201, res.data)

        event = Event.objects.get(pk=res.data['id'])
        self.assertEqual(event.service_charge_pct, Decimal('20'))
        self.assertEqual(event.gratuity_pct, Decimal('15'))
        self.assertEqual(event.total, quote.total)

    def test_a_lead_won_with_no_quote_still_makes_an_unpriced_event(self):
        """The `quote is None` branch of `pricing_core_fields`. A lead won without a
        quote must not inherit a phantom rate — it stays unpriced, as before."""
        lead = self._lead()
        event = self._win(lead)

        self.assertIsNone(event.price_per_head)
        self.assertEqual(event.service_charge_pct, Decimal('0'))
        self.assertEqual(event.gratuity_pct, Decimal('0'))
        self.assertFalse(event.is_taxable)
        self.assertEqual(event.total, Decimal('0.00'))
        self.assertEqual(event.status, 'tentative')

    def test_quote_acceptance_copies_each_meal_exactly_once(self):
        """AC3 guard. The shared carry helper now copies the meals, and acceptance
        used to copy them again further down — the duplicate would have doubled the
        meal food in the subtotal."""
        from bookings.services.quote_acceptance import accept_quote
        quote = self._quote()
        BookingMeal.objects.create(
            quote=quote, label='Late night', guest_count=20, price_per_head=Decimal('8'),
        )
        quote.recalculate_totals()
        quote.refresh_from_db()

        event = accept_quote(quote, user=self.user)

        self.assertEqual(event.additional_meals.count(), 1)
        self.assertEqual(event.total, quote.total)


# ── Bug 2: the rounding split ─────────────────────────────────────────────────

class HalfCentRoundingTests(MoneyBleedingBase):
    """AC4–AC5. `.quantize()` with no rounding argument is HALF_EVEN; the engine and
    the frontend are HALF_UP. Only an exact half-cent tells them apart."""

    def _line(self, booking, **kwargs):
        fields = dict(
            quote=booking, category=LineItemCategory.RENTAL, description='X',
            quantity=Decimal('1'), unit=LineItemUnit.EACH, unit_price=Decimal('1'),
        )
        fields.update(kwargs)
        return BookingLineItem.objects.create(**fields)

    def test_a_half_cent_line_rounds_up_not_to_even(self):
        """AC4. 1.50 × $0.03 = $0.045. HALF_EVEN stored $0.04 while the preview
        showed $0.05 — a cent short of the number the caterer was reading."""
        quote = self._quote()
        line = self._line(quote, quantity=Decimal('1.50'), unit_price=Decimal('0.03'))
        self.assertEqual(line.line_total, Decimal('0.05'))

    def test_a_half_cent_labor_line_rounds_up(self):
        """AC4, the realistic shape: 2.5 hours × $16.97 = $42.425."""
        quote = self._quote()
        line = self._line(
            quote, category=LineItemCategory.LABOR, unit=LineItemUnit.PER_HOUR,
            quantity=Decimal('2.5'), unit_price=Decimal('16.97'),
        )
        self.assertEqual(line.line_total, Decimal('42.43'))

    def test_a_half_cent_discount_rounds_away_from_zero(self):
        """AC5. The magnitude rounds up and the sign is applied after, matching the
        frontend — rounding −42.425 half-up would give −42.42 and quietly shrink the
        discount the customer was promised."""
        quote = self._quote()
        line = self._line(
            quote, category=LineItemCategory.DISCOUNT, unit=LineItemUnit.FLAT,
            quantity=Decimal('2.5'), unit_price=Decimal('16.97'),
        )
        self.assertEqual(line.line_total, Decimal('-42.43'))

    def test_the_half_cent_reaches_the_stored_subtotal(self):
        """The cent has to survive into the booking, not just the line row."""
        quote = self._quote(price_per_head=Decimal('0'), guest_count=0)
        self._line(quote, quantity=Decimal('1.50'), unit_price=Decimal('0.03'))
        quote.refresh_from_db()
        self.assertEqual(quote.subtotal, Decimal('0.05'))
        self.assertEqual(quote.total, Decimal('0.05'))

    def test_an_event_line_rounds_identically(self):
        """Mirror rule — the same model backs both, but the event path deserves its
        own failing-if-broken assertion."""
        event = self._event()
        line = BookingLineItem.objects.create(
            event=event, category=LineItemCategory.RENTAL, description='X',
            quantity=Decimal('1.50'), unit=LineItemUnit.EACH, unit_price=Decimal('0.03'),
        )
        self.assertEqual(line.line_total, Decimal('0.05'))


# ── Bug 3: admin desync ───────────────────────────────────────────────────────

class AdminMoneyLockdownTests(MoneyBleedingBase):
    """AC6–AC7. Stored money is engine output: readable, never typeable, and
    re-derived whenever an input changes."""

    MONEY = ('subtotal', 'service_charge', 'tax_amount', 'gratuity', 'total')

    def test_event_admin_makes_every_money_output_readonly(self):
        """AC6. `EventAdmin` declared no readonly_fields at all — all five were
        typeable and whatever was typed simply stayed there."""
        admin = EventAdmin(Event, AdminSite())
        readonly = admin.get_readonly_fields(request=None, obj=self._event())
        for field in self.MONEY:
            self.assertIn(field, readonly)

    def test_quote_admin_makes_every_money_output_readonly(self):
        """AC6 mirror. This admin already protected subtotal/tax_amount/total but
        left `service_charge` and `gratuity` editable."""
        admin = QuoteAdmin(Quote, AdminSite())
        readonly = admin.get_readonly_fields(request=None, obj=self._quote())
        for field in self.MONEY:
            self.assertIn(field, readonly)
        # The fields it already protected are still there, exactly once.
        self.assertEqual(sorted(readonly).count('total'), 1)
        self.assertIn('sent_at', readonly)

    def test_admin_saving_an_input_recomputes_the_totals(self):
        """AC7. $50 × 100 = $5,000; the admin raises the rate to $60 and the stored
        subtotal must follow. Nothing recomputed before, so it stayed at $5,000."""
        quote = self._quote()
        self.assertEqual(quote.subtotal, Decimal('5000.00'))

        quote.price_per_head = Decimal('60')
        QuoteAdmin(Quote, AdminSite()).save_model(
            request=None, obj=quote, form=None, change=True,
        )

        quote.refresh_from_db()
        self.assertEqual(quote.subtotal, Decimal('6000.00'))
        self.assertEqual(quote.total, Decimal('6000.00'))

    def test_admin_saving_inlines_recomputes_the_totals(self):
        """AC7, the inline half: add-on line items land in `save_related`, so the
        subtotal has to be re-derived after the formsets are written."""
        event = self._event()

        class _Form:
            """The two attributes Django's `save_related` touches on the form."""
            instance = event

            def save_m2m(self):
                pass

        BookingLineItem.objects.create(
            event=event, category=LineItemCategory.RENTAL, description='Chairs',
            quantity=Decimal('10'), unit=LineItemUnit.EACH, unit_price=Decimal('5'),
        )
        Event.objects.filter(pk=event.pk).update(subtotal=Decimal('0'), total=Decimal('0'))

        EventAdmin(Event, AdminSite()).save_related(
            request=None, form=_Form(), formsets=[], change=True,
        )

        event.refresh_from_db()
        self.assertEqual(event.subtotal, Decimal('5050.00'))  # 5000 food + 50 chairs


# ── Bug 4: stale per-guest lines ──────────────────────────────────────────────

class PerGuestLineRefreshTests(MoneyBleedingBase):
    """AC8–AC10. `line_total` is stored and was trusted. A PATCH that moves
    `guest_count` without resending `line_items` left per-guest lines at the old
    count — and the editors resend everything, so only an agent, curl or the admin
    ever hit it. That is exactly the caller this app is being built for."""

    def _per_guest_line(self, **parent):
        return BookingLineItem.objects.create(
            category=LineItemCategory.FOOD, description='Canapés',
            quantity=Decimal('1'), unit=LineItemUnit.PER_GUEST,
            unit_price=Decimal('6.00'), **parent,
        )

    def test_a_quote_patch_of_guest_count_alone_reprices_the_line(self):
        """AC8. $6 × 100 = $600; PATCH to 120 guests must make it $720."""
        quote = self._quote()
        line = self._per_guest_line(quote=quote)
        self.assertEqual(line.line_total, Decimal('600.00'))

        res = self.client.patch(
            f'/api/bookings/quotes/{quote.id}/', {'guest_count': 120}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)

        line.refresh_from_db()
        quote.refresh_from_db()
        self.assertEqual(line.line_total, Decimal('720.00'))
        # 120 × $50 food + $720 line — the stale value would have summed $600.
        self.assertEqual(quote.subtotal, Decimal('6720.00'))

    def test_an_event_patch_of_guest_count_alone_reprices_the_line(self):
        """AC10 — the mirror. Quotes and events must behave identically."""
        event = self._event()
        line = self._per_guest_line(event=event)
        self.assertEqual(line.line_total, Decimal('600.00'))

        res = self.client.patch(
            f'/api/events/{event.id}/', {'guest_count': 120}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)

        line.refresh_from_db()
        event.refresh_from_db()
        self.assertEqual(line.line_total, Decimal('720.00'))
        self.assertEqual(event.subtotal, Decimal('6720.00'))

    def test_a_flat_line_is_left_alone_when_the_guest_count_moves(self):
        """The refresh is scoped to `per_guest`. A flat or each line is priced by its
        own quantity and must NOT be re-derived from the guest count."""
        quote = self._quote()
        flat = BookingLineItem.objects.create(
            quote=quote, category=LineItemCategory.RENTAL, description='Marquee',
            quantity=Decimal('1'), unit=LineItemUnit.FLAT, unit_price=Decimal('900'),
        )

        self.client.patch(
            f'/api/bookings/quotes/{quote.id}/', {'guest_count': 120}, format='json',
        )

        flat.refresh_from_db()
        self.assertEqual(flat.line_total, Decimal('900.00'))

    def test_recalculating_twice_is_stable(self):
        """The refresh writes through `bulk_update` precisely because `save()` calls
        `recalculate_totals()` — going through `save()` would recurse into the
        caller. Two recomputes in a row must simply agree."""
        quote = self._quote()
        self._per_guest_line(quote=quote)

        quote.guest_count = 120
        quote.save(update_fields=['guest_count'])
        quote.recalculate_totals()
        first = quote.subtotal
        quote.recalculate_totals()
        quote.refresh_from_db()

        self.assertEqual(quote.subtotal, first)
        self.assertEqual(quote.subtotal, Decimal('6720.00'))
