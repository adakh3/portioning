"""REL-449 — clear per-segment rates that were never a usable amount.

`BookingGuestCount.price_per_head` was bounded nowhere that ran: the model's
`MinValueValidator(0)` never fires because `write_booking_segments` writes through
`update_or_create` (no `full_clean`), and no serializer checked it. So a NEGATIVE
rate could be, and may have been, stored — the subtotal guard only rejects a
booking whose *whole subtotal* goes below zero, so anything that merely undercharged
saved fine.

That matters for this release specifically. The engines now refuse a negative rate
and fall back to the segment's multiplier, so a legacy row would make an existing
booking's total **jump** the next time anything triggers `recalculate_totals()` —
silently, on quotes that may already have been sent or accepted. Clearing the rows
here means the re-price happens once, visibly, in a migration that says so, instead
of at some arbitrary later save.

Null (not zero) is the correct landing: NULL means "no override — use the
multiplier", which is exactly what the engines now do with an unusable value. Zero
would mean "this segment is deliberately free", which nobody chose.

Reversible in the only sense that matters: the values being cleared were never
valid, so there is nothing meaningful to restore.
"""
from django.db import migrations


def clear_unusable_rates(apps, schema_editor):
    BookingGuestCount = apps.get_model('events', 'BookingGuestCount')
    bad = BookingGuestCount.objects.filter(price_per_head__lt=0)
    affected = list(bad.values_list('quote_id', 'event_id', 'price_per_head')[:50])
    count = bad.update(price_per_head=None)
    if count:
        # Loud on purpose — this changes what existing bookings are worth.
        print(f'\n  REL-449: cleared {count} negative per-segment rate(s).')
        for quote_id, event_id, rate in affected:
            target = f'quote {quote_id}' if quote_id else f'event {event_id}'
            print(f'    {target}: {rate}/head -> NULL (falls back to the multiplier)')
        print('    Those bookings will re-price on their next save. Re-check any '
              'that were already sent or accepted.\n')


def noop_reverse(apps, schema_editor):
    """Nothing to restore — the cleared values were never valid rates."""


class Migration(migrations.Migration):

    dependencies = [
        # Renumbered 0036 -> 0037 when this branch was updated from main: REL-419's
        # 0036 landed first, so the graph had two leaves. Data-only migration, so
        # ordering behind it is safe — nothing here depends on that schema change.
        ('events', '0036_eventdishcomment_choice_count_and_more'),
    ]

    operations = [
        migrations.RunPython(clear_unusable_rates, noop_reverse),
    ]
