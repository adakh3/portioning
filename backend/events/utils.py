def auto_calculate_portions(event):
    """Auto-calculate portions for an event's dishes. Call after dishes are set."""
    if not event.dishes.exists():
        return
    from calculator.engine.calculator import calculate_portions
    from events.models import EventDishComment

    result = calculate_portions(
        dish_ids=list(event.dishes.values_list('id', flat=True)),
        guests={'gents': event.gents, 'ladies': event.ladies},
        org=event.organisation,
    )
    for p in result['portions']:
        EventDishComment.objects.update_or_create(
            event=event, dish_id=p['dish_id'],
            defaults={'portion_grams': p['grams_per_person']},
        )
