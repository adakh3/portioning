"""Pipeline orchestrator: pool-based calculation with baselines, ceilings, and popularity split."""
from decimal import Decimal

from .models import DishInput, GuestMix, ResolvedConstraints
from .baseline import establish_category_budgets, apply_pool_ceiling, split_by_popularity
from .constraints import enforce_category_constraints, enforce_global_constraints


def _load_dishes(dish_ids):
    """Load DishInput objects from DB."""
    from dishes.models import Dish
    qs = Dish.objects.filter(id__in=dish_ids, is_active=True).select_related('category')
    return [
        DishInput(
            id=d.id,
            name=d.name,
            category_id=d.category_id,
            category_name=d.category.display_name,
            protein_type=d.protein_type,
            default_portion_grams=d.default_portion_grams,
            popularity=d.popularity,
            cost_per_gram=float(d.cost_per_gram),
            is_vegetarian=d.is_vegetarian,
            protein_is_additive=d.category.protein_is_additive,
            pool=d.category.pool,
            unit=d.category.unit,
            baseline_budget_grams=d.category.baseline_budget_grams,
            min_per_dish_grams=d.category.min_per_dish_grams,
            fixed_portion_grams=d.category.fixed_portion_grams,
        )
        for d in qs
    ]


def _select_budget_profile(present_category_ids):
    """Find the best matching BudgetProfile for the given categories."""
    from rules.models import BudgetProfile

    present = set(present_category_ids)
    best_profile = None
    best_score = -1

    for profile in BudgetProfile.objects.prefetch_related('categories'):
        profile_cats = set(profile.categories.values_list('id', flat=True))

        if profile_cats == present:
            return profile

        intersection = len(present & profile_cats)
        union = len(present | profile_cats)
        score = intersection / union if union > 0 else 0

        if score > best_score:
            best_score = score
            best_profile = profile

    if best_score < 0.5:
        default = BudgetProfile.objects.filter(is_default=True).first()
        if default:
            return default

    return best_profile


def _load_pool_baselines(pool):
    """Load baseline_budget_grams for all categories in a given pool.

    Returns:
        dict[category_id -> baseline_budget_grams]
    """
    from dishes.models import DishCategory
    return dict(
        DishCategory.objects.filter(pool=pool)
        .values_list('id', 'baseline_budget_grams')
    )


def _load_config_and_ceilings(dish_category_ids):
    """Load GlobalConfig, select profile, compute effective pool ceilings."""
    from rules.models import GlobalConfig, GuestProfile, CombinationRule

    config = GlobalConfig.load()
    profile = _select_budget_profile(dish_category_ids)

    protein_ceiling = config.protein_pool_ceiling_grams
    accompaniment_ceiling = config.accompaniment_pool_ceiling_grams
    dessert_ceiling = config.dessert_pool_ceiling_grams
    profile_adjustments = []

    if profile:
        if profile.protein_pool_ceiling_grams is not None:
            default_ceil = config.protein_pool_ceiling_grams
            protein_ceiling = profile.protein_pool_ceiling_grams
            if protein_ceiling != default_ceil:
                from dishes.models import DishCategory
                pool_cats = list(
                    DishCategory.objects.filter(pool='protein')
                    .order_by('display_order')
                    .values_list('display_name', flat=True)
                )
                cat_label = ' + '.join(pool_cats)
                if protein_ceiling > default_ceil:
                    profile_adjustments.append(
                        f"Large menu — combined {cat_label} limit raised from "
                        f"{default_ceil:.0f}g to {protein_ceiling:.0f}g per person"
                    )
                else:
                    profile_adjustments.append(
                        f"Combined {cat_label} limit lowered from "
                        f"{default_ceil:.0f}g to {protein_ceiling:.0f}g per person"
                    )
        if profile.accompaniment_pool_ceiling_grams is not None:
            accompaniment_ceiling = profile.accompaniment_pool_ceiling_grams
        if profile.dessert_pool_ceiling_grams is not None:
            dessert_ceiling = profile.dessert_pool_ceiling_grams

    guest_profiles = {gp.name: gp.portion_multiplier for gp in GuestProfile.objects.all()}
    combo_rules = []
    for rule in CombinationRule.objects.filter(is_active=True).prefetch_related('categories'):
        cat_ids = set(rule.categories.values_list('id', flat=True))
        combo_rules.append((cat_ids, rule.reduction_factor, rule.description))

    return config, protein_ceiling, accompaniment_ceiling, dessert_ceiling, profile_adjustments, guest_profiles, combo_rules


def _resolve_constraints(overrides=None):
    """Build ResolvedConstraints from DB + optional event overrides."""
    from rules.models import GlobalConstraint, CategoryConstraint
    gc = GlobalConstraint.load()

    resolved = ResolvedConstraints(
        max_total_food_per_person_grams=gc.max_total_food_per_person_grams,
        min_portion_per_dish_grams=gc.min_portion_per_dish_grams,
    )

    for cc in CategoryConstraint.objects.all():
        if cc.min_portion_grams is not None:
            resolved.category_min_portions[cc.category_id] = cc.min_portion_grams
        if cc.max_portion_grams is not None:
            resolved.category_max_portions[cc.category_id] = cc.max_portion_grams
        if cc.max_total_category_grams is not None:
            resolved.category_max_totals[cc.category_id] = cc.max_total_category_grams

    if overrides:
        if 'max_total_food_per_person_grams' in overrides:
            resolved.max_total_food_per_person_grams = overrides['max_total_food_per_person_grams']
        if 'min_portion_per_dish_grams' in overrides:
            resolved.min_portion_per_dish_grams = overrides['min_portion_per_dish_grams']

    return resolved


def calculate_portions(dish_ids, guests, constraint_overrides=None,
                       big_eaters=False, big_eaters_percentage=20.0):
    """
    Main entry point: run the pool-based portioning pipeline.

    Pipeline:
      1. Separate dishes into protein, dessert, service pools
      2. Protein pool: establish baselines -> apply ceiling -> split by popularity
      3. Dessert pool: same as protein but with dessert ceiling
      4. Service pool: fixed per-person amounts
      5. Category constraints (all dishes including service)
      6. Global safety caps (non-service only)
      7. Guest mix expansion
    """
    dishes = _load_dishes(dish_ids)
    if not dishes:
        return {
            'portions': [],
            'totals': {'food_per_gent_grams': 0, 'food_per_lady_grams': 0,
                       'food_per_person_grams': 0, 'protein_per_person_grams': 0,
                       'total_food_weight_grams': 0, 'total_cost': 0},
            'warnings': ['No active dishes found for the given IDs.'],
            'adjustments_applied': [],
        }

    dish_category_ids = list(set(d.category_id for d in dishes))
    config, protein_ceiling, accompaniment_ceiling, dessert_ceiling, profile_adjustments, guest_profiles, combo_rules = \
        _load_config_and_ceilings(dish_category_ids)
    constraints = _resolve_constraints(constraint_overrides)
    guest_mix = GuestMix(**guests)

    all_adjustments = list(profile_adjustments)

    # Separate dishes by pool
    protein_dishes = [d for d in dishes if d.pool == 'protein']
    accompaniment_dishes = [d for d in dishes if d.pool == 'accompaniment']
    dessert_dishes = [d for d in dishes if d.pool == 'dessert']
    service_dishes = [d for d in dishes if d.pool == 'service']

    portions = {}

    # ── Check for recommended categories ──
    menu_warnings = []
    present_category_names = set(d.category_name.lower() for d in dishes)
    if not any('curry' in name for name in present_category_names):
        menu_warnings.append("Menu has no curry — at least one curry dish is recommended.")
    if not any('rice' in name for name in present_category_names):
        menu_warnings.append("Menu has no rice — at least one rice dish is recommended.")

    # ── PROTEIN POOL ──
    protein_scale = 1.0
    if protein_dishes:
        protein_pool_baselines = _load_pool_baselines('protein')
        cat_budgets, adj = establish_category_budgets(
            protein_dishes, protein_pool_baselines,
            growth_rate=config.dish_growth_rate,
            redistribution_fraction=config.absent_redistribution_fraction,
        )
        all_adjustments.extend(adj)

        cat_budgets, protein_scale, adj = apply_pool_ceiling(cat_budgets, protein_ceiling, protein_dishes)
        all_adjustments.extend(adj)

        pop_strength = config.popularity_strength if config.popularity_enabled else 0.0
        protein_portions, adj = split_by_popularity(
            protein_dishes, cat_budgets, pop_strength, protein_scale
        )
        all_adjustments.extend(adj)
        portions.update(protein_portions)

    # ── ACCOMPANIMENT POOL ──
    if accompaniment_dishes:
        accompaniment_pool_baselines = _load_pool_baselines('accompaniment')
        cat_budgets, adj = establish_category_budgets(
            accompaniment_dishes, accompaniment_pool_baselines,
            growth_rate=config.dish_growth_rate,
            redistribution_fraction=config.absent_redistribution_fraction,
        )
        all_adjustments.extend(adj)

        cat_budgets, accompaniment_scale, adj = apply_pool_ceiling(cat_budgets, accompaniment_ceiling, accompaniment_dishes)
        all_adjustments.extend(adj)

        pop_strength = config.popularity_strength if config.popularity_enabled else 0.0
        accompaniment_portions, adj = split_by_popularity(
            accompaniment_dishes, cat_budgets, pop_strength, accompaniment_scale
        )
        all_adjustments.extend(adj)
        portions.update(accompaniment_portions)

    # ── DESSERT POOL ──
    if dessert_dishes:
        dessert_pool_baselines = _load_pool_baselines('dessert')
        cat_budgets, adj = establish_category_budgets(
            dessert_dishes, dessert_pool_baselines,
            growth_rate=config.dish_growth_rate,
            redistribution_fraction=config.absent_redistribution_fraction,
        )
        all_adjustments.extend(adj)

        cat_budgets, dessert_scale, adj = apply_pool_ceiling(cat_budgets, dessert_ceiling, dessert_dishes)
        all_adjustments.extend(adj)

        pop_strength = config.popularity_strength if config.popularity_enabled else 0.0
        dessert_portions, adj = split_by_popularity(
            dessert_dishes, cat_budgets, pop_strength, dessert_scale
        )
        all_adjustments.extend(adj)
        portions.update(dessert_portions)

    # ── SERVICE POOL ──
    if service_dishes:
        for dish in service_dishes:
            fixed = dish.fixed_portion_grams
            if fixed is not None:
                portions[dish.id] = fixed
            else:
                portions[dish.id] = dish.default_portion_grams

    # ── CATEGORY CONSTRAINTS (all dishes including service) ──
    portions, adj = enforce_category_constraints(portions, dishes, constraints)
    all_adjustments.extend(adj)

    # ── GLOBAL SAFETY CAPS (non-service only) ──
    non_service_dishes = [d for d in dishes if d.pool != 'service']
    if non_service_dishes:
        non_service_portions = {d.id: portions[d.id] for d in non_service_dishes}
        non_service_portions, warnings, adj = enforce_global_constraints(
            non_service_portions, non_service_dishes, constraints
        )
        portions.update(non_service_portions)
        all_adjustments.extend(adj)
    else:
        warnings = []

    warnings = menu_warnings + warnings

    # ── GUEST MIX EXPANSION ──
    ladies_mult = guest_profiles.get('ladies', 1.0)
    big_eaters_mult = 1.0 + (big_eaters_percentage / 100.0) if big_eaters else 1.0

    if big_eaters:
        all_adjustments.append(
            f"Big eaters: all portions increased by {big_eaters_percentage:.0f}%"
        )

    results = []
    total_food_weight = 0.0
    total_cost = Decimal('0')
    total_food_per_gent = 0.0
    total_food_per_lady = 0.0
    total_protein_per_person = 0.0

    for dish in dishes:
        grams_gent = round(portions[dish.id] * big_eaters_mult, 1)
        grams_lady = round(grams_gent * ladies_mult, 1)

        dish_total = (
            grams_gent * guest_mix.gents
            + grams_lady * guest_mix.ladies
        )
        total_people = guest_mix.gents + guest_mix.ladies
        grams_per_person = round(dish_total / total_people, 1) if total_people else 0
        cost_gent = round(grams_gent * dish.cost_per_gram, 2)
        dish_total_cost = round(dish_total * dish.cost_per_gram, 2)

        results.append({
            'dish_id': dish.id,
            'dish_name': dish.name,
            'category': dish.category_name,
            'protein_type': dish.protein_type,
            'pool': dish.pool,
            'unit': dish.unit,
            'grams_per_person': grams_per_person,
            'grams_per_gent': grams_gent,
            'grams_per_lady': grams_lady,
            'total_grams': round(dish_total, 1),
            'cost_per_gent': cost_gent,
            'total_cost': dish_total_cost,
        })

        total_food_per_gent += grams_gent
        total_food_per_lady += grams_lady
        total_food_weight += dish_total
        total_cost += Decimal(str(dish_total_cost))
        if dish.pool == 'protein':
            total_protein_per_person += dish_total

    total_people = guest_mix.gents + guest_mix.ladies
    food_per_person = round(total_food_weight / total_people, 1) if total_people else 0
    protein_per_person = round(total_protein_per_person / total_people, 1) if total_people else 0

    return {
        'portions': results,
        'totals': {
            'food_per_gent_grams': round(total_food_per_gent, 1),
            'food_per_lady_grams': round(total_food_per_lady, 1),
            'food_per_person_grams': food_per_person,
            'protein_per_person_grams': protein_per_person,
            'total_food_weight_grams': round(total_food_weight, 1),
            'total_cost': float(total_cost),
        },
        'warnings': warnings,
        'adjustments_applied': all_adjustments,
    }
