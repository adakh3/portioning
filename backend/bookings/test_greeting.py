"""How clients get addressed (REL-479).

A real production email opened `Hello some,` because the booking-side drafter
trusted `first_name`, and `first_name` is whatever `split_full_name` made of the
single name a rep typed. `Acme Events Ltd` becomes first_name `Acme Events`.

These tests pin two things: one greeting rule shared by both drafters, and a
company name never handed over as if it were a person's.
"""
from decimal import Decimal

from django.test import TestCase

from bookings.services.followup_drafter import SYSTEM_PROMPT as FOLLOWUP_PROMPT
from bookings.services.greeting import (
    GREETING_RULE, greeting_context_lines, looks_like_organisation,
)
from bookings.services.message_drafter import SYSTEM_PROMPT as MESSAGE_PROMPT, build_context
from bookings.services.messaging_kinds import KIND_COMPOSE
from bookings.tests import make_contact, make_quote
from tests.base import get_test_org


class OneRuleTests(TestCase):
    def test_both_drafters_carry_the_same_greeting_rule(self):
        # The whole point: they cannot drift again.
        self.assertIn(GREETING_RULE, FOLLOWUP_PROMPT)
        self.assertIn(GREETING_RULE, MESSAGE_PROMPT)

    def test_the_rule_still_covers_title_first_name_and_neither(self):
        # Guards the move itself — leads must receive exactly what they did.
        self.assertIn('title', GREETING_RULE)
        self.assertIn('surname', GREETING_RULE)
        self.assertIn("'Hello,'", GREETING_RULE)
        self.assertIn('never infer', GREETING_RULE)


class OrganisationDetectionTests(TestCase):
    def test_a_legal_suffix_marks_a_company(self):
        for name in ('Acme Events Ltd', 'Acme Events Limited', 'Northside LLC',
                     'Baker Foods Inc.', 'Something PLC', 'Handel GmbH'):
            with self.subTest(name=name):
                self.assertTrue(looks_like_organisation(name))

    def test_a_person_is_not_a_company(self):
        for name in ('Nadia Okonjo', 'Batool', 'Jean-Luc Picard',
                     # Deliberately not caught: over-detection costs a real
                     # person their name, which is worse than the status quo.
                     'Hannah Group', 'Priya Events'):
            with self.subTest(name=name):
                self.assertFalse(looks_like_organisation(name))

    def test_a_contact_named_after_its_own_business_is_a_company(self):
        self.assertTrue(
            looks_like_organisation('Northside Catering', account_name='Northside Catering')
        )
        self.assertFalse(
            looks_like_organisation('Nadia Okonjo', account_name='Northside Catering')
        )

    def test_an_empty_name_is_not_a_company(self):
        self.assertFalse(looks_like_organisation(''))
        self.assertFalse(looks_like_organisation(None))


class GreetingContextTests(TestCase):
    def test_a_title_is_offered_alongside_the_surname(self):
        lines = greeting_context_lines(
            name='Batool Rizvi', title='Ms', first_name='Batool', last_name='Rizvi',
        )
        self.assertIn('Client title: Ms', lines)
        self.assertIn('Client surname: Rizvi', lines)

    def test_without_a_title_the_first_name_is_still_offered(self):
        lines = greeting_context_lines(
            name='Batool Rizvi', first_name='Batool', last_name='Rizvi',
        )
        self.assertIn('Client first name: Batool', lines)
        self.assertNotIn('Client title: ', ' '.join(lines))

    def test_a_company_name_never_reaches_the_model_as_a_first_name(self):
        # The parts are more persuasive to a model than the prose rule is, so
        # they are withheld entirely rather than sent with a caveat.
        lines = greeting_context_lines(
            name='Acme Events Ltd', first_name='Acme Events', last_name='Ltd',
        )
        joined = ' '.join(lines)
        self.assertIn('Client name: Acme Events Ltd', joined)
        self.assertNotIn('Client first name:', joined)
        self.assertNotIn('Client surname:', joined)
        self.assertIn('business name, not a person', joined)

    def test_a_single_word_name_is_greeted_by_it(self):
        lines = greeting_context_lines(name='Batool', first_name='Batool')
        self.assertIn('Client first name: Batool', lines)

    def test_no_name_at_all_offers_nothing_rather_than_a_placeholder(self):
        self.assertEqual(greeting_context_lines(), [])
        self.assertEqual(greeting_context_lines(name='   '), [])


class DrafterContextTests(TestCase):
    """The bug as it actually shipped, at the layer it shipped from."""

    def setUp(self):
        self.org = get_test_org()

    def _context_for(self, **contact_kwargs):
        contact = make_contact(org=self.org, email='c@example.com', **contact_kwargs)
        quote = make_quote(
            org=self.org, primary_contact=contact,
            price_per_head=Decimal('50'), guest_count=100,
        )
        quote.recalculate_totals()
        quote.refresh_from_db()
        return build_context(quote, KIND_COMPOSE, 'email')

    def test_the_shipped_bug_the_company_greeted_by_its_first_word(self):
        context = self._context_for(first_name='Acme Events', last_name='Ltd')
        self.assertNotIn('Client first name: Acme Events', context)
        self.assertIn('business name, not a person', context)

    def test_a_person_still_gets_their_first_name(self):
        context = self._context_for(first_name='Nadia', last_name='Okonjo')
        self.assertIn('Client first name: Nadia', context)

    def test_a_stored_title_reaches_the_draft(self):
        context = self._context_for(first_name='Batool', last_name='Rizvi', title='Ms')
        self.assertIn('Client title: Ms', context)
        self.assertIn('Client surname: Rizvi', context)
