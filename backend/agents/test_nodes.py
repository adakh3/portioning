"""Unit tests for the node library (pure functions)."""
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings

from agents.nodes import AskStructuredError, ask_structured, load_org_context
from portioning import llm
from users.models import Organisation

SCHEMA = {
    "type": "object",
    "properties": {"question": {"type": "string"}},
    "required": ["question"],
    "additionalProperties": False,
}


class LoadOrgContextTests(TestCase):
    def test_loads_org_name_into_state(self):
        org = Organisation.objects.create(name='Honey Flash', slug='honey-flash')
        self.assertEqual(load_org_context({'org_id': org.id}), {'org_name': 'Honey Flash'})


@override_settings(LLM_AGENT_SKELETON='openai:gpt-test', OPENAI_API_KEY='sk-x')
class AskStructuredTests(SimpleTestCase):
    def test_returns_validated_data_on_first_try(self):
        with patch('portioning.llm._call_openai', return_value='{"question": "How many guests?"}') as m:
            data, model_used, attempts = ask_structured(
                task_setting='LLM_AGENT_SKELETON', system='s', user_content='u', schema=SCHEMA,
            )
        self.assertEqual(data, {"question": "How many guests?"})
        self.assertEqual(model_used, 'openai:gpt-test')
        self.assertEqual(attempts, 1)
        self.assertEqual(m.call_count, 1)

    def test_retries_then_succeeds(self):
        # First call unparseable, second valid → one retry, two calls total.
        with patch('portioning.llm._call_openai',
                   side_effect=['not json', '{"question": "How many?"}']) as m:
            data, _model, attempts = ask_structured(
                task_setting='LLM_AGENT_SKELETON', system='s', user_content='u', schema=SCHEMA,
            )
        self.assertEqual(data, {"question": "How many?"})
        self.assertEqual(attempts, 2)
        self.assertEqual(m.call_count, 2)

    def test_off_schema_response_triggers_retry(self):
        # Parseable JSON but wrong shape → schema validation fails → retry.
        with patch('portioning.llm._call_openai',
                   side_effect=['{"wrong": 1}', '{"question": "ok"}']) as m:
            data, _model, attempts = ask_structured(
                task_setting='LLM_AGENT_SKELETON', system='s', user_content='u', schema=SCHEMA,
            )
        self.assertEqual(data, {"question": "ok"})
        self.assertEqual(m.call_count, 2)

    def test_exhausts_budget_and_raises(self):
        with patch('portioning.llm._call_openai', return_value='not json') as m:
            with self.assertRaises(AskStructuredError) as ctx:
                ask_structured(
                    task_setting='LLM_AGENT_SKELETON', system='s', user_content='u', schema=SCHEMA,
                )
        # Default budget: 1 attempt + 2 retries = exactly 3 provider calls.
        self.assertEqual(m.call_count, 3)
        self.assertEqual(ctx.exception.attempts, 3)

    @override_settings(LLM_AGENT_SKELETON='nonsense')  # no provider prefix
    def test_misconfiguration_is_not_retried(self):
        with patch('portioning.llm._call_openai') as m:
            with self.assertRaises(llm.LLMNotConfigured):
                ask_structured(
                    task_setting='LLM_AGENT_SKELETON', system='s', user_content='u', schema=SCHEMA,
                )
        m.assert_not_called()
