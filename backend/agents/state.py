"""Typed graph state for the walking-skeleton agent.

Every REL-412 agent's LangGraph state is a plain ``TypedDict``: nodes take the
state in and return a *partial* update (LangGraph merges it). ``total=False`` so
each node only has to return the keys it actually sets. The identity/scoping keys
(``agent``, ``org_id``, ``record_id``, ``thread_key``) are seeded at start and
read by the terminal nodes to write back to the right, org-scoped AgentThread.
"""
from typing import TypedDict


class SkeletonState(TypedDict, total=False):
    # ── identity & org scoping (seeded at start) ──
    agent: str
    org_id: int
    record_id: int
    thread_key: str

    # ── loaded by load_org_context (deterministic) ──
    org_name: str

    # ── proposed by generate_question (LLM); disposed by deterministic nodes ──
    question: str
    # Set instead of ``question`` when the LLM node exhausts its retries — the
    # signal the router uses to divert to the failure path.
    error: str

    # ── supplied by the human at the interrupt ──
    answer: str

    # ── written by finalize (deterministic) ──
    result: dict
