"""Central LLM registry: provider:model resolution and per-provider routing."""
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from portioning import llm

SCHEMA = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
    "additionalProperties": False,
}


class ResolveTests(SimpleTestCase):
    @override_settings(LLM_FOLLOWUP_DRAFTER='openai:gpt-5.4-nano')
    def test_resolves_provider_and_model(self):
        self.assertEqual(llm.resolve('LLM_FOLLOWUP_DRAFTER'), ('openai', 'gpt-5.4-nano'))

    @override_settings(LLM_FOLLOWUP_DRAFTER='anthropic:claude-haiku-4-5')
    def test_switching_provider_is_just_the_setting(self):
        self.assertEqual(llm.resolve('LLM_FOLLOWUP_DRAFTER'), ('anthropic', 'claude-haiku-4-5'))

    @override_settings(LLM_FOLLOWUP_DRAFTER='gpt-5.4-nano')  # missing provider prefix
    def test_rejects_malformed_setting(self):
        with self.assertRaises(llm.LLMNotConfigured):
            llm.resolve('LLM_FOLLOWUP_DRAFTER')

    @override_settings(LLM_FOLLOWUP_DRAFTER='gemini:some-model')  # unknown provider
    def test_rejects_unknown_provider(self):
        with self.assertRaises(llm.LLMNotConfigured):
            llm.resolve('LLM_FOLLOWUP_DRAFTER')


class IsConfiguredTests(SimpleTestCase):
    @override_settings(LLM_FOLLOWUP_DRAFTER='openai:gpt-test', OPENAI_API_KEY='sk-x')
    def test_true_when_selected_providers_key_present(self):
        self.assertTrue(llm.is_configured('LLM_FOLLOWUP_DRAFTER'))

    @override_settings(LLM_FOLLOWUP_DRAFTER='openai:gpt-test',
                       OPENAI_API_KEY='', ANTHROPIC_API_KEY='sk-ant-x')
    def test_other_providers_key_does_not_count(self):
        self.assertFalse(llm.is_configured('LLM_FOLLOWUP_DRAFTER'))

    @override_settings(LLM_FOLLOWUP_DRAFTER='nonsense')
    def test_false_when_setting_malformed(self):
        self.assertFalse(llm.is_configured('LLM_FOLLOWUP_DRAFTER'))


class CompleteStructuredTests(SimpleTestCase):
    """The registry routes to the provider named in the setting — nothing else."""

    @override_settings(LLM_FOLLOWUP_DRAFTER='openai:gpt-test', OPENAI_API_KEY='sk-x')
    @patch('portioning.llm._call_openai', return_value='{"ok": true}')
    @patch('portioning.llm._call_anthropic')
    def test_routes_to_openai(self, mock_anthropic, mock_openai):
        data, model_used = llm.complete_structured('LLM_FOLLOWUP_DRAFTER', 'sys', 'user', SCHEMA)
        self.assertEqual(data, {"ok": True})
        self.assertEqual(model_used, 'openai:gpt-test')
        mock_openai.assert_called_once_with('gpt-test', 'sk-x', 'sys', 'user', SCHEMA, 1024)
        mock_anthropic.assert_not_called()

    @override_settings(LLM_FOLLOWUP_DRAFTER='anthropic:claude-test', ANTHROPIC_API_KEY='sk-ant-x')
    @patch('portioning.llm._call_anthropic', return_value='{"ok": false}')
    @patch('portioning.llm._call_openai')
    def test_routes_to_anthropic(self, mock_openai, mock_anthropic):
        data, model_used = llm.complete_structured('LLM_FOLLOWUP_DRAFTER', 'sys', 'user', SCHEMA)
        self.assertEqual(data, {"ok": False})
        self.assertEqual(model_used, 'anthropic:claude-test')
        mock_openai.assert_not_called()

    @override_settings(LLM_FOLLOWUP_DRAFTER='openai:gpt-test', OPENAI_API_KEY='')
    def test_raises_without_key(self):
        with self.assertRaises(llm.LLMNotConfigured):
            llm.complete_structured('LLM_FOLLOWUP_DRAFTER', 'sys', 'user', SCHEMA)

    @override_settings(LLM_FOLLOWUP_DRAFTER='openai:gpt-test', OPENAI_API_KEY='sk-x')
    @patch('portioning.llm._call_openai', return_value='not json')
    def test_raises_on_unparseable_output(self, mock_openai):
        with self.assertRaises(llm.LLMError):
            llm.complete_structured('LLM_FOLLOWUP_DRAFTER', 'sys', 'user', SCHEMA)
