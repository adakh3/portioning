"""Run the agent eval harness over a dataset (REL-511).

    python manage.py run_agent_evals --org <id|slug|name> [--agent skeleton|inquiry_extraction]
    python manage.py run_agent_evals --org <slug> --dataset path/to/dataset.json

Prints per-case pass/fail and a summary, and **exits non-zero on any regression**
(a failed assertion below baseline) so it can gate a change. Real runs call the
real provider — keep this out of required CI (evaluator mechanics are covered by
the normal suite with the fake provider).
"""
from django.core.management.base import BaseCommand, CommandError

from agents.evals import run_evals
from agents.evals.runner import load_dataset
from agents.management.commands._org import resolve_org

# Default dataset per agent when --dataset isn't given.
DEFAULT_DATASETS = {
    'skeleton': 'skeleton_v1',
    'inquiry_extraction': 'inquiry_v1',
}


class Command(BaseCommand):
    help = "Run the agent eval harness; non-zero exit on regression."

    def add_arguments(self, parser):
        parser.add_argument('--org', required=True, help='Org id, slug, or name (catalog source).')
        parser.add_argument('--agent', choices=sorted(DEFAULT_DATASETS), default='inquiry_extraction')
        parser.add_argument('--dataset', help='Dataset name or path (overrides --agent default).')

    def handle(self, *args, **options):
        org = resolve_org(options['org'])
        dataset_name = options['dataset'] or DEFAULT_DATASETS[options['agent']]
        try:
            dataset = load_dataset(dataset_name)
        except (FileNotFoundError, ValueError) as exc:
            raise CommandError(f"Could not load dataset {dataset_name!r}: {exc}")

        report = run_evals(dataset, org)

        for result in report.results:
            mark = self.style.SUCCESS('PASS') if result.passed else self.style.ERROR('FAIL')
            self.stdout.write(f"{mark}  {result.case_id}")
            for outcome in result.failures():
                self.stdout.write(f"        ✗ {outcome.evaluator}: {outcome.detail}")

        total = len(report.results)
        summary = f"{report.passed_count}/{total} cases passed ({report.agent})"
        if report.regressed:
            raise CommandError(f"REGRESSION — {summary}; {report.failed_count} failed.")
        self.stdout.write(self.style.SUCCESS(f"OK — {summary}."))
