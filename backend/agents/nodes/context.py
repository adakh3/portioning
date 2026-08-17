"""Deterministic nodes: they *dispose* — load facts, write records, no LLM.

``load_org_context`` is the canonical first node of every agent graph: given the
run's ``org_id``, it loads the org and puts the plain facts a downstream LLM node
is allowed to see into state. Deterministic, side-effect-free, trivially testable.
"""
from users.models import Organisation


def load_org_context(state):
    """Load the run's organisation into state. Deterministic (no LLM, no writes)."""
    org = Organisation.objects.get(pk=state['org_id'])
    return {'org_name': org.name}
