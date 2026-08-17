"""The walking-skeleton graph — the reference wiring every REL-412 agent copies.

It proves, end to end, the four mechanics the epic's agents all reuse:

1. a **deterministic** node (``load_org_context``) that loads facts,
2. an **LLM** node (``generate_question``) that goes through ``portioning/llm.py``
   and validates + retries (LLM proposes),
3. a **human-in-the-loop interrupt** (``await_answer``) that pauses the run, and
4. **deterministic disposal** (``finalize`` / ``fail``) that writes the outcome
   onto the org-scoped AgentThread.

Shape::

    load_org_context ─▶ generate_question ─▶ (error?) ─▶ fail ─▶ END
                                             └▶ await_answer ─▶ finalize ─▶ END

There is no domain logic here on purpose — REL-413's proposal builder swaps in
real nodes but keeps this skeleton.
"""
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from agents.models import AgentThread
from agents.nodes import AskStructuredError, ask_structured, load_org_context
from agents.state import SkeletonState

AGENT_NAME = 'skeleton'
# 'provider:model' setting resolved by portioning/llm.py; see settings.py.
TASK_SETTING = 'LLM_AGENT_SKELETON'

_SYSTEM_PROMPT = (
    "You are an onboarding assistant for a catering company. Ask the single most "
    "useful clarifying question to start understanding a new event enquiry."
)
_QUESTION_SCHEMA = {
    "type": "object",
    "properties": {"question": {"type": "string"}},
    "required": ["question"],
    "additionalProperties": False,
}


def generate_question(state):
    """LLM node: propose one clarifying question. On exhausted retries, record
    the error into state (the router diverts to the failure path)."""
    try:
        data, _model, _attempts = ask_structured(
            task_setting=TASK_SETTING,
            system=_SYSTEM_PROMPT,
            user_content=f"The organisation is {state.get('org_name', 'a caterer')}.",
            schema=_QUESTION_SCHEMA,
        )
    except AskStructuredError as exc:
        return {'error': str(exc)}
    return {'question': data['question']}


def await_answer(state):
    """Human-in-the-loop: pause until an answer is supplied on resume."""
    answer = interrupt({'question': state['question']})
    return {'answer': answer}


def finalize(state):
    """Deterministic disposal of the happy path: build the result and persist it
    onto the org-scoped AgentThread, marking it completed."""
    result = {
        'org_name': state.get('org_name'),
        'question': state.get('question'),
        'answer': state.get('answer'),
    }
    _write_thread(state['thread_key'], status=AgentThread.COMPLETED, result=result)
    return {'result': result}


def fail(state):
    """Deterministic disposal of the failure path: record the error and mark the
    AgentThread failed. No exception escapes the graph."""
    _write_thread(state['thread_key'], status=AgentThread.FAILED, error=state.get('error', ''))
    return {}


def _write_thread(thread_key, *, status, result=None, error=None):
    thread = AgentThread.objects.get(thread_key=thread_key)
    thread.status = status
    if result is not None:
        thread.result = result
    if error is not None:
        thread.error = error
    thread.save(update_fields=['status', 'result', 'error', 'updated_at'])


def _route_after_question(state):
    return 'fail' if state.get('error') else 'await_answer'


def build_skeleton_graph():
    """Compile-ready graph definition (no checkpointer bound yet — the runner
    binds one). Returning the uncompiled ``StateGraph`` lets the runner compile
    it against whichever checkpointer the environment selects."""
    graph = StateGraph(SkeletonState)
    graph.add_node('load_org_context', load_org_context)
    graph.add_node('generate_question', generate_question)
    graph.add_node('await_answer', await_answer)
    graph.add_node('finalize', finalize)
    graph.add_node('fail', fail)

    graph.add_edge(START, 'load_org_context')
    graph.add_edge('load_org_context', 'generate_question')
    graph.add_conditional_edges(
        'generate_question', _route_after_question,
        {'await_answer': 'await_answer', 'fail': 'fail'},
    )
    graph.add_edge('await_answer', 'finalize')
    graph.add_edge('finalize', END)
    graph.add_edge('fail', END)
    return graph
