"""Run a dataset through an agent target and grade every case. (REL-511)

``run_evals`` is the harness core, kept free of any CLI/exit concerns so it is
unit-testable: it returns an :class:`EvalReport`. The management command
(``run_agent_evals``) turns a regressed report into a non-zero exit.

Baseline (v1): a run passes iff **every assertion evaluator on every case passes**.
A numeric threshold can replace this once there are enough cases to warrant it;
for now any assertion failure is a regression.
"""
import json
from dataclasses import dataclass, field
from pathlib import Path

from portioning import llm

from agents.nodes import AskStructuredError
from agents.evals.evaluators import EVALUATORS, EvalOutcome
from agents.evals.targets import TARGETS, catalog_names

DATASETS_DIR = Path(__file__).resolve().parent / 'datasets'


@dataclass
class CaseResult:
    case_id: str
    passed: bool
    outcomes: list  # list[EvalOutcome]

    def failures(self):
        return [o for o in self.outcomes if not o.passed]


@dataclass
class EvalReport:
    agent: str
    results: list = field(default_factory=list)  # list[CaseResult]

    @property
    def passed_count(self):
        return sum(1 for r in self.results if r.passed)

    @property
    def failed_count(self):
        return sum(1 for r in self.results if not r.passed)

    @property
    def regressed(self):
        """Any case failing an assertion is a regression below baseline."""
        return self.failed_count > 0


def load_dataset(name):
    """Load a dataset by name (``datasets/<name>.json``) or explicit path."""
    path = Path(name)
    if not path.exists():
        path = DATASETS_DIR / f"{name}.json"
    with open(path) as fh:
        return json.load(fh)


def run_evals(dataset, org, *, target_override=None):
    """Grade every case in ``dataset`` for ``org``. Returns an :class:`EvalReport`.

    ``target_override`` swaps the system-under-test for a callable ``(case, org)
    -> dict`` — used by tests to drive a target with a scripted fake provider, and
    by REL-413 to point cases at a specific flow.
    """
    context_catalog = catalog_names(org)
    report = EvalReport(agent=dataset.get('agent', 'unknown'))

    for case in dataset['cases']:
        target_fn, schema = TARGETS[case['target']]
        run = target_override or target_fn
        context = {'catalog': context_catalog, 'schema': schema}

        try:
            output = run(case, org)
        except (AskStructuredError, llm.LLMError) as exc:
            # The target itself failed to produce output — the whole case fails.
            report.results.append(CaseResult(
                case['id'], False, [EvalOutcome('target', False, str(exc))],
            ))
            continue

        outcomes = [EVALUATORS[name](output, case, context) for name in case['constraints']]
        report.results.append(CaseResult(case['id'], all(o.passed for o in outcomes), outcomes))

    return report
