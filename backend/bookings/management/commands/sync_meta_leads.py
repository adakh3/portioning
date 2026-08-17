"""Backfill Meta lead-ad submissions for every connected Page (REL-507).

The webhook is the primary path; this idempotent sweep is the safety net for
anything it missed (downtime, transient Graph failures) within Meta's 90-day
retention window. Run hourly via the cron endpoint, or by hand:

    python manage.py sync_meta_leads
"""

from django.core.management.base import BaseCommand

from bookings.services import meta_leads


class Command(BaseCommand):
    help = 'Ingest any not-yet-seen Meta lead-ad submissions for all connected Pages.'

    def handle(self, *args, **options):
        created = meta_leads.backfill_all()
        self.stdout.write(self.style.SUCCESS(f'Meta backfill complete — {created} new lead(s) created.'))
