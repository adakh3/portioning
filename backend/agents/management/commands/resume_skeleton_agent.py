"""Resume a parked walking-skeleton run with a human answer (a *new process*).

    python manage.py resume_skeleton_agent --org <id|slug|name> --record-id 1 --answer "120 guests"

Proves the resume-after-restart mechanic: the checkpoint from the earlier
``run_skeleton_agent`` process is re-opened, the graph continues from the
interrupt, and the thread ends ``completed``. The resume is org-scoped — a run
belonging to another org is not found and is left untouched.
"""
from django.core.management.base import BaseCommand, CommandError

from agents.management.commands._org import resolve_org
from agents.runner import AgentRunError, resume_run


class Command(BaseCommand):
    help = "Resume a parked walking-skeleton run with an answer; org-scoped."

    def add_arguments(self, parser):
        parser.add_argument('--org', required=True, help='Organisation id, slug, or name.')
        parser.add_argument('--record-id', type=int, default=1)
        parser.add_argument('--answer', required=True, help='The human answer to the pending question.')

    def handle(self, *args, **options):
        org = resolve_org(options['org'])
        try:
            thread = resume_run(
                organisation=org, record_id=options['record_id'], answer=options['answer'],
            )
        except AgentRunError as exc:
            raise CommandError(str(exc))

        self.stdout.write(self.style.SUCCESS(f"Thread {thread.thread_key} ended {thread.status}."))
        self.stdout.write(f"Result: {thread.result}")
