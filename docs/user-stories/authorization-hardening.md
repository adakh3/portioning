# Authorization hardening

Closes gaps where a plain **salesperson** could reach configuration/management
endpoints (the DRF default is `IsAuthenticated`, i.e. any logged-in user) or land
on admin pages by typing the URL. Backend is the security boundary; the frontend
guards/links are UX only.

Related: REL-370. Builds on [roles-admin-tier](./roles-admin-tier.md).

## What changed

- **Config catalogs are read-for-all, write-for-admins.** New permission
  `IsAdminOrOwnerOrReadOnly` (`bookings/permissions.py`): any authenticated user
  may `GET`; only admin/owner may create/update/delete. Applied to:
  - Equipment catalog — `/api/equipment/items/` (+ detail)
  - Labor roles — `/api/staff/labor-roles/` (+ detail)
  - Allocation rules — `/api/staff/allocation-rules/` (+ detail)
- **Bulk lead actions are scoped.** A salesperson may bulk-edit only their **own**
  leads, and may **not** bulk **reassign** or **delete** (`403`). The bulk bar on
  the leads page hides Assign/Delete for salespeople.
- **Frontend route guard.** `lib/routeAccess.ts` + `AppShell` redirect a user who
  types the URL of a restricted page (`/settings`, `/team`) back to `/`. The
  dashboard `/` stays open (it has a salesperson view).

## Acceptance criteria

- [ ] A salesperson can **read** the equipment/labor-role/allocation-rule lists.
- [ ] A salesperson **cannot** POST/PATCH/DELETE those config endpoints (`403`).
- [ ] An admin/owner is never `403` on those endpoints.
- [ ] A salesperson cannot bulk-delete or bulk-reassign leads (`403`).
- [ ] A salesperson's bulk status/product change affects only their own leads.
- [ ] Visiting `/settings` or `/team` as a salesperson redirects to `/`.

## Manual test cases

### TC1 — Config read vs write
1. As a salesperson, `GET /api/staff/labor-roles/` → **200** (list visible).
2. As the same salesperson, `POST /api/staff/labor-roles/` → **403**.
3. As an owner, `POST /api/staff/labor-roles/` with a valid body → **201** (never 403).
Repeat for `/api/equipment/items/` and `/api/staff/allocation-rules/`.

### TC2 — Bulk lead guards
1. As a salesperson, select leads incl. ones owned by others; the bar shows no
   Assign/Delete. Bulk **status** change → only your own leads update.
2. `POST /api/bookings/leads/bulk/` with `action=delete` or `action=assign` → **403**.

### TC3 — Direct-URL route guard
1. As a salesperson, type `/settings` in the address bar → redirected to `/`.
2. As an owner, `/settings` loads normally.

## Automated coverage
- Backend: `bookings/test_authorization.py` (config read/write gating; bulk lead scoping).
- Frontend: `lib/routeAccess.test.ts`, `components/AppShell.test.tsx` (redirect + allow).
