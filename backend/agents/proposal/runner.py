"""Orchestrates a proposal run: ProposalDraft/AgentThread <-> checkpointed graph.

Mirrors the skeleton runner's split — the graph runs; this module maps outcomes
onto the ``ProposalDraft``/``AgentThread`` lifecycle and enforces the org boundary
on resume. Each run gets its own checkpoint thread (``proposal:{org}:{lead}:{n}``)
so Regenerate is a fresh attempt, never a collision with the prior one.
"""
import logging

from langgraph.types import Command

from agents.checkpointer import make_checkpointer
from agents.models import AgentThread, ProposalDraft
from agents.proposal.graph import AGENT_NAME, build_proposal_graph
from agents.tracing import configure_tracing

logger = logging.getLogger(__name__)


class ProposalRunError(Exception):
    """A proposal run could not be started/resumed (bad state, wrong org, missing lead)."""


def start_proposal(*, organisation, lead, checkpointer=None):
    """Start a proposal for ``lead``. Returns the ProposalDraft, parked at
    ``QUESTIONS_PENDING`` with the generated questions, or ``FAILED``."""
    attempt = ProposalDraft.objects.for_org(organisation).filter(lead=lead).count() + 1
    key = f"{AGENT_NAME}:{organisation.id}:{lead.id}:{attempt}"

    thread = AgentThread.objects.create(
        organisation=organisation, agent=AGENT_NAME, thread_key=key,
        status=AgentThread.RUNNING,
    )
    draft = ProposalDraft.objects.create(
        organisation=organisation, lead=lead, agent_thread=thread,
        status=ProposalDraft.QUESTIONS_PENDING,
    )

    initial = {
        'org_id': organisation.id, 'lead_id': lead.id,
        'draft_id': draft.id, 'thread_key': key,
    }
    result = _invoke(key, initial, checkpointer)
    _apply_start_outcome(thread, draft, result)
    draft.refresh_from_db()
    return draft


def resume_proposal(*, organisation, draft_id, answers, checkpointer=None):
    """Resume a parked proposal with the caterer's form ``answers``, org-scoped.

    Raises :class:`ProposalRunError` if the draft isn't this org's, or isn't
    awaiting answers. Returns the ProposalDraft, ``DRAFTED`` on success."""
    try:
        draft = ProposalDraft.objects.for_org(organisation).select_related('agent_thread').get(pk=draft_id)
    except ProposalDraft.DoesNotExist:
        raise ProposalRunError(f"No proposal draft {draft_id} for this organisation.")
    if draft.status != ProposalDraft.QUESTIONS_PENDING:
        raise ProposalRunError(f"Draft {draft_id} is {draft.status}, not awaiting answers.")

    draft.answers = answers or {}
    draft.status = ProposalDraft.DRAFTING
    draft.save(update_fields=['answers', 'status', 'updated_at'])

    # Wrap so the resume value is never an empty dict (LangGraph ignores a falsy
    # resume); await_answers unwraps {'answers': ...}.
    result = _invoke(draft.agent_thread.thread_key, Command(resume={'answers': answers or {}}), checkpointer)
    _apply_resume_outcome(draft, result)
    draft.refresh_from_db()
    return draft


def regenerate_proposal(*, organisation, draft_id, checkpointer=None):
    """Wholesale regenerate: a fresh attempt for the same lead, reusing the prior
    answers (skips the human form). Returns the NEW ProposalDraft.

    v1 note: this re-runs from the answers; carrying the caterer's manual quote
    edits back in as constraints is a follow-up (needs the editor surface).
    """
    try:
        prior = ProposalDraft.objects.for_org(organisation).select_related('lead').get(pk=draft_id)
    except ProposalDraft.DoesNotExist:
        raise ProposalRunError(f"No proposal draft {draft_id} for this organisation.")

    draft = start_proposal(organisation=organisation, lead=prior.lead, checkpointer=checkpointer)
    if draft.status == ProposalDraft.QUESTIONS_PENDING and prior.answers:
        draft = resume_proposal(
            organisation=organisation, draft_id=draft.id, answers=prior.answers,
            checkpointer=checkpointer,
        )
    return draft


# ── outcome mapping ──
def _apply_start_outcome(thread, draft, result):
    if _has_error(result):
        _fail(thread, draft, _error_text(result))
        return
    interrupts = result.get('__interrupt__') if isinstance(result, dict) else None
    if interrupts:
        questions = interrupts[0].value.get('questions', [])
        thread.status = AgentThread.AWAITING_INPUT
        thread.result = {'questions': questions}
        thread.save(update_fields=['status', 'result', 'updated_at'])
        draft.questions = questions
        draft.status = ProposalDraft.QUESTIONS_PENDING
        draft.save(update_fields=['questions', 'status', 'updated_at'])
    else:
        # No interrupt and no error before assembly is unexpected on a start.
        _fail(thread, draft, 'run ended before reaching the clarifying form')


def _apply_resume_outcome(draft, result):
    thread = draft.agent_thread
    if _has_error(result):
        _fail(thread, draft, _error_text(result))
        return
    quote_id = result.get('quote_id') if isinstance(result, dict) else None
    if quote_id:
        draft.quote_id = quote_id
        draft.status = ProposalDraft.DRAFTED
        draft.save(update_fields=['quote_id', 'status', 'updated_at'])
        thread.status = AgentThread.COMPLETED
        thread.result = {'quote_id': quote_id}
        thread.save(update_fields=['status', 'result', 'updated_at'])
    else:
        _fail(thread, draft, 'resume did not produce a draft quote')


def _fail(thread, draft, message):
    thread.status = AgentThread.FAILED
    thread.error = message
    thread.save(update_fields=['status', 'error', 'updated_at'])
    draft.status = ProposalDraft.FAILED
    draft.error = message
    draft.save(update_fields=['status', 'error', 'updated_at'])


def _has_error(result):
    return isinstance(result, dict) and bool(result.get('error'))


def _error_text(result):
    return result.get('error', 'unknown error') if isinstance(result, dict) else 'unknown error'


# ── invocation (mirrors agents.runner._invoke, proposal graph) ──
def _invoke(key, invoke_arg, checkpointer):
    own = checkpointer is None
    configure_tracing()
    saver = checkpointer or make_checkpointer()
    try:
        app = build_proposal_graph().compile(checkpointer=saver)
        config = {'configurable': {'thread_id': key}}
        try:
            return app.invoke(invoke_arg, config)
        except Exception as exc:
            logger.exception("Proposal run %s crashed", key)
            return {'error': f"{type(exc).__name__}: {exc}"}
    finally:
        if own:
            conn = getattr(saver, 'conn', None)
            if conn is not None:
                try:
                    conn.close()
                except Exception:  # pragma: no cover
                    pass
