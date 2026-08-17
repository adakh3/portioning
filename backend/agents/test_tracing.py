"""Tracing toggle: off by default, opt-in only, no env mutation when off (AC2/AC5)."""
import os

from django.test import SimpleTestCase, override_settings

from agents import tracing

TRACE_ENV = ['LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGCHAIN_API_KEY',
             'LANGSMITH_API_KEY', 'LANGCHAIN_PROJECT', 'LANGCHAIN_ENDPOINT']


class TracingToggleTests(SimpleTestCase):
    def setUp(self):
        # Snapshot and clear the tracing env so assertions are deterministic;
        # restore afterwards so we never leak state into other tests.
        self._saved = {k: os.environ.get(k) for k in TRACE_ENV}
        for k in TRACE_ENV:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    @override_settings(LANGSMITH_TRACING=False, LANGSMITH_API_KEY='')
    def test_off_by_default(self):
        self.assertFalse(tracing.is_tracing_enabled())

    @override_settings(LANGSMITH_TRACING=False, LANGSMITH_API_KEY='ls-key')
    def test_key_alone_does_not_enable(self):
        self.assertFalse(tracing.is_tracing_enabled())

    @override_settings(LANGSMITH_TRACING=True, LANGSMITH_API_KEY='')
    def test_flag_alone_does_not_enable(self):
        self.assertFalse(tracing.is_tracing_enabled())

    @override_settings(LANGSMITH_TRACING=True, LANGSMITH_API_KEY='ls-key')
    def test_both_flag_and_key_enable(self):
        self.assertTrue(tracing.is_tracing_enabled())

    @override_settings(LANGSMITH_TRACING=False, LANGSMITH_API_KEY='')
    def test_configure_neutralizes_inherited_env_when_off(self):
        # AC2 + privacy: a developer with LangSmith exported globally for other
        # projects must NOT have agent runs trace just because our flag is unset.
        # Our toggle is authoritative — configure_tracing() forces the tracer off.
        os.environ['LANGCHAIN_TRACING_V2'] = 'true'
        os.environ['LANGSMITH_TRACING'] = 'true'
        os.environ['LANGSMITH_API_KEY'] = 'ls-inherited'

        self.assertFalse(tracing.configure_tracing())
        self.assertEqual(os.environ['LANGCHAIN_TRACING_V2'], 'false')
        self.assertEqual(os.environ['LANGSMITH_TRACING'], 'false')
        # And LangSmith itself now reports tracing disabled.
        from langsmith.utils import tracing_is_enabled
        self.assertFalse(tracing_is_enabled())

    @override_settings(LANGSMITH_TRACING=True, LANGSMITH_API_KEY='ls-key',
                       LANGSMITH_PROJECT='proj', LANGSMITH_ENDPOINT='https://smith')
    def test_configure_exports_env_when_on(self):
        self.assertTrue(tracing.configure_tracing())
        self.assertEqual(os.environ['LANGCHAIN_TRACING_V2'], 'true')
        self.assertEqual(os.environ['LANGCHAIN_API_KEY'], 'ls-key')
        self.assertEqual(os.environ['LANGCHAIN_PROJECT'], 'proj')
