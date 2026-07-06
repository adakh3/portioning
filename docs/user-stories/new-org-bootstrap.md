# New-org bootstrap: US starter catalog + country defaults

> Makes a brand-new organisation usable and correctly localised out of the box.
> The catalog data was already multi-tenant (per-org dishes/menus/rules); this fills
> the **new-org experience** gaps. Runbook: `docs/new-org-setup.md`.

## User story
As the **platform operator**, when I create a new org (e.g. a US caterer), I want it to start
with sensible **US currency/tax defaults** and a **neutral starter catalog**, so the owner can
build a quote immediately instead of facing an empty app configured for the wrong country.

## Acceptance criteria
- [ ] New org's `OrgSettings` currency/tax/timezone/date default from `Organisation.country`
      (US→USD `$` "Sales Tax"; GB→GBP; AE→AED; PK→PKR; **USD fallback**). Editable after.
      (`users/country_defaults.py`, applied in the org-creation signal.)
- [ ] A **US starter catalog** can be seeded per-org (admin action on Organisation **or**
      `python manage.py seed_starter_catalog --org "<name>"`): 6 categories, 18 dishes, 2 menus
      with price tiers, 11 add-ons, 5 labor roles, 5 equipment items, portioning rules, and
      event/meal/service-style/source choice options. **Idempotent** and **isolated** per org.
- [ ] The calculator works on a seeded menu with no extra setup.
- [ ] **Tax stays configurable** — per-org default rate (default 0) + per-event override. No tax
      engine (US sales tax is state/local, destination-based — future Stripe Tax integration).
- [ ] Multi-tenancy correctness: category names and labor-role names are **unique per-org** (were
      globally unique — would have blocked a 2nd org's catalog); `AllocationRule` is org-scoped
      (direct FK, can't reference another org's role).
- [ ] Protein types extended for US: pork, turkey, seafood (kept chicken/beef/lamb/mutton/veal/fish).

## Manual test cases

### TC1 — US org gets US defaults
Admin → create org, country `US`. **Expected:** its OrgSettings show USD / `$` / "Sales Tax".
Create country `AE` → AED; an unmapped country → USD.

### TC2 — Seed starter catalog
Run the **Seed US starter catalog** admin action (or the command) on the org. **Expected:** ~18
dishes, 2 menus, add-ons, labor roles, equipment; log in as its owner → menus + calculator work,
currency shows `$`, no desi data.

### TC3 — Two orgs, isolated
Seed two different orgs. **Expected:** each has its own full copy; neither sees the other's
dishes/categories/roles (previously a 2nd org would have failed on duplicate "Server"/category name).

### TC4 — Tax configurable
On a US org, set the Sales Tax rate in Settings and/or per event. **Expected:** the rate applies;
no jurisdiction lookup.

## Not in scope (follow-ups)
- **Single-guest-count mode** (drop the gents/ladies split for US) — superuser-configured per org,
  a planned separate change.
- Units localisation (grams → servings/oz).
- Automated address-based tax (Stripe Tax).

## Where it lives
- `backend/users/country_defaults.py`, `backend/users/signals.py` (defaults).
- `backend/dishes/management/commands/seed_starter_catalog.py`, admin action in
  `backend/users/admin.py`.
- Model fixes: `dishes/models.py` (DishCategory per-org unique + ProteinType), `staff/models.py`
  (LaborRole per-org unique, AllocationRule org FK) + migrations.
- Tests: `users/test_country_defaults.py`, `dishes/test_starter_catalog.py`,
  `staff/test_org_scoping.py`.
