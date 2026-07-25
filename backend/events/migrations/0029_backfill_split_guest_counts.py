"""Complementary backfill of BookingGuestCount from legacy gents/ladies columns
(REL-415 AC5/AC8/AC9).

Migration 0027 backfilled every booking that existed at REL-408 time. But between
then and REL-415 the **quote** save path did not dual-write segment rows (only the
event did), so a quote created/edited in that window can hold a genuine
gents/ladies split with no rows. This pass fills those in.

Rules (differ deliberately from 0027, matching the decided ACs):
  * **Genuine split only** — ``gents + ladies == guest_count`` and non-zero. A
    count-only or partial (doesn't-add-up) booking is left with no rows so it
    resolves as the single default segment (AC9).
  * **Idempotent** — a booking that already has any ``BookingGuestCount`` row is
    skipped, so re-running never double-writes (and 0027's rows are untouched).
  * Reuses the org's existing Gents/Ladies segments; if the org never defined
    them, the booking is left on the legacy-column fallback (no rows created).
"""
from django.db import migrations


def backfill(apps, schema_editor):
    Event = apps.get_model('events', 'Event')
    Quote = apps.get_model('bookings', 'Quote')
    GuestSegment = apps.get_model('rules', 'GuestSegment')
    BookingGuestCount = apps.get_model('events', 'BookingGuestCount')

    def segment(org, name):
        return GuestSegment.objects.filter(organisation=org, name__iexact=name).first()

    def fill(booking, parent):
        gents, ladies = booking.gents or 0, booking.ladies or 0
        guest_count = booking.guest_count or 0
        if not (gents or ladies) or gents + ladies != guest_count:
            return  # count-only or non-genuine split → no rows (AC9)
        if BookingGuestCount.objects.filter(**parent).exists():
            return  # already has rows (0027 or dual-write) → idempotent
        for name, count in (('gents', gents), ('ladies', ladies)):
            if not count:
                continue
            seg = segment(booking.organisation, name)
            if seg is not None:
                BookingGuestCount.objects.create(segment=seg, count=count, **parent)

    for ev in Event.objects.all():
        fill(ev, {'event': ev})
    for q in Quote.objects.all():
        fill(q, {'quote': q})


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0028_event_gratuity_event_gratuity_pct_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
