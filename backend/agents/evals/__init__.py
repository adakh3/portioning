"""On-demand evaluation harness for the REL-412 agents (REL-511).

Prompt/model changes to an agent are gated by *measured* results, not eyeballing.
The harness runs a dataset of synthetic catering inquiries through an agent
"target", grades each output with **deterministic assertion evaluators** wherever
possible (schema validity, catalog membership, date/headcount fidelity) and an
optional LLM-as-judge only for prose/tone, and fails (non-zero exit) on a
regression. Run it with ``python manage.py run_agent_evals``.

The skeleton agent is baselined now; REL-413's proposal builder adds its own cases
and gates its Verify on them.
"""
from agents.evals.runner import EvalReport, run_evals

__all__ = ['run_evals', 'EvalReport']
