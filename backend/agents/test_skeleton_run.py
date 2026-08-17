"""Full walking-skeleton runs with a fake LLM provider (AC2-AC5).

Uses ``TransactionTestCase`` because the graph checkpoints and its terminal nodes
write the AgentThread; committing (rather than a rolled-back TestCase transaction)
keeps those rows visible no matter which thread LangGraph's executor runs a node
on. The LLM is faked by patching ``portioning.llm._call_openai`` (the same seam
``portioning/test_llm.py`` uses) — nothing hits a network.
"""
import os
import tempfile

from unittest.mock import patch

from django.test import TransactionTestCase, override_settings

from agents.checkpointer import make_checkpointer, thread_key
from agents.models import AgentThread
from agents.runner import AgentRunError, resume_run, start_run
from users.models import Organisation

SQLITE_ENGINE = 'django.db.backends.sqlite3'
FAKE_LLM = dict(LLM_AGENT_SKELETON='openai:gpt-test', OPENAI_API_KEY='sk-x')


@override_settings(**FAKE_LLM)
class SkeletonRunTests(TransactionTestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Caterer', slug='caterer')
        self.other = Organisation.objects.create(name='Rival', slug='rival')
        fd, self.cp_path = tempfile.mkstemp(suffix='.sqlite3')
        os.close(fd)
        self.addCleanup(lambda: os.path.exists(self.cp_path) and os.remove(self.cp_path))

    def _saver(self):
        """A fresh saver over the shared checkpoint file — building a new one
        simulates a brand-new process attaching to the durable checkpoint store."""
        return make_checkpointer(engine=SQLITE_ENGINE, sqlite_path=self.cp_path)

    def test_start_pauses_awaiting_input_with_question_stored(self):
        # AC2: start parks at the interrupt with a persisted, awaiting thread.
        with patch('portioning.llm._call_openai', return_value='{"question": "How many guests?"}'):
            saver = self._saver()
            thread = start_run(organisation=self.org, record_id=1, checkpointer=saver)
            saver.conn.close()  # process exits cleanly, checkpoint durable
        self.assertEqual(thread.status, AgentThread.AWAITING_INPUT)
        self.assertEqual(thread.result['question'], 'How many guests?')

    def test_resume_from_fresh_graph_instance_completes(self):
        # AC3: resume in a *new process* (fresh saver + graph) finishes the run.
        with patch('portioning.llm._call_openai', return_value='{"question": "How many guests?"}'):
            saver1 = self._saver()
            start_run(organisation=self.org, record_id=1, checkpointer=saver1)
            saver1.conn.close()

        saver2 = self._saver()  # simulated restart
        done = resume_run(organisation=self.org, record_id=1, answer='120 guests', checkpointer=saver2)
        saver2.conn.close()

        self.assertEqual(done.status, AgentThread.COMPLETED)
        self.assertEqual(done.result, {
            'org_name': 'Caterer',
            'question': 'How many guests?',
            'answer': '120 guests',
        })

    def test_invalid_json_three_times_fails_without_crashing(self):
        # AC4: exactly 2 retries (3 calls), thread failed with the error recorded.
        with patch('portioning.llm._call_openai', return_value='not json') as m:
            saver = self._saver()
            thread = start_run(organisation=self.org, record_id=2, checkpointer=saver)
            saver.conn.close()
        self.assertEqual(m.call_count, 3)
        self.assertEqual(thread.status, AgentThread.FAILED)
        self.assertIn('unparseable', thread.error.lower())

    @override_settings(LLM_AGENT_SKELETON='nonsense')  # no 'provider:model' prefix
    def test_misconfigured_llm_ends_failed_without_crashing(self):
        # A config fault (LLMNotConfigured) is re-raised unretried by the node;
        # the runner must still land the thread in a terminal FAILED state — not
        # strand it in RUNNING, which the unique thread_key would wedge forever.
        saver = self._saver()
        thread = start_run(organisation=self.org, record_id=5, checkpointer=saver)
        saver.conn.close()
        self.assertEqual(thread.status, AgentThread.FAILED)
        self.assertIn('LLMNotConfigured', thread.error)

    def test_resume_scoped_to_wrong_org_is_rejected_and_leaves_thread_untouched(self):
        # AC5: org B's run cannot be advanced by a resume scoped to org A.
        with patch('portioning.llm._call_openai', return_value='{"question": "How many?"}'):
            saver = self._saver()
            start_run(organisation=self.other, record_id=3, checkpointer=saver)  # belongs to org B
            saver.conn.close()
        b_key = thread_key('skeleton', self.other.id, 3)

        saver2 = self._saver()
        with self.assertRaises(AgentRunError):
            resume_run(organisation=self.org, record_id=3, answer='x', checkpointer=saver2)
        saver2.conn.close()

        # The org boundary itself: even with B's exact key, scoping to A denies it.
        self.assertFalse(AgentThread.objects.for_org(self.org).filter(thread_key=b_key).exists())
        # B's thread is untouched — still awaiting input.
        self.assertEqual(AgentThread.objects.get(thread_key=b_key).status, AgentThread.AWAITING_INPUT)

    def test_cannot_start_the_same_run_twice(self):
        with patch('portioning.llm._call_openai', return_value='{"question": "How many?"}'):
            saver = self._saver()
            start_run(organisation=self.org, record_id=1, checkpointer=saver)
            saver.conn.close()
            saver2 = self._saver()
            with self.assertRaises(AgentRunError):
                start_run(organisation=self.org, record_id=1, checkpointer=saver2)
            saver2.conn.close()
