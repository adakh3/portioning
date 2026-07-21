"""Apply country-derived locale defaults to ONE org's OrgSettings, by hand.

Existing orgs are deliberately never bulk-rewritten (a live org's
UK-flavoured settings may be intentional). When an org is known to be
mis-provisioned, an operator runs this explicitly:

    python manage.py apply_country_defaults --org "Acme Catering"
    python manage.py apply_country_defaults --org "Acme Catering" --dry-run

Only the locale fields derived from the org's country are touched
(currency, tax label/rate, timezone, date/time format).
"""
from django.core.management.base import BaseCommand, CommandError

from users.models import Organisation
from users.country_defaults import defaults_for_country


class Command(BaseCommand):
    help = "Apply country-derived locale defaults to a single org's OrgSettings."

    def add_arguments(self, parser):
        parser.add_argument('--org', required=True, help="Organisation name (exact).")
        parser.add_argument(
            '--dry-run', action='store_true',
            help="Show what would change without writing.",
        )

    def handle(self, *args, **options):
        from bookings.models import OrgSettings

        name = options['org']
        try:
            org = Organisation.objects.get(name=name)
        except Organisation.DoesNotExist:
            raise CommandError(f"No organisation named {name!r}.")
        except Organisation.MultipleObjectsReturned:
            raise CommandError(f"More than one organisation named {name!r}.")

        defaults = defaults_for_country(org.country)
        settings = OrgSettings.for_org(org)

        changes = {
            field: (getattr(settings, field), value)
            for field, value in defaults.items()
            if getattr(settings, field) != value
        }

        label = org.country or 'fallback'
        if not changes:
            self.stdout.write(f"{org.name}: already matches {label} defaults — nothing to do.")
            return

        for field, (old, new) in changes.items():
            self.stdout.write(f"  {field}: {old!r} -> {new!r}")

        if options['dry_run']:
            self.stdout.write("dry-run — no changes written.")
            return

        for field, value in defaults.items():
            setattr(settings, field, value)
        settings.save()
        self.stdout.write(self.style.SUCCESS(f"Applied {label} defaults to {org.name}."))
