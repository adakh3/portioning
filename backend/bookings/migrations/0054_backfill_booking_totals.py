"""Data migration: recompute every quote's and event's stored subtotal/tax/total.

Some bookings were saved with a stale stored subtotal — the prefetch-cache bug in
`recalculate_totals` dropped add-on line items added during an edit, so the stored
summary (used by the view and the PDF) omitted them while the items themselves
saved fine. The code fix stops new drift; this backfills existing rows so the
already-affected quotes/events (and their PDFs) show the correct total after
deploy. Math is inlined (not importing app code) so the migration stays stable.
"""
from decimal import Decimal

from django.db import migrations

TWO = Decimal("0.01")


def _reconcile(obj, food_total):
    items_total = sum((li.line_total or Decimal("0")) for li in obj.line_items.all())
    subtotal = (food_total + items_total).quantize(TWO)
    rate = (obj.tax_rate if obj.is_taxable else Decimal("0")) or Decimal("0")
    tax_amount = (subtotal * rate).quantize(TWO)
    total = (subtotal + tax_amount).quantize(TWO)
    if (obj.subtotal, obj.tax_amount, obj.total) != (subtotal, tax_amount, total):
        obj.subtotal, obj.tax_amount, obj.total = subtotal, tax_amount, total
        obj.save(update_fields=["subtotal", "tax_amount", "total"])


def _meals_food(obj):
    total = Decimal("0.00")
    for m in obj.additional_meals.all():
        if m.price_per_head and m.guest_count:
            total += m.price_per_head * m.guest_count
    return total


def backfill(apps, schema_editor):
    db = schema_editor.connection.alias
    Quote = apps.get_model("bookings", "Quote")
    Event = apps.get_model("events", "Event")

    for q in Quote.objects.using(db).all():
        food = _meals_food(q)
        if q.price_per_head and q.price_per_head > 0:
            food += q.price_per_head * q.guest_count
        _reconcile(q, food)

    for e in Event.objects.using(db).all():
        food = _meals_food(e)
        if e.price_per_head and e.price_per_head > 0:
            food += e.price_per_head * ((e.gents or 0) + (e.ladies or 0))
        _reconcile(e, food)


class Migration(migrations.Migration):
    dependencies = [
        ("bookings", "0053_productline_is_default"),
        ("events", "0022_rename_event_date"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
