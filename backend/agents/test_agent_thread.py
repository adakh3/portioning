"""AgentThread org-scoping: tenant manager + cross-org FK backstop."""
from django.core.exceptions import ValidationError
from django.test import TestCase

from agents.models import AgentThread
from users.models import Organisation


class AgentThreadScopingTests(TestCase):
    def setUp(self):
        self.org_a = Organisation.objects.create(name='Org A', slug='org-a')
        self.org_b = Organisation.objects.create(name='Org B', slug='org-b')

    def test_for_org_isolates_threads(self):
        AgentThread.objects.create(agent='skeleton', organisation=self.org_a, thread_key='skeleton:1:1')
        AgentThread.objects.create(agent='skeleton', organisation=self.org_b, thread_key='skeleton:2:1')
        a_keys = list(AgentThread.objects.for_org(self.org_a).values_list('thread_key', flat=True))
        self.assertEqual(a_keys, ['skeleton:1:1'])

    def test_thread_key_is_unique(self):
        AgentThread.objects.create(agent='skeleton', organisation=self.org_a, thread_key='skeleton:1:1')
        with self.assertRaises(Exception):
            AgentThread.objects.create(agent='skeleton', organisation=self.org_b, thread_key='skeleton:1:1')

    def test_defaults(self):
        t = AgentThread.objects.create(agent='skeleton', organisation=self.org_a, thread_key='skeleton:1:9')
        self.assertEqual(t.status, AgentThread.RUNNING)
        self.assertEqual(t.result, {})
        self.assertEqual(t.error, '')
