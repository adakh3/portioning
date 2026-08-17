"""JSON schemas the proposal LLM nodes must return (validated by agents/schema.py).

Each LLM node is prompt -> structured JSON. Keeping the schemas here — separate
from the prompts — makes the contract each node's deterministic partner relies on
explicit and testable.
"""

# generate_questions: 3-6 clarifying questions, each pre-filled with a suggestion.
QUESTIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "text": {"type": "string"},
                    # free_text | choice | number | date
                    "kind": {"type": "string", "enum": ["free_text", "choice", "number", "date"]},
                    "suggested": {"type": ["string", "number", "null"]},
                    "options": {"type": "array", "items": {"type": "string"}},
                    # high | low — high-impact ambiguities must be asked, not guessed.
                    "impact": {"type": "string", "enum": ["high", "low"]},
                },
                "required": ["id", "text", "kind", "impact"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["questions"],
    "additionalProperties": False,
}

# compose_menu: a plan referencing ONLY ids from the injected catalog digest.
MENU_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "template_id": {"type": ["integer", "null"]},
        "tier_id": {"type": ["integer", "null"]},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "dish_ids": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["name", "dish_ids"],
                "additionalProperties": False,
            },
        },
        "addon_variant_ids": {"type": "array", "items": {"type": "integer"}},
        "meals": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "price_per_head": {"type": ["number", "null"]},
                    "guest_count": {"type": ["integer", "null"]},
                },
                "required": ["name"],
                "additionalProperties": False,
            },
        },
        "assumptions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "field": {"type": "string"},
                    "value": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["field", "value", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sections"],
    "additionalProperties": False,
}

# write_prose: the client-facing sections. section_descriptions is keyed by
# section name (free-form object) so it tracks whatever sections compose_menu chose.
PROSE_SCHEMA = {
    "type": "object",
    "properties": {
        "intro": {"type": "string"},
        "section_descriptions": {"type": "object"},
        "whats_included": {"type": "array", "items": {"type": "string"}},
        "day_of_outline": {"type": "string"},
        "closing": {"type": "string"},
    },
    "required": ["intro", "whats_included", "day_of_outline", "closing"],
    "additionalProperties": False,
}
