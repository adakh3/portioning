# Portioning Calculator — MVP Plan

## Overview
Django + DRF backend with React/Next.js frontend for catering food portioning. Uses a **category-budget allocation** approach: total food budget splits into category budgets, then within each category dishes are divided by popularity. Enforces floor minimums (every dish must be servable), hard ceilings (total food + protein caps), and warns on irreconcilable conflicts. All rules managed via DB + Django admin. Designed to grow into a full kitchen cost management app.

## Tech Stack
- **Backend**: Django + Django REST Framework + SQLite (dev) / PostgreSQL (prod)
- **Frontend**: Next.js (React) + Tailwind CSS
- **Config**: All rules/constraints stored in DB, managed via Django admin

---

## User Journeys

### Flow 1: Use a Pre-made Menu
1. User sees a list of **menu templates** (e.g. "Classic Indian Buffet", "BBQ Party", "Vegetarian Spread")
2. Each template has a fixed dish list with **pre-calculated snapshot portions** (stored in DB)
3. User selects a template → sees the snapshot portions immediately
4. User adjusts guest mix (adults/children/elderly) → system recalculates from the snapshot baseline
5. User can optionally add/remove dishes → system recalculates using the full engine

### Flow 2: Build a Custom Menu
1. User starts from a **base template** (to get a baseline)
2. Adds/removes dishes from the catalog (grouped by category)
3. Enters guest mix
4. System calculates portions using the full engine
5. User can save as a new template or as an event

### Flow 3: Manage an Event
1. User creates an event (name, date, guest mix, menu)
2. Can apply event-level constraint overrides (e.g. "this client wants max 600g per person")
3. System calculates and stores the result
4. User can revisit and tweak

---

## Project Structure

```
portioning/
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── portioning/                # Django project settings
│   │   ├── settings.py
│   │   ├── urls.py
│   │   └── wsgi.py
│   ├── dishes/                    # Django app: dish catalog
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   └── admin.py
│   ├── menus/                     # Django app: menu templates
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   └── admin.py
│   ├── rules/                     # Django app: portioning rules & constraints
│   │   ├── models.py
│   │   ├── admin.py
│   │   └── migrations/
│   ├── events/                    # Django app: events with overrides
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   └── admin.py
│   ├── calculator/                # Django app: portioning engine
│   │   ├── engine/
│   │   │   ├── models.py         # Dataclasses for calculation I/O
│   │   │   ├── baseline.py       # Step 1: category budget allocation
│   │   │   ├── adjustments.py    # Steps 2-4: floor stretching, popularity, combos
│   │   │   ├── constraints.py    # Step 5-6: cap enforcement
│   │   │   └── calculator.py     # Pipeline orchestrator
│   │   ├── serializers.py
│   │   ├── views.py
│   │   └── urls.py
│   ├── management/
│   │   └── commands/
│   │       └── seed_data.py
│   └── tests/
├── frontend/
│   ├── package.json
│   ├── tailwind.config.js
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx              # Landing / template list
│       │   ├── calculate/page.tsx    # Main calculation page
│       │   └── events/page.tsx       # Event management
│       ├── components/
│       │   ├── MenuTemplateList.tsx
│       │   ├── DishSelector.tsx
│       │   ├── GuestMixForm.tsx
│       │   ├── ResultsTable.tsx
│       │   ├── CostSummary.tsx
│       │   └── WarningsBanner.tsx
│       └── lib/
│           └── api.ts
```

---

## Data Models

### Dish Models (`dishes/models.py`)

- **DishCategory**: name, display_name, display_order
- **ProteinType**: TextChoices — chicken, lamb, beef, fish, seafood, pork, none
- **Dish**: name, category (FK), protein_type, default_portion_grams, protein_per_gram (0.0–1.0), popularity (default 1.0), cost_per_gram, is_vegetarian, is_active, notes, timestamps

### Menu Template Models (`menus/models.py`)

- **MenuTemplate**: name, description, is_active, default_adults/children/elderly, created_at
- **MenuDishPortion**: menu (FK), dish (FK), portion_grams (snapshot per-adult portion)

### Rules & Constraints (`rules/models.py`)

- **GlobalConfig** (singleton): total_food_per_person_grams (default 560), popularity_enabled, popularity_strength (0–1, default 0.3)
- **CategoryBudget**: category (OneToOne), budget_grams — how total food budget splits across categories
- **GuestProfile**: name ("adult"/"child"/"elderly"), portion_multiplier (1.0/0.6/0.75)
- **CombinationRule**: categories (M2M), reduction_factor, description, is_active
- **GlobalConstraint** (singleton): max_total_food (700g), max_total_protein (120g), min_portion_per_dish (30g)
- **CategoryConstraint**: category (OneToOne), min/max portion, max total category grams

### Event Models (`events/models.py`)

- **Event**: name, date, adults/children/elderly, dishes (M2M), based_on_template (FK nullable), notes, created_at
- **EventConstraintOverride**: event (OneToOne), overrides for max food/protein/min portion (all nullable)

---

## Calculation Pipeline

### Step 1 — Category Budget Allocation (`baseline.py`)
For each category in the menu: budget / num_dishes_in_category = equal split per dish.
Fallback for unconfigured categories: distribute leftover budget equally.

### Step 2 — Floor-Aware Budget Stretching (`adjustments.py`)
If a category's floor demand (num_dishes × min_portion) exceeds its budget, stretch the budget up. Redistribute the overshoot by shrinking categories that have headroom. If ALL categories are floor-constrained, total increases (unavoidable).

### Step 3 — Popularity-Weighted Split (`adjustments.py`)
Within each category, shift portions toward popular dishes based on popularity_strength. Blend between equal split (strength=0) and fully proportional (strength=1). Re-enforce floors, re-normalize.

### Step 4 — Combination Adjustments (`adjustments.py`)
For active CombinationRules: if all rule's categories are present, multiply affected dish portions by reduction_factor.

### Step 5 — Guest Mix Expansion
Per-adult portions from steps 1-4. Per-child = per-adult × child_multiplier. Per-elderly = per-adult × elderly_multiplier. Total = sum across guest types.

### Step 6 — Hard Constraint Enforcement (`constraints.py`)
Resolution order: event override > category constraint > global constraint.

A. Per-category max portion: cap individual dishes, redistribute excess
B. Per-category total cap: scale all dishes in category down
C. Global max food cap: scale ALL portions proportionally
D. Global max protein cap: reduce highest-protein dishes first
E. Post-cap floor re-check: if caps push below floor → WARNING (cap wins, user warned)

### Algorithm Flow
```
Category Budgets → Equal Split → Floor Stretching → Popularity Split → Combo Adjustments → Guest Expansion → Hard Caps + Conflict Detection
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dishes/` | List all active dishes |
| GET | `/api/categories/` | List dish categories |
| GET | `/api/menus/` | List menu templates |
| GET | `/api/menus/{id}/` | Template detail with snapshot portions |
| POST | `/api/calculate/` | Calculate portions for an ad-hoc menu |
| GET | `/api/events/` | List events |
| POST | `/api/events/` | Create event |
| GET | `/api/events/{id}/` | Event detail |
| POST | `/api/events/{id}/calculate/` | Calculate for a saved event |

### Calculate Request
```json
{
  "dish_ids": [1, 2, 3, 4, 5],
  "guests": { "gents": 50, "ladies": 50 },
  "constraint_overrides": { "max_total_food_per_person_grams": 650 }
}
```

### Calculate Response
```json
{
  "portions": [
    {
      "dish_id": 1,
      "dish_name": "Chicken Tikka",
      "category": "Dry / Barbecue",
      "protein_type": "chicken",
      "pool": "protein",
      "unit": "kg",
      "grams_per_gent": 110.0,
      "grams_per_lady": 88.0,
      "total_grams": 10945.0,
      "cost_per_gent": 0.44,
      "total_cost": 43.78
    }
  ],
  "totals": {
    "food_per_gent_grams": 540.0,
    "food_per_lady_grams": 432.0,
    "total_food_weight_grams": 52400.0,
    "total_cost": 215.50
  },
  "warnings": [],
  "adjustments_applied": [
    "Category 'Dry / Barbecue' budget: 330g split across 2 dishes",
    "Popularity redistribution applied (strength=0.3)",
    "Combination rule 'Rice + bread overlap' applied"
  ]
}
```

---

## Frontend Pages

### Landing Page
- Menu template cards, "Create Custom Menu" button

### Calculate Page (`/calculate`)
- Template selector, dish selector (searchable, grouped by category), guest mix form
- Calculate button → results table, totals, warnings banner, adjustments audit trail
- Save as template / save as event buttons

### Events Page (`/events`)
- List of saved events, click to view/edit/recalculate

---

## Build Order

1. **Phase 1**: Django scaffolding + models + admin + seed data
2. **Phase 2**: Calculation engine (baseline, adjustments, constraints, orchestrator)
3. **Phase 3**: API layer (serializers, viewsets, calculate endpoint, CORS)
4. **Phase 4**: Frontend (Next.js + Tailwind, components, pages)
5. **Phase 5**: Polish (tests, loading states, error handling, save flows)

---

## Verification Plan

1. Unit tests for each engine module
2. Category budget test: 3 curries split 220g → ~73g each
3. Floor stretch test: 10 curries × 30g min = 300g > 220g budget → stretch + redistribute
4. Cap conflict test: 25 dishes × 30g min = 750g > 700g max → cap wins + warning
5. Popularity test: 2 curries (1.5 vs 0.8) → popular one gets more budget
6. Protein cap test: all-meat menu → protein cap triggers
7. Event override test: event max 600g overrides global 700g
8. API test: POST `/api/calculate/`, verify response structure
9. Frontend: select template, modify dishes, enter guests, calculate, verify display
