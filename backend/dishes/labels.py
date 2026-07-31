"""How a dish's dietary/allergen tags are written out.

One place, so the PDF, the sign page and the API all phrase a dish's tags the
same way. Dietary tags read as badges the dish *is* (``GF, DF``); allergens read
as what it *contains* — the distinction US clients (and the FDA) care about.

Nothing here ever emits text for an untagged dish: ``dietary_suffix([]) == ''``,
which is what keeps untagged menus byte-identical to before this vocabulary
existed.
"""
from .models import DietaryTagKind


def split_by_kind(tags):
    """``(dietary, allergen)`` lists, preserving the order they came in."""
    dietary = [t for t in tags if t.kind != DietaryTagKind.ALLERGEN]
    allergens = [t for t in tags if t.kind == DietaryTagKind.ALLERGEN]
    return dietary, allergens


def dietary_suffix(tags):
    """`' (GF, DF; contains milk, peanuts)'` — or `''` for an untagged dish.

    Note the leading space: callers append this straight onto a dish name.
    """
    dietary, allergens = split_by_kind(tags)
    parts = []
    if dietary:
        parts.append(', '.join(t.badge for t in dietary))
    if allergens:
        parts.append('contains ' + ', '.join(t.label.lower() for t in allergens))
    if not parts:
        return ''
    return f" ({'; '.join(parts)})"
