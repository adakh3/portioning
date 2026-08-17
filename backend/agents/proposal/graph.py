"""Wire the proposal nodes into the graph (REL-413).

    load_context → generate_questions → await_answers(interrupt) → resolve_event_params
        → compose_menu → validate_composition ─(errors & retries left)→ bump_retry → compose_menu
                                              └─(ok / degraded)────────→ price_quote
        → write_prose → assemble_draft → END

Any node that sets ``error`` short-circuits to END; the runner reads it and marks
the ProposalDraft failed. Returns the uncompiled ``StateGraph`` — the runner binds
the checkpointer, exactly like the skeleton.
"""
from langgraph.graph import END, START, StateGraph

from agents.proposal import nodes
from agents.proposal.state import ProposalState

AGENT_NAME = 'proposal'


def _errored(state):
    return 'error' if state.get('error') else 'ok'


def build_proposal_graph():
    g = StateGraph(ProposalState)

    g.add_node('load_context', nodes.load_context)
    g.add_node('generate_questions', nodes.generate_questions)
    g.add_node('await_answers', nodes.await_answers)
    g.add_node('resolve_event_params', nodes.resolve_event_params)
    g.add_node('compose_menu', nodes.compose_menu)
    g.add_node('validate_composition', nodes.validate_composition)
    g.add_node('bump_retry', nodes.bump_retry)
    g.add_node('price_quote', nodes.price_quote)
    g.add_node('write_prose', nodes.write_prose)
    g.add_node('assemble_draft', nodes.assemble_draft)

    g.add_edge(START, 'load_context')
    g.add_conditional_edges('load_context', _errored, {'error': END, 'ok': 'generate_questions'})
    g.add_conditional_edges('generate_questions', _errored, {'error': END, 'ok': 'await_answers'})
    g.add_edge('await_answers', 'resolve_event_params')
    g.add_edge('resolve_event_params', 'compose_menu')
    g.add_conditional_edges('compose_menu', _errored, {'error': END, 'ok': 'validate_composition'})
    g.add_conditional_edges(
        'validate_composition', nodes.route_after_validate,
        {'retry': 'bump_retry', 'proceed': 'price_quote'},
    )
    g.add_edge('bump_retry', 'compose_menu')
    g.add_edge('price_quote', 'write_prose')
    g.add_edge('write_prose', 'assemble_draft')
    g.add_edge('assemble_draft', END)
    return g
