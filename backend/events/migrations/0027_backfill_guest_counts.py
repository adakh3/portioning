"""Backfill BookingGuestCount from the legacy Event/Quote gents/ladies columns
(and a quote's single guest_count where no split was set), so the new per-segment
model is the source of truth. The old columns are left in place for now; a later
migration drops them once all readers use segments."""
from django.db import migrations


def backfill(apps, schema_editor):
    Event = apps.get_model('events', 'Event')
    Quote = apps.get_model('bookings', 'Quote')
    GuestSegment = apps.get_model('rules', 'GuestSegment')
    BookingGuestCount = apps.get_model('events', 'BookingGuestCount')

    def segment(org, name, sort_order, is_default, portion=1.0):
        """Reuse a case-insensitively-matching segment, else create it."""
        seg = GuestSegment.objects.filter(organisation=org, name__iexact=name).first()
        if seg is None:
            seg = GuestSegment.objects.create(
                organisation=org, name=name, portion_multiplier=portion,
                sort_order=sort_order, is_default=is_default,
            )
        return seg

    def base_segment(org):
        return (
            GuestSegment.objects.filter(organisation=org, is_default=True).first()
            or segment(org, 'Adults', 0, True)
        )

    for ev in Event.objects.all():
        org = ev.organisation
        if ev.gents:
            BookingGuestCount.objects.get_or_create(
                event=ev, segment=segment(org, 'Gents', 0, True), defaults={'count': ev.gents})
        if ev.ladies:
            BookingGuestCount.objects.get_or_create(
                event=ev, segment=segment(org, 'Ladies', 1, False), defaults={'count': ev.ladies})

    for q in Quote.objects.all():
        org = q.organisation
        if q.gents or q.ladies:
            if q.gents:
                BookingGuestCount.objects.get_or_create(
                    quote=q, segment=segment(org, 'Gents', 0, True), defaults={'count': q.gents})
            if q.ladies:
                BookingGuestCount.objects.get_or_create(
                    quote=q, segment=segment(org, 'Ladies', 1, False), defaults={'count': q.ladies})
        elif q.guest_count:
            # No gender split recorded — the whole count is the base segment.
            BookingGuestCount.objects.get_or_create(
                quote=q, segment=base_segment(org), defaults={'count': q.guest_count})


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0026_bookingguestcount'),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
