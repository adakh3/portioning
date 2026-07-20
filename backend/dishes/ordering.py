"""Read a booking's dishes in the order they were *added*, not alphabetically.

A booking's `dishes` is a plain ManyToManyField, so `booking.dishes.all()`
inherits ``Dish.Meta.ordering`` (category, then name) — i.e. alphabetical.
The order the user added dishes in is still recoverable: `.set()` writes the
through-table rows in list order, so their auto ``id`` preserves add-order.
These helpers read by that instead.

Works for any model with a plain `dishes` M2M (Event, Quote, BookingMeal).
"""
from .models import Dish


def _through_fk_name(booking):
    """The name of the through-table FK pointing back at the booking."""
    through = type(booking).dishes.through
    for f in through._meta.get_fields():
        if getattr(f, 'many_to_one', False) and f.related_model is type(booking):
            return through, f.name
    raise ValueError(f"No FK to {type(booking).__name__} on {through.__name__}")


def dish_ids_in_added_order(booking):
    """The booking's dish pks in add-order (one query, no Dish fetch)."""
    through, fk = _through_fk_name(booking)
    return list(
        through.objects.filter(**{fk: booking})
        .order_by('id').values_list('dish_id', flat=True)
    )


def dish_names_in_added_order(booking):
    """The booking's dish names in add-order (one query)."""
    through, fk = _through_fk_name(booking)
    return list(
        through.objects.filter(**{fk: booking})
        .order_by('id').values_list('dish__name', flat=True)
    )
