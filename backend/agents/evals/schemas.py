"""Structured-output schemas for eval targets (validated by agents/schema.py)."""

# The skeleton agent's only structured output: one clarifying question.
SKELETON_QUESTION_SCHEMA = {
    "type": "object",
    "properties": {"question": {"type": "string"}},
    "required": ["question"],
    "additionalProperties": False,
}

# The first evaluatable *extraction* — pull the hard facts a proposal needs out of
# a free-text inquiry. Nulls are first-class: "no date stated" must come back as
# null, never an invented date. REL-413's proposal builder reuses/extends this.
INQUIRY_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "proposed_dishes": {"type": "array", "items": {"type": "string"}},
        "event_date": {"type": ["string", "null"]},
        "headcount": {"type": ["integer", "null"]},
    },
    "required": ["proposed_dishes", "event_date", "headcount"],
    "additionalProperties": False,
}

# LLM-as-judge verdict (prose/tone cases only).
JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "passed": {"type": "boolean"},
        "reason": {"type": "string"},
    },
    "required": ["passed", "reason"],
    "additionalProperties": False,
}
