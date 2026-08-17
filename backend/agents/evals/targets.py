"""Eval targets: run an agent on a case's input and return its structured output.

A target is ``(case, org) -> dict``. It is the *system under test* — the harness
grades whatever dict it returns. Each target names the schema its output should
satisfy so ``schema_valid`` can check it.

Two targets today:

* ``skeleton`` — the REL-510 skeleton's LLM step (load org context → generate the
  clarifying question). Baselined now.
* ``inquiry_extraction`` — the first evaluatable *extraction*: pull dishes / date /
  headcount from a free-text inquiry, constrained to the org's catalog. Minimal on
  purpose; REL-413's proposal builder builds on it.

Both go through ``portioning/llm.py`` (via ``ask_structured``) — no other LLM path.
"""
from agents.nodes import ask_structured, load_org_context
from agents.graphs.skeleton import TASK_SETTING as SKELETON_TASK_SETTING, generate_question
from agents.evals.schemas import INQUIRY_EXTRACTION_SCHEMA, SKELETON_QUESTION_SCHEMA

EXTRACTION_TASK_SETTING = 'LLM_AGENT_INQUIRY_EXTRACTION'

_EXTRACTION_SYSTEM = (
    "You extract the hard facts a caterer needs from a customer's enquiry. Only "
    "propose dishes that appear in the provided catalog — never invent menu items. "
    "If the enquiry does not state an event date or a headcount, return null for "
    "that field; never guess. Echo the stated headcount exactly. Return event_date "
    "as an ISO 8601 date (YYYY-MM-DD)."
)


def skeleton_target(case, org):
    """Run the skeleton's deterministic-then-LLM step; output is {question}."""
    state = {'org_id': org.id}
    state.update(load_org_context(state))
    result = generate_question(state)
    # generate_question returns {'question': ...} or {'error': ...}; surface the
    # error as an empty output so schema_valid fails loudly rather than KeyError.
    return {'question': result.get('question', '')} if 'question' in result else {}


def inquiry_extraction_target(case, org):
    """Extract {proposed_dishes, event_date, headcount} from the case's inquiry."""
    catalog = sorted(_catalog_names(org))
    user = (
        f"Catalog (only propose from these): {catalog}\n\n"
        f"Enquiry:\n{case['input']['inquiry']}"
    )
    data, _model, _attempts = ask_structured(
        task_setting=EXTRACTION_TASK_SETTING,
        system=_EXTRACTION_SYSTEM,
        user_content=user,
        schema=INQUIRY_EXTRACTION_SCHEMA,
    )
    return data


def _catalog_names(org):
    # Imported lazily so this module stays import-safe before app registry is ready.
    from dishes.models import Dish

    return set(Dish.objects.for_org(org).values_list('name', flat=True))


def proposal_menu_target(case, org):
    """Run the REL-413 proposal composer (LLM) for a case's event params and report
    the dishes it proposed *as names* — mapping the RAW proposed ids (not the
    catalog-stripped ones) so ``catalog_subset`` actually grades whether the model
    stayed in-catalog. This is how the eval harness gates proposal quality."""
    from dishes.models import Dish
    from agents.proposal import nodes as pnodes
    from agents.proposal.tools import get_catalog_digest as proposal_catalog_digest

    state = {
        'org_id': org.id,
        'context': {'lead': {}, 'catalog': proposal_catalog_digest(org)},
        'event_params': case.get('event_params', {}),
    }
    result = pnodes.compose_menu(state)
    plan = result.get('menu_plan', {})
    raw_ids = [d for section in plan.get('sections', []) for d in section.get('dish_ids', [])]
    names_by_id = dict(Dish.objects.filter(id__in=raw_ids).values_list('id', 'name'))
    proposed = [names_by_id.get(i, f'unknown-{i}') for i in raw_ids]
    params = case.get('event_params', {})
    return {'proposed_dishes': proposed, 'event_date': params.get('date'),
            'headcount': params.get('headcount')}


# Name -> (target_fn, output_schema). Cases reference a target by name.
TARGETS = {
    'skeleton': (skeleton_target, SKELETON_QUESTION_SCHEMA),
    'inquiry_extraction': (inquiry_extraction_target, INQUIRY_EXTRACTION_SCHEMA),
    'proposal_menu': (proposal_menu_target, INQUIRY_EXTRACTION_SCHEMA),
}


def catalog_names(org):
    """Public helper for the runner: this org's dish-name catalog as a set."""
    return _catalog_names(org)
