# Pricing Logic

## Overview

There are two pricing paths depending on whether a menu is based on a template or built from scratch:

1. **Template-based menus** — anchored to tier pricing with per-dish surcharges for modifications
2. **Custom menus** (no template) — priced by the portioning engine using dish selling prices

---

## Template-Based Pricing (Surcharge Model)

### Tier Prices

Each template menu has **price tiers** — a fixed per-head price based on guest count thresholds. These are set manually and represent the anchor price for the standard, unmodified menu.

Example (Majestic Celebration Banquet):
- 50+ pax: PKR 3,250/head
- 100+ pax: PKR 3,000/head
- 150+ pax: PKR 2,750/head

The highest tier where `min_guests <= guest_count` is selected. These are configured in Django admin under Menu Template Price Tiers.

### Per-Dish Surcharges

When a customer modifies a template menu (adds or removes dishes), the price adjusts via **per-dish surcharges** rather than re-running the portioning engine. This prices variety, not weight — adding a dish means more variety for guests, which has real cost, even though the engine's portion ceilings mean total food weight barely changes.

**Formula:**
```
adjusted_price = tier_price + sum(surcharges for added dishes) - sum(discounts for removed dishes)
```

**How surcharges are calculated per dish:**
```
addition_surcharge = category.baseline_budget_grams × dish.selling_price_per_gram
removal_discount   = addition_surcharge / 2
```

- `baseline_budget_grams` = the standard incremental portion for one dish in that category, calibrated from the Majestic Celebration Banquet template (e.g. Curry = 95g, Dry/BBQ = 165g)
- `selling_price_per_gram` = auto-calculated from `cost_per_gram / target_food_cost_percentage`
- The removal discount is half the addition surcharge — removing a dish saves ingredients but kitchen/staff overhead doesn't decrease proportionally

This means expensive proteins (mutton, lamb) naturally have higher surcharges than cheaper ones (chicken, veg).

### Override Hierarchy

1. **Auto-calculated** (default) — surcharges computed on every dish save from cost data
2. **Manual override** — set `surcharge_override = True` on a dish to lock in custom values
3. **Category fallback** — if a dish has 0 surcharge (e.g. no selling price data), falls back to the category-level `addition_surcharge` / `removal_discount` defaults

### Swaps

Swapping a dish (removing one, adding another in the same category) naturally produces the correct net price — the removal discount of the old dish plus the addition surcharge of the new dish. If both dishes have similar costs, the net is close to zero.

### Extra Food Percentage

A transient UI input that scales the final price by a percentage. If the customer wants 10% extra food, the displayed price increases by 10%. This is not persisted — it's a calculator tool for the salesperson.

```
final_price = adjusted_price × (1 + extra_food_percent / 100)
```

### Price Rounding

The final price is rounded to the nearest step configured in Site Settings (`price_rounding_step`). For example, with a step of 50, a price of 2,823 rounds to 2,850.

---

## Custom Menu Pricing (Engine-Based)

For menus built from scratch (no template), there's no tier price to anchor to. Instead, the price is computed by the portioning engine:

1. Run the engine to get per-person portions for each dish
2. Multiply each dish's portion by its `selling_price_per_gram`
3. Sum for total price per head

This is handled by `PriceEstimateView` and remains unchanged by the surcharge model.

---

## Selling Price Per Gram

Each dish has a `selling_price_per_gram` that drives both surcharge calculation and engine-based pricing:

```
selling_price_per_gram = cost_per_gram / (target_food_cost_percentage / 100)
```

- `cost_per_gram` — raw ingredient cost from the Item Wise Cost spreadsheet
- `target_food_cost_percentage` — site-wide setting (e.g. 30% means food cost should be 30% of selling price)
- Auto-calculated on every dish save unless `selling_price_override = True`

For quantity-based items (bread, tea), `cost_per_gram` stores cost-per-unit and `selling_price_per_gram` stores selling-price-per-unit.

---

## Where Things Are Configured

| Setting | Location | Example |
|---------|----------|---------|
| Tier prices per menu | Django admin → Menu Template Price Tiers | 150+ pax = PKR 2,750 |
| Dish cost data | Django admin → Dishes (or `update_dish_costs` command) | Mutton Qorma: 2.558/g |
| Target food cost % | Django admin → Site Settings | 30% |
| Price rounding step | Django admin → Site Settings | 50 |
| Category baselines | Django admin → Dish Categories | Curry: 95g |
| Category fallback surcharges | Django admin → Dish Categories | Curry: +75 / -25 |
| Per-dish surcharges | Django admin → Dishes (auto or override) | Mutton Qorma: +810 / -405 |
| Bulk recalculate | Django admin → Dishes → select all → "Recalculate surcharges" action | — |

---

## Worked Example

**Template:** Majestic Celebration Banquet at 150+ pax tier = PKR 2,750/head

**Modification:** Add Mutton Shahi Qorma, remove Chicken Tandoori Boti

**Surcharges (auto-calculated):**
- Mutton Shahi Qorma: selling_price = 8.67/g, baseline = 95g → addition_surcharge = PKR 823
- Chicken Tandoori Boti: selling_price = 2.70/g, baseline = 165g → removal_discount = PKR 223

**Calculation:**
```
Tier price:                     2,750
+ Mutton Shahi Qorma added:     +823
- Chicken Tandoori Boti removed: -223
────────────────────────────────
Raw adjusted:                   3,350
Rounded (step 50):              3,350
```

With 10% extra food: 3,350 × 1.10 = PKR 3,685 → rounded to PKR 3,700
