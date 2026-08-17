"""Full proposal-agent runs with a fake LLM provider (REL-413).

TransactionTestCase so the graph's checkpoint + the Quote/ProposalDraft writes are
committed and visible regardless of which thread LangGraph runs a node on.
"""
import json
import os
import tempfile
from decimal import Decimal
from unittest.mock import patch

from django.test import TransactionTestCase, override_settings

from agents.checkpointer import make_checkpointer
from agents.models import ProposalDraft
from agents.proposal import ProposalRunError, resume_proposal, start_proposal
from bookings.models import Lead
from dishes.models import Dish, DishCategory
from menus.models import MenuTemplate, MenuTemplatePriceTier
from users.models import Organisation

SQLITE = 'django.db.backends.sqlite3'
FAKE = dict(
    LLM_PROPOSAL_QUESTIONS='openai:gpt-test',
    LLM_PROPOSAL_MENU='openai:gpt-test',
    LLM_PROPOSAL_PROSE='openai:gpt-test',
    OPENAI_API_KEY='sk-x',
)


@override_settings(**FAKE)
class ProposalRunTests(TransactionTestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Caterer', slug='caterer')
        self.template = MenuTemplate.objects.create(organisation=self.org, name='Classic Dinner')
        self.tier = MenuTemplatePriceTier.objects.create(
            menu=self.template, min_guests=1, price_per_head=Decimal('50.00'))
        cat = DishCategory.objects.create(organisation=self.org, name='mains', display_name='Mains')
        self.d1 = Dish.objects.create(organisation=self.org, name='Roast Chicken', category=cat, default_portion_grams=200)
        self.d2 = Dish.objects.create(organisation=self.org, name='Veg Lasagne', category=cat, default_portion_grams=250)
        self.lead = Lead.objects.create(
            organisation=self.org, contact_name='Sam Client', contact_email='sam@example.com',
            event_type='Corporate Dinner', event_date='2026-09-12', guest_estimate=100,
        )
        fd, self.cp = tempfile.mkstemp(suffix='.sqlite3'); os.close(fd)
        self.addCleanup(lambda: os.path.exists(self.cp) and os.remove(self.cp))

    def _saver(self):
        return make_checkpointer(engine=SQLITE, sqlite_path=self.cp)

    def _questions(self):
        return json.dumps({'questions': [
            {'id': 'service_style', 'text': 'Buffet or plated?', 'kind': 'choice',
             'suggested': 'buffet', 'impact': 'low'},
        ]})

    def _menu(self, dish_ids=None):
        return json.dumps({
            'template_id': self.template.id, 'tier_id': self.tier.id,
            'sections': [{'name': 'Mains', 'dish_ids': dish_ids or [self.d1.id, self.d2.id]}],
            'addon_variant_ids': [], 'meals': [], 'assumptions': [],
        })

    def _prose(self):
        return json.dumps({
            'intro': 'Thank you for considering us.',
            'section_descriptions': {'Mains': 'Hearty mains.'},
            'whats_included': ['Menu', 'Service'],
            'day_of_outline': 'Setup, service, breakdown.',
            'closing': 'We would love to cater this.',
        })

    def test_happy_path_start_then_resume_drafts_a_quote(self):
        with patch('portioning.llm._call_openai',
                   side_effect=[self._questions(), self._menu(), self._prose()]):
            saver = self._saver()
            draft = start_proposal(organisation=self.org, lead=self.lead, checkpointer=saver)
            saver.conn.close()
            self.assertEqual(draft.status, ProposalDraft.QUESTIONS_PENDING)
            self.assertTrue(draft.questions)

            saver2 = self._saver()
            draft = resume_proposal(organisation=self.org, draft_id=draft.id,
                                    answers={'service_style': 'buffet'}, checkpointer=saver2)
            saver2.conn.close()

        self.assertEqual(draft.status, ProposalDraft.DRAFTED)
        quote = draft.quote
        self.assertIsNotNone(quote)
        self.assertEqual(quote.price_per_head, Decimal('50.00'))
        self.assertEqual(quote.guest_count, 100)
        self.assertEqual(quote.dishes.count(), 2)
        # food = 50 * 100 = 5000, no add-ons → subtotal exactly 5000; DRAFTED means
        # the in-code parity guard passed (persisted total == priced total).
        self.assertEqual(quote.subtotal, Decimal('5000.00'))
        self.assertGreaterEqual(quote.total, Decimal('5000.00'))
        self.assertEqual(quote.proposal_prose['intro'], 'Thank you for considering us.')
        self.assertIsInstance(quote.proposal_assumptions, list)

    def test_per_guest_addon_prices_correctly_and_parity_holds(self):
        # Regression for the add-on parity bug: a per-guest add-on's line total must
        # scale by headcount both when priced and when persisted, or assembly's
        # parity guard would fail. 100 guests × $5/head = $500 added to $5000 food.
        from bookings.models.addons import AddOnProduct, AddOnVariant
        from bookings.models.quotes import LineItemUnit
        product = AddOnProduct.objects.create(
            organisation=self.org, name='Signature Cocktail', unit_price=Decimal('5.00'),
            default_unit=LineItemUnit.PER_GUEST, is_taxable=True)
        variant = AddOnVariant.objects.create(organisation=self.org, product=product, name='Mojito')
        menu = json.dumps({
            'template_id': self.template.id, 'tier_id': self.tier.id,
            'sections': [{'name': 'Mains', 'dish_ids': [self.d1.id]}],
            'addon_variant_ids': [variant.id], 'meals': [], 'assumptions': [],
        })
        with patch('portioning.llm._call_openai',
                   side_effect=[self._questions(), menu, self._prose()]):
            saver = self._saver()
            draft = start_proposal(organisation=self.org, lead=self.lead, checkpointer=saver)
            saver.conn.close()
            saver2 = self._saver()
            draft = resume_proposal(organisation=self.org, draft_id=draft.id,
                                    answers={'service_style': 'buffet'}, checkpointer=saver2)
            saver2.conn.close()

        self.assertEqual(draft.status, ProposalDraft.DRAFTED)
        quote = draft.quote
        line = quote.line_items.get()
        self.assertEqual(line.line_total, Decimal('500.00'))   # 5 × 100 guests
        self.assertEqual(quote.subtotal, Decimal('5500.00'))   # 5000 food + 500

    def test_out_of_catalog_dish_retries_then_degrades(self):
        # Menu always references a bogus dish id → 3 compose attempts (1 + 2 retries)
        # → degrade (strip invalid) → still drafts, with an assumption recorded.
        bogus = self._menu(dish_ids=[self.d1.id, 999999])
        with patch('portioning.llm._call_openai',
                   side_effect=[self._questions(), bogus, bogus, bogus, self._prose()]) as m:
            saver = self._saver()
            draft = start_proposal(organisation=self.org, lead=self.lead, checkpointer=saver)
            saver.conn.close()
            saver2 = self._saver()
            draft = resume_proposal(organisation=self.org, draft_id=draft.id,
                                    answers={}, checkpointer=saver2)
            saver2.conn.close()

        self.assertEqual(draft.status, ProposalDraft.DRAFTED)
        # 1 questions + 3 menu attempts + 1 prose = 5 provider calls.
        self.assertEqual(m.call_count, 5)
        # Only the valid dish survived; a degrade assumption is present.
        self.assertEqual(draft.quote.dishes.count(), 1)
        reasons = [a['field'] for a in draft.quote.proposal_assumptions]
        self.assertIn('menu', reasons)

    def test_regenerate_reuses_prior_answers_including_empty(self):
        from agents.proposal import regenerate_proposal
        # Draft once, resuming with EMPTY answers (caterer accepted all suggestions).
        with patch('portioning.llm._call_openai',
                   side_effect=[self._questions(), self._menu(), self._prose()]):
            saver = self._saver()
            draft = start_proposal(organisation=self.org, lead=self.lead, checkpointer=saver)
            saver.conn.close()
            saver2 = self._saver()
            draft = resume_proposal(organisation=self.org, draft_id=draft.id, answers={}, checkpointer=saver2)
            saver2.conn.close()
        self.assertEqual(draft.status, ProposalDraft.DRAFTED)

        # Regenerate must reuse the (empty) prior answers and produce a NEW drafted
        # quote — not strand the fresh draft at the form.
        with patch('portioning.llm._call_openai',
                   side_effect=[self._questions(), self._menu(), self._prose()]):
            new = regenerate_proposal(organisation=self.org, draft_id=draft.id, checkpointer=self._saver())
        self.assertEqual(new.status, ProposalDraft.DRAFTED)
        self.assertNotEqual(new.id, draft.id)
        self.assertIsNotNone(new.quote)

    def test_resume_scoped_to_wrong_org_is_rejected(self):
        other = Organisation.objects.create(name='Rival', slug='rival')
        with patch('portioning.llm._call_openai', side_effect=[self._questions()]):
            saver = self._saver()
            draft = start_proposal(organisation=self.org, lead=self.lead, checkpointer=saver)
            saver.conn.close()
        with self.assertRaises(ProposalRunError):
            resume_proposal(organisation=other, draft_id=draft.id, answers={}, checkpointer=self._saver())
        draft.refresh_from_db()
        self.assertEqual(draft.status, ProposalDraft.QUESTIONS_PENDING)
