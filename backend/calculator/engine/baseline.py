"""Pool-based baseline allocation: category budgets, pool ceilings, popularity split."""


def establish_category_budgets(dishes, pool_baselines=None,
                               growth_rate=0.0, redistribution_fraction=1.0):
    """
    Step 1: For each present category in the protein/dessert pool,
    compute budget using growth model:
        grown_budget = baseline × (1 + growth_rate × (n - 1))
        budget = max(grown_budget, n × min_per_dish)

    Then redistribute absent-category budget (scaled by redistribution_fraction)
    proportionally to present categories.

    Args:
        dishes: list of DishInput (only protein/dessert pool dishes)
        pool_baselines: dict[category_id -> baseline_grams] for ALL categories in
                        the same pool (present + absent). If None, no redistribution.
        growth_rate: fraction of baseline added per extra dish (default 0.0 for backward compat)
        redistribution_fraction: fraction of absent budget that redistributes (0-1, default 1.0)

    Returns:
        dict[category_id -> budget_grams], list[str] adjustments
    """
    adjustments = []
    by_category = {}
    for dish in dishes:
        by_category.setdefault(dish.category_id, []).append(dish)

    category_budgets = {}
    for cat_id, cat_dishes in by_category.items():
        ref = cat_dishes[0]
        baseline = ref.baseline_budget_grams
        n = len(cat_dishes)
        min_total = n * ref.min_per_dish_grams
        grown_budget = baseline * (1 + growth_rate * (n - 1))
        budget = max(grown_budget, min_total)

        category_budgets[cat_id] = budget
        cat_name = ref.category_name

        if min_total > grown_budget:
            adjustments.append(
                f"{cat_name} budget increased: {n} dishes need at least "
                f"{ref.min_per_dish_grams:.0f}g each, so budget grew from "
                f"{grown_budget:.0f}g to {min_total:.0f}g"
            )
        elif n > 1 and growth_rate > 0:
            adjustments.append(
                f"{cat_name} budget grew: {n} dishes expanded baseline from "
                f"{baseline:.0f}g to {grown_budget:.0f}g"
            )

    # Redistribute absent-category budget proportionally
    if pool_baselines:
        present_ids = set(category_budgets.keys())
        absent_budget_raw = sum(
            baseline for cat_id, baseline in pool_baselines.items()
            if cat_id not in present_ids
        )
        absent_budget = absent_budget_raw * redistribution_fraction
        if absent_budget > 0:
            sum_present = sum(category_budgets.values())
            if sum_present > 0:
                for cat_id in list(category_budgets.keys()):
                    share = absent_budget * (category_budgets[cat_id] / sum_present)
                    category_budgets[cat_id] += share
                # Build absent category names for the message
                from dishes.models import DishCategory
                absent_cats = DishCategory.objects.filter(
                    id__in=[cid for cid in pool_baselines if cid not in present_ids]
                ).values_list('display_name', flat=True)
                absent_names = ', '.join(absent_cats) or 'other categories'
                pct = round(redistribution_fraction * 100)
                adjustments.append(
                    f"No {absent_names} on menu — {pct}% of their {absent_budget_raw:.0f}g budget "
                    f"({absent_budget:.0f}g) was spread across the categories that are present"
                )

    return category_budgets, adjustments


def apply_pool_ceiling(category_budgets, ceiling, dishes):
    """
    Step 2: If total of all category budgets exceeds the pool ceiling,
    proportionally reduce all budgets and min_per_dish values.

    Args:
        category_budgets: dict[category_id -> budget_grams]
        ceiling: float, pool ceiling in grams
        dishes: list of DishInput (for reading/adjusting min_per_dish)

    Returns:
        dict[category_id -> reduced_budget], float scale_factor, list[str] adjustments
    """
    pool_total = sum(category_budgets.values())
    if pool_total <= ceiling:
        return category_budgets, 1.0, []

    scale = ceiling / pool_total
    reduced = {cat_id: budget * scale for cat_id, budget in category_budgets.items()}

    # Build category name map for reporting
    by_category = {}
    for dish in dishes:
        by_category.setdefault(dish.category_id, []).append(dish)

    detail_parts = []
    for cat_id, budget in category_budgets.items():
        cat_dishes = by_category.get(cat_id, [])
        cat_name = cat_dishes[0].category_name if cat_dishes else f"cat_{cat_id}"
        detail_parts.append(f"{cat_name} {budget:.0f}g → {reduced[cat_id]:.0f}g")

    reduction_pct = round((1 - scale) * 100)
    adjustments = [
        f"Total exceeded {ceiling:.0f}g limit — all portions reduced by "
        f"{reduction_pct}% ({', '.join(detail_parts)})"
    ]

    return reduced, scale, adjustments


def split_by_popularity(dishes, category_budgets, popularity_strength, scale_factor=1.0):
    """
    Step 3: Within each category, split the budget among dishes by popularity.
    Every dish gets at least min_per_dish (possibly scaled by scale_factor).

    Args:
        dishes: list of DishInput
        category_budgets: dict[category_id -> budget_grams]
        popularity_strength: float 0-1
        scale_factor: float, from ceiling enforcement (reduces min_per_dish)

    Returns:
        dict[dish_id -> grams], list[str] adjustments
    """
    portions = {}
    adjustments = []
    by_category = {}
    for dish in dishes:
        by_category.setdefault(dish.category_id, []).append(dish)

    # Popularity split is routine — no adjustment message needed

    for cat_id, cat_dishes in by_category.items():
        budget = category_budgets.get(cat_id, 0)
        n = len(cat_dishes)
        if n == 0:
            continue

        # Effective min_per_dish after ceiling scaling
        effective_min = cat_dishes[0].min_per_dish_grams * scale_factor

        if popularity_strength <= 0 or n == 1:
            # Equal split
            share = budget / n
            for dish in cat_dishes:
                portions[dish.id] = max(share, effective_min)
        else:
            # Popularity-weighted split
            total_popularity = sum(d.popularity for d in cat_dishes)
            equal_share = budget / n

            for dish in cat_dishes:
                if total_popularity > 0:
                    raw_share = budget * (dish.popularity / total_popularity)
                else:
                    raw_share = equal_share
                portion = equal_share * (1 - popularity_strength) + raw_share * popularity_strength
                portions[dish.id] = portion

            # Enforce floor, re-normalize
            floored_ids = set()
            floored_total = 0.0
            for dish in cat_dishes:
                if portions[dish.id] < effective_min:
                    portions[dish.id] = effective_min
                    floored_ids.add(dish.id)
                    floored_total += effective_min

            non_floored = [d for d in cat_dishes if d.id not in floored_ids]
            if non_floored and floored_ids:
                remaining_budget = budget - floored_total
                if remaining_budget > 0:
                    non_floored_total = sum(portions[d.id] for d in non_floored)
                    if non_floored_total > 0:
                        rescale = remaining_budget / non_floored_total
                        for dish in non_floored:
                            portions[dish.id] *= rescale

    return portions, adjustments
