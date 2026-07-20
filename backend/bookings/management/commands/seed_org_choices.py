from django.core.management.base import BaseCommand, CommandError

from bookings.defaults import seed_choice_defaults
from users.models import Organisation


class Command(BaseCommand):
    help = (
        "Seed the starter choice-option defaults (event types, sources, service "
        "styles, meal types) for existing organisations that predate signal "
        "seeding. Idempotent — an org keeps any option it already has."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--org", help="Limit to one organisation by id or name (default: all).",
        )

    def handle(self, *args, **options):
        if options["org"]:
            orgs = [self._resolve_org(options["org"])]
        else:
            orgs = list(Organisation.objects.all())

        for org in orgs:
            # only_if_empty: never re-add an option an org deliberately removed.
            seed_choice_defaults(org, only_if_empty=True)
            self.stdout.write(f"Seeded choice defaults for {org.name!r}")
        self.stdout.write(self.style.SUCCESS(
            f"Done — {len(orgs)} organisation(s) seeded."
        ))

    def _resolve_org(self, value):
        org = Organisation.objects.filter(pk=value).first() if value.isdigit() else None
        if org is None:
            org = Organisation.objects.filter(name=value).first()
        if org is None:
            raise CommandError(f"No organisation matching {value!r}")
        return org
