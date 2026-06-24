# Roles — admin tier (admin ≠ manager; owner protected)

## User story
As an **org owner**, I want an **Admin** role that has all rights *except* touching
the owner account, and I want plain **managers** kept out of admin settings, so that I
can delegate full administration without risking my owner account and without exposing
configuration to operational managers.

## Role model
- **owner** — top org account. Full rights, incl. user management. The **superuser maps
  to owner** (full access everywhere).
- **admin** *(new)* — all rights *except* creating/editing/removing the **owner** (and
  cannot assign the owner role).
- **manager** — operational only: dashboards, leads, events, locked dates, auto-assign.
  **No admin settings.**
- **salesperson**, **chef** — unchanged.

## Permission tiers (backend)
- `IsManagerOrOwner` → manager/admin/owner (+superuser) — operational.
- `IsAdminOrOwner` *(new)* → admin/owner (+superuser) — **org settings/config** (org
  settings, lead statuses, choice lists, product lines).
- `IsOwner` → owner (+superuser).
- User management (`/api/auth/users/`) → admin/owner, with owner-account protection.

## Acceptance criteria
- [ ] Admin can open **Settings** and **Team**; manager/salesperson/chef cannot (links hidden + API 403).
- [ ] Admin can edit org settings, lead statuses, choice lists, product lines; manager gets 403.
- [ ] Admin can create/edit/deactivate users — **except** the owner (cannot edit the owner, assign the owner role, or create an owner). Owner can.
- [ ] Manager keeps dashboards and operational pages.
- [ ] Superuser has owner-level access everywhere (maps to owner).

## Manual test cases

### TC1 — Manager has no admin settings
**Steps:** Sign in as a manager.
**Expected:** No **Settings** or **Team** link in the nav; visiting `/settings` or hitting the settings API returns 403/redirect. Dashboards and leads still work.

### TC2 — Admin has settings
**Steps:** Sign in as an admin.
**Expected:** Settings + Team links visible; can edit org settings, lead statuses, options, product lines.

### TC3 — Admin can't touch the owner
**Steps:** As admin, open **Team**.
**Expected:** The owner row's **Edit/Deactivate** are disabled; the role dropdown has no **Owner** option; trying via API (edit owner, promote to owner, create owner) returns 403.

### TC4 — Owner can manage everything
**Steps:** As owner, edit the owner account, create an admin, demote/promote.
**Expected:** All allowed.

### TC5 — Superuser maps to owner
**Steps:** As superuser (switched into an org), edit settings + users.
**Expected:** Full access (owner-level).

## Out of scope (follow-up)
- Splitting **manager** into **sales_manager** / **kitchen_manager** (department-scoped).
- Owner-only WhatsApp number config (see REL-356).

## Automated coverage
- Backend: `users/test_roles.py` (settings admin-only; user-mgmt owner protection; superuser maps to owner).
- Frontend: `lib/navigation.test.ts` (Settings/Team/Dashboard role gating).
