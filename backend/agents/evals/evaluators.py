"""Evaluators grade one agent output against one case. Assertions first.

Each evaluator is a pure function ``(output, case, context) -> EvalOutcome``:

* ``output``  — the structured dict the target produced,
* ``case``    — the dataset case (``expected`` holds the ground truth),
* ``context`` — run facts the evaluator needs (``schema``, ``catalog``).

**Deterministic wherever possible** — schema validity, catalog membership, and
date/headcount fidelity are hard assertions with no model in the loop, so they are
cheap, free, and non-flaky. ``llm_judge`` is the only non-deterministic evaluator
and is used solely for prose/tone; a case opts into it explicitly.
"""
from dataclasses import dataclass

from portioning import llm

from agents.schema import SchemaValidationError, validate_structured
from agents.evals.schemas import JUDGE_SCHEMA


@dataclass
class EvalOutcome:
    evaluator: str
    passed: bool
    detail: str = ''


def schema_valid(output, case, context):
    """The output conforms to the target's declared JSON schema."""
    try:
        validate_structured(output, context['schema'])
    except SchemaValidationError as exc:
        return EvalOutcome('schema_valid', False, str(exc))
    return EvalOutcome('schema_valid', True)


def catalog_subset(output, case, context):
    """Every proposed dish exists in this org's catalog — no inventing menu items."""
    catalog = context.get('catalog', set())
    proposed = output.get('proposed_dishes', []) or []
    unknown = [d for d in proposed if d not in catalog]
    if unknown:
        return EvalOutcome('catalog_subset', False, f"not in catalog: {unknown}")
    return EvalOutcome('catalog_subset', True)


def date_not_invented(output, case, context):
    """The event date matches ground truth exactly — and stays null when none was
    stated (the model must not conjure a date)."""
    expected = case.get('expected', {}).get('event_date')
    got = output.get('event_date')
    if got != expected:
        return EvalOutcome('date_not_invented', False, f"expected {expected!r}, got {got!r}")
    return EvalOutcome('date_not_invented', True)


def headcount_echoed(output, case, context):
    """The headcount is echoed from the inquiry, not guessed — and null when
    none was given."""
    expected = case.get('expected', {}).get('headcount')
    got = output.get('headcount')
    if got != expected:
        return EvalOutcome('headcount_echoed', False, f"expected {expected!r}, got {got!r}")
    return EvalOutcome('headcount_echoed', True)


def llm_judge(output, case, context):
    """Prose/tone quality via an LLM judge (only for cases that ask for it).

    Non-deterministic, so kept off the assertion path. A missing/misconfigured
    judge model is a hard fail for the case (you asked for a judged case and it
    couldn't be judged), not a silent pass.
    """
    prompt = case.get('judge_prompt')
    if not prompt:
        return EvalOutcome('llm_judge', False, 'case has no judge_prompt')
    try:
        verdict, _model = llm.complete_structured(
            'LLM_AGENT_EVAL_JUDGE', prompt, str(output), JUDGE_SCHEMA,
        )
        validate_structured(verdict, JUDGE_SCHEMA)
    except (llm.LLMError, SchemaValidationError) as exc:
        return EvalOutcome('llm_judge', False, f'judge error: {exc}')
    return EvalOutcome('llm_judge', bool(verdict.get('passed')), verdict.get('reason', ''))


# Name -> evaluator. Cases reference evaluators by name in their `constraints`.
EVALUATORS = {
    'schema_valid': schema_valid,
    'catalog_subset': catalog_subset,
    'date_not_invented': date_not_invented,
    'headcount_echoed': headcount_echoed,
    'llm_judge': llm_judge,
}
