from django.core.management.base import BaseCommand, CommandError

from bookings.models import ProductLine
from bookings.services.lead_import import load_xlsx, parse_rows, commit_rows
from users.models import User


class Command(BaseCommand):
    help = "Import leads from an Excel file"

    def add_arguments(self, parser):
        parser.add_argument("file", help="Path to .xlsx file")
        parser.add_argument("--sheet", required=True, help="Sheet name to import from")
        parser.add_argument("--product", help="Product line name (e.g. Pavilion)")
        parser.add_argument("--assigned-to", help="User email to assign leads to")
        parser.add_argument("--dry-run", action="store_true", help="Preview without saving")

    def handle(self, *args, **options):
        try:
            import openpyxl  # noqa: F401
        except ImportError:
            raise CommandError("openpyxl is required: pip install openpyxl")

        product = None
        if options["product"]:
            try:
                product = ProductLine.objects.get(name__iexact=options["product"])
            except ProductLine.DoesNotExist:
                raise CommandError(f"Product line '{options['product']}' not found")

        assigned_to = None
        if options["assigned_to"]:
            try:
                assigned_to = User.objects.get(email=options["assigned_to"])
            except User.DoesNotExist:
                raise CommandError(f"User '{options['assigned_to']}' not found")

        header, data_rows, sheet_names = load_xlsx(options["file"], options["sheet"])

        if options["sheet"] not in sheet_names:
            raise CommandError(f"Sheet '{options['sheet']}' not found. Available: {sheet_names}")

        if not header:
            raise CommandError("The file appears to be empty.")

        try:
            import_rows = parse_rows(data_rows, header)
        except ValueError as e:
            raise CommandError(str(e))

        skipped = sum(1 for r in import_rows if r.skipped)

        if options["dry_run"]:
            for row in import_rows:
                if row.skipped:
                    continue
                self.stdout.write(
                    f"  [{row.status}] {row.contact_name} | {row.contact_email} | "
                    f"{row.contact_phone} | {row.event_type} | "
                    f"{row.guest_estimate} guests | {row.event_date} | {row.source}"
                )
            valid = sum(1 for r in import_rows if not r.skipped)
            self.stdout.write(self.style.SUCCESS(f"\nWould create {valid} leads, skipped {skipped}"))
            return

        created, errors = commit_rows(import_rows, product, assigned_to)
        self.stdout.write(self.style.SUCCESS(f"\nCreated {created} leads, skipped {skipped}"))
        if errors:
            self.stdout.write(self.style.WARNING(f"{len(errors)} errors:"))
            for e in errors:
                self.stdout.write(f"  {e}")
