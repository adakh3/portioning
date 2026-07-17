from django.core.management.base import BaseCommand

from bookings.models import OrgSettings
from bookings.services.followup_scheduler import run_all, run_for_org
from users.models import Organisation


class Command(BaseCommand):
    help = (
        "Draft AI follow-ups for eligible stale leads (for review — nothing is sent). "
        "Intended to be run on a cron, e.g. every 15 minutes."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--org", help="Limit to one organisation by id or name.",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Report which leads would get a draft without calling the AI or writing anything.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        if options["org"]:
            org = self._resolve_org(options["org"])
            summaries = [run_for_org(org, dry_run=dry_run)]
        else:
            summaries = run_all(dry_run=dry_run)

        total_created = sum(s.get("created", 0) for s in summaries)
        for s in summaries:
            self.stdout.write(str(s))
        verb = "would create" if dry_run else "created"
        self.stdout.write(self.style.SUCCESS(
            f"Follow-ups done — {verb} {total_created} draft(s) across {len(summaries)} org(s)."
        ))

    def _resolve_org(self, value):
        org = Organisation.objects.filter(pk=value).first() if value.isdigit() else None
        if org is None:
            org = Organisation.objects.filter(name=value).first()
        if org is None:
            from django.core.management.base import CommandError
            raise CommandError(f"No organisation matching {value!r}")
        # Ensure settings exist so the run reports 'not configured' rather than crashing.
        OrgSettings.for_org(org)
        return org
