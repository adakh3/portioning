"""JSON schemas the proposal LLM nodes must return (validated by agents/schema.py).

Each LLM node is prompt -> structured JSON. These schemas are also sent to the
provider as the response format, so they must satisfy **OpenAI strict** structured
outputs: every property listed in ``required``, ``additionalProperties: false``,
and no free-form objects (optional fields are modelled as nullable, and the
otherwise-free ``section_descriptions`` map is an array of {name, description}).
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
                    "kind": {"type": "string", "enum": ["free_text", "choice", "number", "date"]},
                    "suggested": {"type": ["string", "number", "null"]},
                    "options": {"type": ["array", "null"], "items": {"type": "string"}},
                    "impact": {"type": "string", "enum": ["high", "low"]},
                },
                "required": ["id", "text", "kind", "suggested", "options", "impact"],
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
                "required": ["name", "price_per_head", "guest_count"],
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
    "required": ["template_id", "tier_id", "sections", "addon_variant_ids", "meals", "assumptions"],
    "additionalProperties": False,
}

# write_prose: the client-facing sections. section_descriptions is an array of
# {name, description} (strict-safe); the node folds it into a {name: description}
# map before storing, which is the shape the surfaces render.
PROSE_SCHEMA = {
    "type": "object",
    "properties": {
        "intro": {"type": "string"},
        "section_descriptions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["name", "description"],
                "additionalProperties": False,
            },
        },
        "whats_included": {"type": "array", "items": {"type": "string"}},
        "day_of_outline": {"type": "string"},
        "closing": {"type": "string"},
    },
    "required": ["intro", "section_descriptions", "whats_included", "day_of_outline", "closing"],
    "additionalProperties": False,
}
