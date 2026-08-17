"""Shared, reusable node library for REL-412 agents.

Nodes are plain Python functions: typed state dict in -> partial state update out.
No Django view, no HTTP, no LangChain — just functions a graph wires together.
The guiding split: **LLM nodes propose, deterministic nodes dispose.**
"""
from agents.nodes.context import load_org_context
from agents.nodes.llm_node import AskStructuredError, ask_structured

__all__ = ['load_org_context', 'ask_structured', 'AskStructuredError']
