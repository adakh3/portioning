"""Start a walking-skeleton agent run for an org (no HTTP in this ticket).

    python manage.py run_skeleton_agent --org <id|slug|name> --record-id 1

Starts the run, which parks at the human-in-the-loop interrupt, and prints the
question to answer with ``resume_skeleton_agent``. The process exits cleanly with
the state checkpointed — resuming works from a fresh process.
"""
from django.core.management.base import BaseCommand, CommandError

from agents.management.commands._org import resolve_org
from agents.models import AgentThread
from agents.runner import AgentRunError, start_run


class Command(BaseCommand):
    help = "Start the walking-skeleton agent for an org; parks at the interrupt."

    def add_arguments(self, parser):
        parser.add_argument('--org', required=True, help='Organisation id, slug, or name.')
        parser.add_argument('--record-id', type=int, default=1,
                            help='Arbitrary record id for the thread key (default: 1).')

    def handle(self, *args, **options):
        org = resolve_org(options['org'])
        try:
            thread = start_run(organisation=org, record_id=options['record_id'])
        except AgentRunError as exc:
            raise CommandError(str(exc))

        if thread.status == AgentThread.AWAITING_INPUT:
            self.stdout.write(self.style.SUCCESS(f"Thread {thread.thread_key} awaiting input."))
            self.stdout.write(f"Question: {thread.result.get('question')}")
            self.stdout.write(
                f"Resume with: manage.py resume_skeleton_agent --org {options['org']} "
                f"--record-id {options['record_id']} --answer \"...\""
            )
        else:
            self.stdout.write(self.style.ERROR(
                f"Thread {thread.thread_key} ended {thread.status}: {thread.error}"
            ))
