"""Pure validation logic for user-supplied portions against system constraints."""

from .models import DishInput, GuestMix, ResolvedConstraints


def check_user_portions(
    user_portions,
    dishes,
    constraints,
    pool_ceilings,
    guest_mix,
    ladies_multiplier=1.0,
    big_eaters=False,
    big_eaters_percentage=20.0,
):
    """
    Validate user-supplied grams-per-person against pool ceilings,
    category constraints, and global caps.

    Args:
        user_portions: dict[int, float] — dish_id -> grams_per_person
        dishes: list[DishInput]
        constraints: ResolvedConstraints
        pool_ceilings: dict[str, float] — e.g. {'protein': 590, 'accompaniment': 150}
        guest_mix: GuestMix
        ladies_multiplier: float — portion multiplier for ladies
        big_eaters: bool
        big_eaters_percentage: float

    Returns:
        dict with keys: violations, user_portions_expanded, totals
    """
    violations = []
    dish_map = {d.id: d for d in dishes}

    # ── POOL CEILING CHECKS ──
    pool_totals = {}
    for dish in dishes:
        pool = dish.pool
        if pool == 'service':
            continue
        pool_totals.setdefault(pool, 0.0)
        pool_totals[pool] += user_portions.get(dish.id, 0.0)

    for pool_name, total in pool_totals.items():
        ceiling = pool_ceilings.get(pool_name)
        if ceiling is not None and total > ceiling:
            violations.append({
                'type': 'pool_ceiling',
                'severity': 'error',
                'message': (
                    f"{pool_name.title()} pool total is {total:.0f}g per person, "
                    f"exceeds ceiling of {ceiling:.0f}g"
                ),
                'pool': pool_name,
                'total': round(total, 1),
                'ceiling': ceiling,
            })

    # ── CATEGORY CONSTRAINT CHECKS ──
    # Skip gram-based constraints for qty-unit categories (bread, tea, etc.)
    # — the global min_portion_per_dish_grams (e.g. 30g) doesn't apply to
    #   items measured in pieces.  Category-specific overrides set in the DB
    #   are assumed to be in the correct unit already.
    by_category = {}
    for dish in dishes:
        by_category.setdefault(dish.category_id, []).append(dish)

    for cat_id, cat_dishes in by_category.items():
        cat_name = cat_dishes[0].category_name
        is_qty = cat_dishes[0].unit == 'qty'

        # Per-dish minimum — only apply if the category has an explicit
        # override (which is assumed unit-appropriate) or the dish uses
        # gram-based units so the global floor is meaningful.
        has_cat_min_override = cat_id in constraints.category_min_portions
        if is_qty and not has_cat_min_override:
            cat_min = None  # skip global gram floor for qty items
        else:
            cat_min = constraints.category_min_portions.get(
                cat_id, constraints.min_portion_per_dish_grams
            )

        if cat_min is not None:
            unit_label = 'pcs' if is_qty else 'g'
            for dish in cat_dishes:
                user_g = user_portions.get(dish.id, 0.0)
                if user_g < cat_min:
                    violations.append({
                        'type': 'below_minimum',
                        'severity': 'warning',
                        'message': (
                            f"{dish.name} is {user_g:.0f}{unit_label}, below minimum "
                            f"of {cat_min:.0f}{unit_label} for {cat_name}"
                        ),
                        'dish_id': dish.id,
                        'dish_name': dish.name,
                        'user_grams': round(user_g, 1),
                        'minimum': cat_min,
                    })

        # Per-dish maximum — only check if explicitly set for this category
        max_portion = constraints.category_max_portions.get(cat_id)
        if max_portion is not None:
            unit_label = 'pcs' if is_qty else 'g'
            for dish in cat_dishes:
                user_g = user_portions.get(dish.id, 0.0)
                if user_g > max_portion:
                    violations.append({
                        'type': 'above_maximum',
                        'severity': 'error',
                        'message': (
                            f"{dish.name} is {user_g:.0f}{unit_label}, exceeds max "
                            f"of {max_portion:.0f}{unit_label} for {cat_name}"
                        ),
                        'dish_id': dish.id,
                        'dish_name': dish.name,
                        'user_grams': round(user_g, 1),
                        'maximum': max_portion,
                    })

        # Category total cap — only check if explicitly set
        max_total = constraints.category_max_totals.get(cat_id)
        if max_total is not None:
            unit_label = 'pcs' if is_qty else 'g'
            cat_total = sum(user_portions.get(d.id, 0.0) for d in cat_dishes)
            if cat_total > max_total:
                violations.append({
                    'type': 'category_total',
                    'severity': 'error',
                    'message': (
                        f"{cat_name} total is {cat_total:.0f}{unit_label}, "
                        f"exceeds limit of {max_total:.0f}{unit_label}"
                    ),
                    'category': cat_name,
                    'total': round(cat_total, 1),
                    'limit': max_total,
                })

    # ── GLOBAL CONSTRAINT CHECKS (weight-based dishes only) ──
    non_service_total = sum(
        user_portions.get(d.id, 0.0)
        for d in dishes if d.pool != 'service' and d.unit != 'qty'
    )
    max_food = constraints.max_total_food_per_person_grams
    if non_service_total > max_food:
        violations.append({
            'type': 'max_total_food',
            'severity': 'error',
            'message': (
                f"Total food is {non_service_total:.0f}g per person, "
                f"exceeds cap of {max_food:.0f}g"
            ),
            'total': round(non_service_total, 1),
            'cap': max_food,
        })

    # ── EXPAND THROUGH GUEST MIX ──
    big_eaters_mult = 1.0 + (big_eaters_percentage / 100.0) if big_eaters else 1.0
    total_people = guest_mix.total

    expanded = []
    total_food_weight = 0.0
    total_food_per_gent = 0.0
    total_food_per_lady = 0.0

    for dish in dishes:
        base_grams = user_portions.get(dish.id, 0.0)
        grams_gent = round(base_grams * big_eaters_mult, 1)
        grams_lady = round(grams_gent * ladies_multiplier, 1)
        dish_total = grams_gent * guest_mix.gents + grams_lady * guest_mix.ladies
        grams_per_person = round(dish_total / total_people, 1) if total_people else 0

        expanded.append({
            'dish_id': dish.id,
            'dish_name': dish.name,
            'category': dish.category_name,
            'pool': dish.pool,
            'unit': dish.unit,
            'grams_per_person': grams_per_person,
            'grams_per_gent': grams_gent,
            'grams_per_lady': grams_lady,
            'total_grams': round(dish_total, 1),
        })

        total_food_per_gent += grams_gent
        total_food_per_lady += grams_lady
        total_food_weight += dish_total

    food_per_person = round(total_food_weight / total_people, 1) if total_people else 0

    totals = {
        'food_per_gent_grams': round(total_food_per_gent, 1),
        'food_per_lady_grams': round(total_food_per_lady, 1),
        'food_per_person_grams': food_per_person,
        'total_food_weight_grams': round(total_food_weight, 1),
    }

    return {
        'violations': violations,
        'user_portions_expanded': expanded,
        'totals': totals,
    }
