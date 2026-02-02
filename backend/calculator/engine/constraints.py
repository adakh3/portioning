"""Global safety caps — last-resort enforcement after pool allocation."""


def enforce_category_constraints(portions, dishes, constraints):
    """
    Enforce per-category constraints (min portion, max portion, max total).
    Applies to ALL dishes including service pool.

    Returns:
        (updated portions, adjustments list)
    """
    adjustments = []
    by_category = {}
    for dish in dishes:
        by_category.setdefault(dish.category_id, []).append(dish)

    # Per-category max portion: cap individual dishes
    for cat_id, cat_dishes in by_category.items():
        max_portion = constraints.category_max_portions.get(cat_id)
        if max_portion is not None:
            for dish in cat_dishes:
                if portions[dish.id] > max_portion:
                    portions[dish.id] = max_portion
                    adjustments.append(
                        f"{dish.name} capped at {max_portion:.0f}g (max per dish for {dish.category_name})"
                    )

    # Per-category total cap: scale all dishes in category down
    for cat_id, cat_dishes in by_category.items():
        max_total = constraints.category_max_totals.get(cat_id)
        if max_total is not None:
            cat_total = sum(portions[d.id] for d in cat_dishes)
            if cat_total > max_total:
                # Scale down, but respect category min portions
                cat_min = constraints.category_min_portions.get(cat_id, 0)
                n = len(cat_dishes)
                floor_total = n * cat_min

                if floor_total >= max_total:
                    # Can't fit all dishes above their floor — give each the floor
                    for dish in cat_dishes:
                        portions[dish.id] = cat_min
                else:
                    scale = max_total / cat_total
                    for dish in cat_dishes:
                        new_val = portions[dish.id] * scale
                        portions[dish.id] = max(new_val, cat_min)

                cat_name = cat_dishes[0].category_name
                adjustments.append(
                    f"{cat_name} total reduced from {cat_total:.0f}g to {max_total:.0f}g (category limit)"
                )

    return portions, adjustments


def enforce_global_constraints(portions, dishes, constraints):
    """
    Enforce global hard caps as safety nets (food cap).
    Should only be called for non-service dishes.

    Returns:
        (updated portions, warnings list, adjustments list)
    """
    warnings = []
    adjustments = []

    # A. Global max food cap
    total_food = sum(portions.values())
    max_food = constraints.max_total_food_per_person_grams
    if total_food > max_food:
        scale = max_food / total_food
        for dish_id in portions:
            portions[dish_id] *= scale
        warnings.append(
            f"Total food was {total_food:.0f}g per person — reduced to {max_food:.0f}g limit"
        )
        adjustments.append(f"Total food exceeded {max_food:.0f}g limit — all portions scaled down")

    # B. Post-cap floor re-check
    min_portion = constraints.min_portion_per_dish_grams
    for dish in dishes:
        cat_min = constraints.category_min_portions.get(dish.category_id, min_portion)
        if portions[dish.id] < cat_min:
            warnings.append(
                f"Cannot satisfy both minimum portion ({cat_min:.0f}g) and caps "
                f"for '{dish.name}' ({portions[dish.id]:.0f}g). Consider removing a dish."
            )

    return portions, warnings, adjustments
