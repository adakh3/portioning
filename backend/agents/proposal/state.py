"""Typed state for the AI Proposal Builder graph (REL-413).

One ``TypedDict`` flows along the edges; each node returns a partial update.
``total=False`` so a node only returns the keys it sets. Identity keys
(``org_id``/``lead_id``/``draft_id``/``thread_key``) are seeded at start and read
by ``assemble_draft`` to write the org-scoped Quote + ProposalDraft.
"""
from typing import TypedDict


class ProposalState(TypedDict, total=False):
    # ── identity & scoping (seeded at start) ──
    org_id: int
    lead_id: int
    draft_id: int
    thread_key: str

    # ── load_context (deterministic): lead facts + thread summary + catalog digest ──
    context: dict

    # ── generate_questions (LLM) → await_answers (interrupt) ──
    questions: list   # [{id, text, kind, suggested, options?, impact}]
    answers: dict     # {question_id: answer}

    # ── resolve_event_params (deterministic) ──
    event_params: dict  # {occasion, date, headcount, budget_per_head, service_style, ...}

    # ── compose_menu (LLM) → validate_composition (deterministic) ──
    menu_plan: dict   # {template_id, tier_id, sections:[{name, dish_ids}], addon_variant_ids, meals}
    # Catalog-validated, checkpoint-safe (ids only) plan the priced/assembled draft uses.
    _resolved: dict   # {template_id, tier_id, sections:[{name, dish_ids}], addon_variant_ids}

    # ── price_quote (deterministic): all money via the totals engine ──
    pricing: dict     # {price_per_head, guest_count, subtotal, service_charge, tax_amount, gratuity, total, line_items, meals}

    # ── write_prose (LLM) ──
    prose: dict       # {intro, section_descriptions, whats_included, day_of_outline, closing}

    # ── accumulated across the run ──
    assumptions: list  # [{field, value, reason}]
    validation: dict   # {errors:[...], warnings:[...], retry_count:int}

    # ── terminal ──
    quote_id: int   # set by assemble_draft on success
    error: str
