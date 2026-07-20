# Auto-seed a starter catalog into every new organisation

## User story
As a **platform operator onboarding a new catering business**, I want a fresh
organisation to arrive with a **ready-made sample catalog** — dish categories,
dishes, menus, add-on products, labor roles, equipment and rules — so the new
tenant can build a quote or event **immediately** instead of staring at empty
dropdowns.

## Background
Org creation already seeds *choice options* (event types, lead statuses, etc.)
via the `post_save` signal in `users/signals.py`, but the **catalog** (dishes,
menus, add-ons, rules) was only seeded by the manual `seed_starter_catalog`
command / admin action. New orgs therefore had empty menu builders.

This wires the same catalog seed into org creation:
- The command's seeding logic is extracted into a reusable `Command.seed(org)`
  method (idempotent, `get_or_create` throughout); the command, the admin action,
  and the signal all call it — one source of truth, no name-lookup fragility.
- The signal calls it, guarded by **`SEED_STARTER_CATALOG_ON_ORG_CREATE`** —
  **on** in dev/prod, **off** under the test runner (so the ~700 org-creating
  tests stay fast and control their own data). It's **best-effort**: a seeding
  hiccup is caught + logged and never blocks org creation.
- The catalog content is generic (Western), and the "US" wording was dropped from
  the command/admin/messages so it reads market-neutral for all orgs.

## Acceptance criteria
- [ ] Creating a new org in dev/prod auto-seeds it with categories, dishes, menus, add-on products, labor roles, equipment and rules.
- [ ] The seed is **idempotent** — re-running (command or admin action) never duplicates.
- [ ] A seeding failure **does not** roll back / block org creation (caught + logged).
- [ ] Existing orgs are **unaffected** (the signal only fires on creation); they can be seeded on demand via `python manage.py seed_starter_catalog --org "<name>"` or the **"Seed starter catalog"** admin action.
- [ ] Under the test runner, org creation does **not** auto-seed (setting off), so the suite is unaffected.
- [ ] No "US" wording remains on the command help, admin action label, or messages.

## Manual test cases

### TC1 — New org arrives with a catalog
**Steps:** In Django admin (or via onboarding), create a new Organisation. Open the app as that org → Menus / a new Quote's dish picker.
**Expected:** Dish categories, dishes (with the V veg markers), menus, and add-on products are all present — the forms aren't empty.

### TC2 — Seed an existing org on demand
**Steps:** Django admin → Organisations → select an existing org → **"Seed starter catalog"** action (or `python manage.py seed_starter_catalog --org "<name>"`).
**Expected:** That org now has the catalog; re-running adds nothing new (idempotent).

### TC3 — Neutral wording
**Steps:** Look at the admin action label and its success message.
**Expected:** Reads "Seed starter catalog…" / "Seeded the starter catalog into N organisation(s)." — no "US".

### TC4 — Toggle off
**Steps:** Set `SEED_STARTER_CATALOG_ON_ORG_CREATE=False` (env) and create an org.
**Expected:** The org is created with settings + choice options but **no** dish/menu/add-on catalog.
