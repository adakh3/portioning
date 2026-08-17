"""Orchestrates a skeleton run: DB record <-> checkpointed graph.

The graph knows nothing about *lifecycle status* — it just runs, pauses at the
interrupt, or diverts to the failure node. Mapping "what the graph did" onto the
AgentThread's status is this module's job, and it is the single authority for two
transitions the graph can't see from the inside:

* creating the ``RUNNING`` row and flipping it to ``AWAITING_INPUT`` when a start
  parks at the interrupt (the terminal nodes write ``COMPLETED`` / ``FAILED``
  themselves, since they run *inside* the graph);
* enforcing the **org boundary on resume** — a resume is always scoped to the
  caller's org, so one org can never advance another org's run (AC5).

Keeping this out of the management commands means the same logic backs the real
HTTP endpoints REL-413 will add.
"""
import logging

from langgraph.types import Command

from agents.checkpointer import make_checkpointer, thread_key
from agents.graphs.skeleton import AGENT_NAME, build_skeleton_graph
from agents.models import AgentThread
from agents.tracing import configure_tracing

logger = logging.getLogger(__name__)


class AgentRunError(Exception):
    """A run could not be started/resumed (already exists, wrong state, wrong org)."""


def start_run(*, organisation, record_id, checkpointer=None):
    """Start the skeleton agent for ``organisation``/``record_id``.

    Returns the AgentThread, parked at ``AWAITING_INPUT`` on the happy path or
    ``FAILED`` if the LLM node exhausted its retries. ``checkpointer`` is
    injectable for tests; production passes none and the factory picks one.
    """
    key = thread_key(AGENT_NAME, organisation.id, record_id)
    thread, created = AgentThread.objects.get_or_create(
        thread_key=key,
        defaults={
            'organisation': organisation,
            'agent': AGENT_NAME,
            'status': AgentThread.RUNNING,
        },
    )
    if not created:
        raise AgentRunError(f"A run already exists for {key} (status={thread.status}).")

    initial = {
        'agent': AGENT_NAME,
        'org_id': organisation.id,
        'record_id': record_id,
        'thread_key': key,
    }
    try:
        result = _invoke(key, initial, checkpointer)
    except Exception as exc:
        # The invalid-JSON path is handled *inside* the graph (fail node), but a
        # pre-flight fault has no node to catch it — most importantly
        # LLMNotConfigured, which ask_structured re-raises unretried. Left to
        # propagate it would abort with a traceback and strand the row in
        # RUNNING; since thread_key is unique, that {org, record_id} could then
        # never be started again. So every run reaches a terminal status: record
        # the failure and return, exactly like the in-graph failure path.
        logger.exception("Skeleton run %s crashed before completing", key)
        thread.status = AgentThread.FAILED
        thread.error = f"{type(exc).__name__}: {exc}"
        thread.save(update_fields=['status', 'error', 'updated_at'])
        return thread

    interrupts = result.get('__interrupt__') if isinstance(result, dict) else None
    if interrupts:
        # Parked at the human-in-the-loop interrupt: stash the pending question
        # and mark awaiting. (A start never reaches finalize.)
        question = interrupts[0].value.get('question')
        thread.status = AgentThread.AWAITING_INPUT
        thread.result = {'question': question}
        thread.save(update_fields=['status', 'result', 'updated_at'])
    thread.refresh_from_db()
    return thread


def resume_run(*, organisation, record_id, answer, checkpointer=None):
    """Resume a parked run with a human ``answer``, scoped to ``organisation``.

    Raises :class:`AgentRunError` if no such run exists **for this org** (AC5) or
    it is not awaiting input. Returns the completed AgentThread.
    """
    key = thread_key(AGENT_NAME, organisation.id, record_id)
    try:
        thread = AgentThread.objects.for_org(organisation).get(thread_key=key)
    except AgentThread.DoesNotExist:
        raise AgentRunError(f"No run {key} for this organisation.")
    if thread.status != AgentThread.AWAITING_INPUT:
        raise AgentRunError(f"Run {key} is {thread.status}, not awaiting input.")

    _invoke(key, Command(resume=answer), checkpointer)
    thread.refresh_from_db()
    return thread


def _invoke(key, invoke_arg, checkpointer):
    """Compile the skeleton graph against a checkpointer and invoke it once.

    When we own the checkpointer (none injected) we close its connection after —
    the checkpoint is already durably written, so the next process/resume just
    re-opens the store.
    """
    own = checkpointer is None
    # Opt-in LangSmith tracing (dev/eval only; a no-op unless explicitly enabled
    # with a key — never in CI/prod, see agents/tracing.py). Off ⇒ no network.
    configure_tracing()
    saver = checkpointer or make_checkpointer()
    try:
        app = build_skeleton_graph().compile(checkpointer=saver)
        config = {'configurable': {'thread_id': key}}
        return app.invoke(invoke_arg, config)
    finally:
        if own:
            _close(saver)


def _close(saver):
    conn = getattr(saver, 'conn', None)
    if conn is not None:
        try:
            conn.close()
        except Exception:  # pragma: no cover - best-effort cleanup
            pass
