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


def dish_display_names_in_added_order(booking):
    """Dish names in add-order, each with its dietary/allergen suffix appended.

    The display counterpart of ``dish_names_in_added_order`` — used by the client-
    facing surfaces (PDFs, sign page) so a menu answers "what's gluten-free?".
    A dish with no tags yields exactly its plain name, so an untagged booking
    renders byte-identically to before dietary tags existed.

    Two queries total regardless of dish count (the through rows, then every tag
    link for those dishes) — never one per dish.
    """
    from .labels import dietary_suffix

    through, fk = _through_fk_name(booking)
    rows = list(
        through.objects.filter(**{fk: booking})
        .order_by('id').values_list('dish_id', 'dish__name')
    )
    if not rows:
        return []

    tags_by_dish = tags_for_dish_ids([dish_id for dish_id, _ in rows])
    return [name + dietary_suffix(tags_by_dish.get(dish_id, [])) for dish_id, name in rows]


def tags_for_dish_ids(dish_ids):
    """``{dish_id: [DietaryTag, ...]}`` for the given dishes, in one query.

    Tags come back in ``DietaryTag.Meta.ordering`` (dietary before allergen, then
    sort_order), so every surface lists them the same way.
    """
    if not dish_ids:
        return {}
    link_model = Dish.dietary_tags.through
    links = (
        link_model.objects.filter(dish_id__in=dish_ids)
        .select_related('dietarytag')
        .order_by('dietarytag__kind', 'dietarytag__sort_order', 'dietarytag__slug')
    )
    out = {}
    for link in links:
        out.setdefault(link.dish_id, []).append(link.dietarytag)
    return out
