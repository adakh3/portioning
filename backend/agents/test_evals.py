"""Eval harness: evaluator units, a passing run (AC3), and the seeded
out-of-catalog regression that must fail and exit non-zero (AC4)."""
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from dishes.models import Dish, DishCategory
from users.models import Organisation

from agents.evals import run_evals
from agents.evals.evaluators import (catalog_subset, date_not_invented,
                                     headcount_echoed, schema_valid)
from agents.evals.schemas import INQUIRY_EXTRACTION_SCHEMA

FAKE_LLM = dict(LLM_AGENT_INQUIRY_EXTRACTION='openai:gpt-test', OPENAI_API_KEY='sk-x')


def make_catalog(org, names):
    cat = DishCategory.objects.create(organisation=org, name='mains', display_name='Mains')
    for n in names:
        Dish.objects.create(organisation=org, name=n, category=cat, default_portion_grams=200)


class EvaluatorUnitTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Caterer', slug='caterer')
        self.ctx = {'catalog': {'Bruschetta', 'Roast Chicken'}, 'schema': INQUIRY_EXTRACTION_SCHEMA}

    def test_schema_valid_pass_and_fail(self):
        good = {'proposed_dishes': [], 'event_date': None, 'headcount': None}
        self.assertTrue(schema_valid(good, {}, self.ctx).passed)
        bad = {'proposed_dishes': 'not-a-list', 'event_date': None, 'headcount': None}
        self.assertFalse(schema_valid(bad, {}, self.ctx).passed)

    def test_catalog_subset(self):
        ok = {'proposed_dishes': ['Bruschetta']}
        self.assertTrue(catalog_subset(ok, {}, self.ctx).passed)
        bad = {'proposed_dishes': ['Bruschetta', 'Caviar Tower']}
        out = catalog_subset(bad, {}, self.ctx)
        self.assertFalse(out.passed)
        self.assertIn('Caviar Tower', out.detail)

    def test_date_not_invented(self):
        case = {'expected': {'event_date': None}}
        self.assertTrue(date_not_invented({'event_date': None}, case, self.ctx).passed)
        self.assertFalse(date_not_invented({'event_date': '2026-01-01'}, case, self.ctx).passed)

    def test_headcount_echoed(self):
        case = {'expected': {'headcount': 40}}
        self.assertTrue(headcount_echoed({'headcount': 40}, case, self.ctx).passed)
        self.assertFalse(headcount_echoed({'headcount': 50}, case, self.ctx).passed)


@override_settings(**FAKE_LLM)
class RunEvalsTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Caterer', slug='caterer')
        make_catalog(self.org, ['Bruschetta', 'Roast Chicken', 'Lemon Tart'])

    def _dataset(self):
        return {
            'agent': 'inquiry_extraction',
            'cases': [{
                'id': 'rich-lead', 'target': 'inquiry_extraction',
                'input': {'inquiry': 'Dinner for 120 on 12 Sep 2026.'},
                'expected': {'event_date': '2026-09-12', 'headcount': 120},
                'constraints': ['schema_valid', 'catalog_subset', 'date_not_invented', 'headcount_echoed'],
            }],
        }

    def test_all_assertions_pass_no_regression(self):
        # AC3: provider behaves — valid, in-catalog, faithful extraction.
        good = '{"proposed_dishes": ["Roast Chicken"], "event_date": "2026-09-12", "headcount": 120}'
        with patch('portioning.llm._call_openai', return_value=good):
            report = run_evals(self._dataset(), self.org)
        self.assertFalse(report.regressed)
        self.assertEqual(report.passed_count, 1)

    def test_out_of_catalog_dish_fails_catalog_evaluator(self):
        # AC4: provider proposes a dish absent from the catalog → regression.
        bad = '{"proposed_dishes": ["Caviar Tower"], "event_date": "2026-09-12", "headcount": 120}'
        with patch('portioning.llm._call_openai', return_value=bad):
            report = run_evals(self._dataset(), self.org)
        self.assertTrue(report.regressed)
        failed = report.results[0].failures()
        self.assertIn('catalog_subset', [o.evaluator for o in failed])

    def test_command_exits_nonzero_on_regression(self):
        # AC4 end-to-end: run_agent_evals raises CommandError (non-zero exit).
        bad = '{"proposed_dishes": ["Caviar Tower"], "event_date": "2026-09-12", "headcount": 120}'
        with patch('portioning.llm._call_openai', return_value=bad):
            with self.assertRaises(CommandError):
                call_command('run_agent_evals', '--org', 'caterer', '--dataset', 'inquiry_v1')

    def test_command_passes_when_provider_behaves(self):
        # AC3 end-to-end on the shipped dataset: every case in-catalog & faithful.
        # The shipped inquiry_v1 has varied expected date/headcount, so a single
        # scripted output can't satisfy all — drive it with a per-case override.
        def behaving_target(case, org):
            exp = case['expected']
            # Return an in-catalog dish (not just []) so this run-level test also
            # exercises catalog_subset's membership check, not the empty shortcut.
            return {'proposed_dishes': ['Roast Chicken'],
                    'event_date': exp['event_date'], 'headcount': exp['headcount']}
        from agents.evals.runner import load_dataset
        report = run_evals(load_dataset('inquiry_v1'), self.org, target_override=behaving_target)
        self.assertFalse(report.regressed)
        self.assertEqual(report.passed_count, len(report.results))

    def test_proposal_menu_in_catalog_passes_out_of_catalog_regresses(self):
        # REL-413 gating: the proposal composer must stay in-catalog.
        import json as _json
        good = _json.dumps({'template_id': None, 'tier_id': None,
                            'sections': [{'name': 'Mains', 'dish_ids': [self.roast_id()]}],
                            'addon_variant_ids': [], 'meals': [], 'assumptions': []})
        bad = _json.dumps({'template_id': None, 'tier_id': None,
                           'sections': [{'name': 'Mains', 'dish_ids': [999999]}],
                           'addon_variant_ids': [], 'meals': [], 'assumptions': []})
        dataset = {'agent': 'proposal_menu', 'cases': [{
            'id': 'wedding', 'target': 'proposal_menu',
            'event_params': {'headcount': 120, 'occasion': 'wedding'},
            'expected': {'event_date': None, 'headcount': 120},
            'constraints': ['schema_valid', 'catalog_subset', 'headcount_echoed'],
        }]}
        with override_settings(LLM_PROPOSAL_MENU='openai:gpt-test'):
            with patch('portioning.llm._call_openai', return_value=good):
                self.assertFalse(run_evals(dataset, self.org).regressed)
            with patch('portioning.llm._call_openai', return_value=bad):
                report = run_evals(dataset, self.org)
        self.assertTrue(report.regressed)
        self.assertIn('catalog_subset', [o.evaluator for o in report.results[0].failures()])

    def roast_id(self):
        return Dish.objects.for_org(self.org).get(name='Roast Chicken').id

    def test_skeleton_target_baseline(self):
        # Baseline the skeleton: its generated question is schema-valid.
        with override_settings(LLM_AGENT_SKELETON='openai:gpt-test'):
            from agents.evals.runner import load_dataset
            with patch('portioning.llm._call_openai', return_value='{"question": "How many guests?"}'):
                report = run_evals(load_dataset('skeleton_v1'), self.org)
        self.assertFalse(report.regressed)
