# Portioning Calculator — Logic & Rules

## Context

This system calculates **per-person food portions for catering buffets** — typically Pakistani/South Asian wedding and event menus serving 50–500+ guests. The caterer selects dishes for a menu, specifies the guest count and male/female split, and the system outputs how many grams (or pieces) of each dish to prepare per person.

The goal is to produce realistic, balanced portions that match what experienced caterers actually serve — not too much food (waste), not too little (guests go hungry).

All defaults are calibrated from real catering data. The baseline reference is **Golden Elegance Feast** (single-dish-per-category calibration from real kitchen weights). Multi-dish menus were previously used for calibration (Majestic Celebration Banquet), but single-dish baselines are more composable — absent categories redistribute their budget automatically.

---

## The Four-Pool System

Every dish category belongs to exactly one of four independent pools. Each pool has its own allocation logic. Pools do not interact — no cross-pool redistribution.

### Pool 1: Protein (the main courses)

Categories: **Curry (meat only), Dry/Barbecue (BBQ), Rice (all — meat and veg)**

This is where the core portioning logic lives. These categories compete for a shared budget. The more dish categories you add, the more the total grows — up to a hard ceiling.

Rice stays in the protein pool regardless of whether it's meat or veg rice — rice takes up the same stomach space either way.

### Pool 2: Accompaniment (veg accompaniments)

Categories: **Veg Curry, Sides**

Veg curries (Daal, Palak Paneer, Lobia, etc.) and sides (Bhagaray Baingan, Bhindi Fry, etc.) are accompaniments to the main courses, not protein mains. They have their own independent pool with its own ceiling. Redistribution works within the accompaniment pool — if only veg curry is present, it absorbs the absent sides budget and vice versa.

### Pool 3: Dessert

Categories: **Dessert**

Allocated independently from protein and accompaniment. Has its own baseline and ceiling. Multiple desserts split the budget among themselves.

### Pool 4: Service (fixed items)

Categories: **Salad, Condiment, Bread, Tea**

Fixed per-person amounts — no calculation needed. Every guest gets the same fixed portion regardless of how many other dishes are on the menu.

---

## Category Defaults

These are the current defaults, all configurable in the admin panel:

| Category | Pool | Unit | Baseline Budget | Min per Dish | Fixed Portion |
|----------|------|------|----------------|-------------|---------------|
| Curry (meat) | Protein | kg | 160g | 70g | — |
| Dry / Barbecue | Protein | kg | 180g | 100g | — |
| Rice (all) | Protein | kg | 100g | 70g | — |
| Veg Curry | Accompaniment | kg | 80g | 30g | — |
| Sides | Accompaniment | kg | 60g | 30g | — |
| Dessert | Dessert | kg | 80g | 40g | — |
| Salad | Service | kg | — | — | 50g |
| Condiment | Service | kg | — | — | 40g |
| Bread | Service | qty | — | — | 1 piece |
| Tea | Service | qty | — | — | 1 cup |

**Baseline Budget** = the standard total grams for this category when there's exactly 1 dish. Calibrated from single-dish real data (Golden Elegance Feast).

**Min per Dish** = the smallest viable portion for any single dish in this category. If you put a curry on the menu, it should be at least 70g — anything less and it's not worth including.

**Fixed Portion** = for service items only. Every guest gets exactly this much, regardless of menu composition.

---

## How the Protein Pool Works (Step by Step)

### Step 1: Establish Category Budgets

For each protein category present in the menu, calculate its budget using the **growth model**:

```
grown_budget = baseline × (1 + growth_rate × (number_of_dishes - 1))
category_budget = max(grown_budget, number_of_dishes × min_per_dish)
```

- **growth_rate** (default: 0.20) = each extra dish adds 20% of the baseline to the category budget. This is admin-configurable.
- The **min_per_dish floor** is kept as a safety net — if many dishes push the minimum total above the grown budget, the minimum wins.

**What this means in plain English:** The budget grows with each additional dish (rather than staying fixed at the baseline). Each extra dish adds a fraction of the baseline. But if you've added so many dishes that even the grown budget can't give each dish its minimum viable portion, the budget expands further to fit.

**Example — Curry category (baseline 160g, growth_rate 0.2):**
- 1 curry: 160 × (1 + 0) = **160g** → 160g each
- 2 curries: 160 × (1 + 0.2) = **192g** → 96g each
- 3 curries: 160 × (1 + 0.4) = **224g** → ~75g each
- 5 curries: grown = 160 × (1 + 0.8) = 288g, but min = 5 × 70 = **350g** (min floor wins)

**Example — BBQ category (baseline 180g, growth_rate 0.2):**
- 1 BBQ dish: 180 × (1 + 0) = **180g**
- 2 BBQ dishes: 180 × (1 + 0.2) = **216g** → 108g each
- 3 BBQ dishes: 180 × (1 + 0.4) = **252g** → 84g each

### Step 1b: Redistribute Absent-Category Budget

After computing present category budgets, the engine checks which categories in the pool are **absent** from the menu. The baselines of absent categories are summed, scaled by the **redistribution fraction**, and redistributed **proportionally** to the present categories.

```
absent_budget_raw = sum(baseline for each absent category in the pool)
redistributed = absent_budget_raw × redistribution_fraction

for each present category:
    budget += redistributed × (budget / sum_of_present_budgets)
```

- **redistribution_fraction** (default: 0.70) = 70% of the absent budget redistributes. This prevents over-inflation when many categories are absent. Admin-configurable.

**Why this exists:** A menu with just curry + rice should get more food per category than one with curry + rice + BBQ. The absent BBQ budget doesn't vanish — a portion of it flows into the categories that are actually present. The partial redistribution (70% by default) prevents a simple two-dish menu from getting nearly as much food as a full spread.

**Example — Curry + Rice only (no BBQ), redistribution_fraction=0.7:**
- Present: Curry = 160g, Rice = 100g (total present = 260g)
- Absent: BBQ = 180g → redistributed = 180 × 0.7 = 126g
- Curry: 160 + 126 × (160/260) = **238g**
- Rice: 100 + 126 × (100/260) = **148g**
- Pool total: **386g** (under 590g ceiling)

**Example — All 3 protein categories present (BBQ + Curry + Rice):**
- BBQ = 180, Curry = 160, Rice = 100 (total = 440g)
- No absent categories → no redistribution
- Pool total: **440g**

### Step 2: Check the Pool Ceiling

After computing all category budgets (including redistribution), add them up. If the total exceeds the **protein pool ceiling** (default: 590g per person), scale everything down proportionally.

```
pool_total = sum of all protein category budgets

if pool_total > ceiling:
    scale_factor = ceiling / pool_total
    every category budget = budget × scale_factor
    every min_per_dish = min_per_dish × scale_factor
```

**Why this exists:** Without a ceiling, a menu with many expanded categories could give a guest an unreasonable amount of protein food. The ceiling forces everything to scale down proportionally.

**Example — Over-allocated menu (growth_rate=0.2):**
- BBQ (3 dishes): grown = 180 × 1.4 = 252g, min = 300g → **300g**. Curry (2): 160 × 1.2 = **192g**. Rice: **100g**.
- After redistribution: no absent categories, total = 592g > 590g ceiling → slight compression.
- Scale = 590 / 592 ≈ 0.997 → barely noticeable.

**Example — Even more over-allocated:**
- BBQ (4 dishes): grown = 180 × 1.6 = 288g, min = 400g → **400g**. Curry (3): grown = 160 × 1.4 = 224g, min = 210g → **224g**. Rice: **100g**.
- Total = 724g > 590g ceiling
- Scale = 590 / 724 = 0.815
- BBQ: 400 × 0.815 = 326g, Curry: 224 × 0.815 = 183g, Rice: 100 × 0.815 = 82g
- **Protein total: 590g** (at ceiling)

### Step 3: Split Within Categories by Popularity

Each category's budget is now distributed among its individual dishes, weighted by a **popularity** score.

Each dish has a popularity value (default 1.0). The split blends equal distribution with popularity-weighted distribution:

```
equal_share = category_budget / number_of_dishes
popularity_share = category_budget × (dish_popularity / sum_of_all_popularities_in_category)
final_portion = equal_share × (1 - strength) + popularity_share × strength
```

**Popularity strength** (default: 0.3) controls how much popularity matters:
- Strength 0.0 = perfectly equal split, popularity ignored
- Strength 0.3 = 70% equal + 30% popularity-weighted (the default)
- Strength 1.0 = fully proportional to popularity

**Example — 2 BBQ dishes, budget 200g, strength 0.3:**
- Chicken Boti (popularity 1.5) and Seekh Kabab (popularity 1.0)
- Equal share: 200 / 2 = 100g each
- Popularity share: Boti = 200 × (1.5/2.5) = 120g, Seekh = 200 × (1.0/2.5) = 80g
- Final: Boti = 100 × 0.7 + 120 × 0.3 = **106g**, Seekh = 100 × 0.7 + 80 × 0.3 = **94g**

**Floor enforcement:** No dish can go below its effective minimum (min_per_dish, possibly reduced by the ceiling scale factor). If a very unpopular dish would get less than the minimum, it gets floored at the minimum and the remaining budget is redistributed among the other dishes.

---

## How the Accompaniment Pool Works

Same three-step process as protein, but with its own categories and ceiling:

1. **Establish budgets:** Veg Curry baseline = 80g (min 30g), Sides baseline = 60g (min 30g). Growth model applies per category.
2. **Redistribute absent budget:** If only veg curry is present, 70% of absent sides budget redistributes to veg curry. Vice versa.
3. **Check ceiling:** Accompaniment ceiling = 150g (veg curry 80 + sides 60 = 140g fits under ceiling)
4. **Split by popularity:** Same formula as protein

**Example — Veg curry only (no sides), redistribution_fraction=0.7:**
- Present: Veg Curry = 80g. Absent: Sides = 60g → redistributed = 60 × 0.7 = 42g.
- Veg Curry: 80 + 42 = **122g** (under 150g ceiling)

**Example — Both veg curry and sides:**
- Veg Curry = 80g, Sides = 60g. No absent categories.
- Total = 140g (under 150g ceiling, no compression)

**Example — 3 veg curries + 1 sides (growth_rate=0.2):**
- Veg Curry: grown = 80 × (1 + 0.4) = 112g, min = 90g → **112g**. Sides: 60g. Total = 172g > 150g ceiling → compression.
- Scale = 150 / 172 = 0.872. Veg Curry: 98g, Sides: 52g.

---

## How the Dessert Pool Works

Exactly the same three-step process as protein, but with its own numbers:

1. **Establish budget:** Dessert baseline = 80g, min per dish = 40g
2. **Redistribute absent budget:** Only one category in this pool, so no redistribution possible
3. **Check ceiling:** Dessert ceiling = 150g (so 1–3 desserts fit without compression; 4+ would compress)
4. **Split by popularity:** Same formula as protein

**Example — 1 dessert:**
- grown = 80 × (1 + 0) = 80g, budget = max(80, 40) = **80g**.

**Example — 2 desserts (growth_rate=0.2):**
- grown = 80 × (1 + 0.2) = 96g, min = 80g → budget = **96g**. Each gets 48g.

**Example — 4 desserts:**
- grown = 80 × (1 + 0.6) = 128g, min = 160g → budget = **160g** (min floor wins) > 150g ceiling
- Scale to 150g. Each gets ~37.5g.

---

## How the Service Pool Works

No calculation. Each dish gets its category's **fixed portion** per person.

| Item | Per Person |
|------|-----------|
| Salad (each) | 50g |
| Raita | 40g |
| Naan | 1 piece |
| Green Tea | 1 cup |

These amounts don't change regardless of menu size. However, category constraints can apply (see below).

---

## Menu Validation Warnings

The engine checks for recommended categories and emits warnings (not errors) if they're missing:

- **"Menu has no curry — at least one curry dish is recommended."**
- **"Menu has no rice — at least one rice dish is recommended."**

These don't block calculation — the engine still produces portions. They're informational nudges for the caterer.

---

## Constraints (Safety Rails)

### Category Constraints

Applied to ALL dishes including service items. Currently configured:

**Salad:**
- Min per dish: 30g (don't go below 30g per salad even under compression)
- Max total for category: 100g (even if you add 5 salads, total salad won't exceed 100g)

**How the salad cap works:**
- 1 salad: 50g (fixed portion, under 100g cap, fine)
- 2 salads: 50 + 50 = 100g (exactly at cap, fine)
- 3 salads: 50 + 50 + 50 = 150g > 100g cap. Scaled down to 100g total = ~33g each (above 30g min, fine)
- 4 salads: would need 4 × 30g = 120g > 100g cap. Each gets 30g = 120g total (can't honour both the cap and the floor — the floor wins to ensure each dish is viable)

### Global Safety Caps

Applied to non-service dishes only (protein + accompaniment + dessert), as a last-resort safety net:

1. **Max total food per person:** 1000g. If protein + accompaniment + dessert exceeds this, scale everything down.
2. **Max total protein (macronutrient) per person:** 120g. Internal safety check — if the menu is extremely meat-heavy, reduce the highest-protein dishes first. This is about actual dietary protein content (chicken is ~25% protein by weight), not food weight.
3. **Min portion per dish:** 30g. If any dish falls below 30g after all caps, emit a warning suggesting the caterer remove a dish.

These caps should rarely trigger in normal operation — the pool ceilings handle the main allocation. The global caps exist for edge cases (e.g., a menu with 15 meat dishes).

---

## Guest Mix

All portions above are calculated for an **adult male (gent)**. The system then adjusts:

- **Ladies:** Receive 100% of the gent portion by default (configurable via admin — GuestProfile multiplier)
- **Big eaters flag:** If enabled, all portions increase by a percentage (default +20%)

**Example — 100 guests, 50 gents / 50 ladies, curry at 271g per gent:**
- Per gent: 271g
- Per lady: 271 × 1.0 = 271g
- Total curry needed: (271 × 50) + (271 × 50) = 13,550 + 13,550 = 27,100g = **27.1 kg**

---

## Budget Profiles (Automatic Ceiling Adjustment)

The system automatically detects certain menu patterns and adjusts pool ceilings accordingly. This is invisible to the user — no profile names are shown. The user only sees the effect if a ceiling was changed.

Each profile is associated with a set of expected categories. The system compares the menu's categories against each profile using Jaccard similarity and picks the closest match. If no good match (< 50% similarity), it falls back to the default.

**Current profiles:**

| Profile (internal name) | Protein Ceiling | Matches When |
|------------------------|----------------|--------------|
| Standard (default) | 590g | Most menus |
| Grand | 700g | Menu has Curry + BBQ + Rice + Dessert |

A profile can also override the accompaniment and dessert ceilings.

**What the user sees:** If a non-default profile raises the protein ceiling, the adjustment reads:

> "Large menu — combined Curry + Dry / Barbecue + Rice limit raised from 590g to 700g per person"

If the default profile is used (no ceiling change), no message is shown.

---

## Combination Rules

Optional rules that apply a reduction when specific category combinations appear together. For example, if a menu has both curry AND BBQ, a combination rule could reduce all portions by 5% to prevent over-serving.

Currently no combination rules are active — the pool ceiling handles this naturally.

---

## What the User Sees: Adjustments & Warnings

The engine outputs two lists alongside the portions: **warnings** (red, important) and **adjustments** (blue, informational). Only meaningful changes are reported — routine operations (baseline used as-is, popularity split, service items) produce no messages.

### Adjustments (only shown when something changed)

| When | Example message |
|------|----------------|
| Category budget grew because many dishes need minimum portions | "Curry budget increased: 3 dishes need at least 70g each, so budget grew from 160g to 210g" |
| Absent category budget redistributed | "No Dry / Barbecue on menu — their 180g budget was spread across the categories that are present" |
| Pool ceiling compressed portions | "Total exceeded 590g limit — all portions reduced by 5% (Curry 160g → 152g, Dry / Barbecue 300g → 286g, Rice 100g → 95g)" |
| Non-default budget profile raised ceiling | "Large menu — combined Curry + Dry / Barbecue + Rice limit raised from 590g to 700g per person" |
| Category total constraint applied | "Salad total reduced from 150g to 100g (category limit)" |
| Global food cap triggered | "Total food exceeded 1000g limit — all portions scaled down" |
| High protein content reduced | "High protein content — reduced Mutton Seekh Kabab, Chicken Boti Tikka to stay within limits" |
| Big eaters enabled | "Big eaters: all portions increased by 20%" |

### Warnings

| When | Example message |
|------|----------------|
| No curry on menu | "Menu has no curry — at least one curry dish is recommended." |
| No rice on menu | "Menu has no rice — at least one rice dish is recommended." |
| Global food cap hit | "Total food was 1050g per person — reduced to 1000g limit" |
| Portion below minimum after all caps | "Cannot satisfy both minimum portion (30g) and caps for 'Spring Roll' (25g). Consider removing a dish." |

---

## Worked Example: Curry + Rice Only (Simple Menu)

**Menu:** Mutton Qorma, Chicken Biryani, Fresh Green Salad, Raita, Naan, Fruit Trifle, Green Tea

**Guests:** 100 (50 gents, 50 ladies)

### Protein Pool

**Step 1 — Category budgets (growth_rate=0.2):**
- Curry (1 dish): 160 × (1 + 0) = **160g**
- Rice (1 dish): 100 × (1 + 0) = **100g**

**Step 1b — Redistribution (redistribution_fraction=0.7):**
- Present total: 260g
- Absent: BBQ = 180g → redistributed = 180 × 0.7 = 126g
- Curry: 160 + 126 × (160/260) = **238g**
- Rice: 100 + 126 × (100/260) = **148g**

**Step 2 — Ceiling check:**
- Total: 386g < 590g ceiling. No compression.

**Step 3 — Only 1 dish per category, so no popularity split needed.**
- **Protein total: 386g per gent**

### Accompaniment Pool

No veg curry or sides on menu → pool is empty, no allocation.

### Dessert Pool

**Step 1:** max(80, 1 × 40) = 80g
**Step 2:** 80g < 150g ceiling. No compression.
- **Dessert total: 80g per gent**

### Service Pool

- Salad: 50g
- Raita: 40g
- Naan: 1 piece
- Tea: 1 cup

### Final Output (per gent)

| Dish | Category | Per Gent | Per Lady |
|------|----------|----------|----------|
| Mutton Qorma | Curry | 238g | 238g |
| Chicken Biryani | Rice | 148g | 148g |
| Fresh Green Salad | Salad | 50g | 50g |
| Raita | Condiment | 40g | 40g |
| Naan | Bread | 1 pc | 1 pc |
| Fruit Trifle | Dessert | 80g | 80g |
| Green Tea | Tea | 1 cup | 1 cup |

**Grand total per gent: ~556g** (386 protein + 80 dessert + 90 service). Ladies receive the same portions (multiplier 1.0).

---

## Worked Example: BBQ + Curry + Rice (Standard Menu)

**Menu:** Chicken Seekh Kabab, Mutton Qorma, Chicken Biryani + service + dessert

### Protein Pool

**Step 1 — Category budgets (growth_rate=0.2):**
- BBQ (1 dish): 180 × (1 + 0) = **180g**
- Curry (1 dish): 160 × (1 + 0) = **160g**
- Rice (1 dish): 100 × (1 + 0) = **100g**

**Step 1b — Redistribution:**
- All 3 protein categories present → no absent budget → no redistribution
- Total: 440g

**Step 2 — Ceiling check:**
- Total: 440g < 590g ceiling. No compression.

**Protein total: 440g per gent**

---

## Worked Example: Full Menu with Accompaniments

**Menu:** 2 BBQ dishes + 2 curries + 1 rice + 1 veg curry + 1 sides + 2 salads + dessert + naan + tea

### Protein Pool

**Step 1 — Category budgets (growth_rate=0.2):**
- BBQ (2 dishes): 180 × (1 + 0.2) = **216g** → 108g each
- Curry (2 dishes): 160 × (1 + 0.2) = **192g** → 96g each
- Rice (1 dish): 100 × (1 + 0) = **100g**

**Step 1b — Redistribution:**
- All 3 protein categories present → no absent budget → no redistribution
- Total: 508g

**Step 2 — Ceiling enforcement:**
- 508g < 590g ceiling → no compression

**Protein total: 508g per gent**

### Accompaniment Pool

**Step 1 — Category budgets (growth_rate=0.2):**
- Veg Curry (1 dish): 80 × (1 + 0) = **80g**
- Sides (1 dish): 60 × (1 + 0) = **60g**

**Step 1b — Redistribution:**
- Both categories present → no redistribution
- Total: 140g

**Step 2 — Ceiling check:**
- 140g < 150g ceiling → no compression

**Accompaniment total: 140g per gent**

---

## Portion Checker ("Check My Portions")

A separate validation path that lets the user enter their own grams-per-person for each dish and checks them against the same constraints the engine uses. It does **not** recalculate portions — it only validates what the user entered.

### What Gets Checked

Three tiers of validation, in order:

1. **Pool ceilings** — Sum the user's portions per pool (protein, accompaniment, dessert) and compare to the effective ceiling. Service pool dishes and qty-unit dishes are excluded from pool sums.

2. **Category constraints** — For each category:
   - **Per-dish minimum:** Is each dish above its category's min portion (or the global 30g floor)? Qty-unit categories (bread, tea) skip the global gram floor entirely — a value of "1 naan" should not trigger "below 30g". If a qty category has an explicit DB override for minimum, that override is still applied (assumed to be in the correct unit).
   - **Per-dish maximum:** Is each dish below the category max (if one is set)?
   - **Category total cap:** Does the sum of all dishes in the category exceed the category total limit (if one is set)?

3. **Global caps** — Applied to weight-based, non-service dishes only (same scope as the engine's global safety caps):
   - Total food per person vs. the 1000g cap.
   - Total dietary protein per person vs. the 120g cap.
   - Qty-unit dishes are excluded from both sums — their values are piece counts, not grams.

### Violation Severity

Each violation has a severity:
- **Error** — pool ceiling exceeded, category max exceeded, category total exceeded, global food cap exceeded.
- **Warning** — below minimum portion, protein macronutrient cap exceeded.

### Comparison with Engine

After validating, the checker also runs the standard calculation engine with the same inputs (dishes, guests, big eaters). The response includes a side-by-side comparison: user's portion vs. engine-recommended portion per dish, with absolute and percentage deltas.

### Unit Handling

The checker respects the `unit` field on each dish category:
- **`kg` (weight)** — validated against gram-based constraints, included in pool/global totals.
- **`qty` (pieces)** — skips the global gram minimum floor, excluded from pool ceiling sums and global food/protein cap totals. Category-specific overrides (if set in DB) still apply.

Violation messages use the appropriate unit label ("g" for weight, "pcs" for qty).

---

## Summary of Configurable Parameters

| Parameter | Where | Default | What It Controls |
|-----------|-------|---------|-----------------|
| Baseline budget per category | DishCategory (admin) | Varies | Starting budget for 1 dish in category |
| Min per dish per category | DishCategory (admin) | Varies | Minimum viable portion per dish |
| Fixed portion (service) | DishCategory (admin) | Varies | Exact per-person amount for service items |
| Protein pool ceiling | GlobalConfig (admin) | 590g | Max total for all protein categories combined |
| Accompaniment pool ceiling | GlobalConfig (admin) | 150g | Max total for veg curry + sides combined |
| Dessert pool ceiling | GlobalConfig (admin) | 150g | Max total for dessert category |
| Dish growth rate | GlobalConfig (admin) | 0.20 | Each extra dish adds this fraction of baseline to category budget |
| Absent redistribution fraction | GlobalConfig (admin) | 0.70 | Fraction of absent-category budget that redistributes (0-1) |
| Popularity strength | GlobalConfig (admin) | 0.3 | How much popularity affects within-category split |
| Popularity per dish | Dish (admin) | 1.0 | Relative weight for popularity-based splitting |
| Ladies multiplier | GuestProfile (admin) | 1.0 | Ladies get same portions as gents (configurable) |
| Max food per person | GlobalConstraint (admin) | 1000g | Last-resort global food cap |
| Max protein per person | GlobalConstraint (admin) | 120g | Last-resort macronutrient protein cap |
| Min portion per dish | GlobalConstraint (admin) | 30g | Absolute floor for any single dish |
| Category min/max/total | CategoryConstraint (admin) | Per category | Per-category overrides (e.g., salad max 100g) |
| Profile ceiling overrides | BudgetProfile (admin) | null | Tier-specific pool ceiling overrides |
