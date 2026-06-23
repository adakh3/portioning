# Multi-tenant Django admin — organisation visibility

## User story
As a **superuser** managing every tenant from one Django admin, I want each
org-scoped record to **show which organisation it belongs to** and let me **filter to
a single org**, so that I can tell catalogs apart and never edit/add a record for the
wrong tenant.

## Background
All catalog/config data (dishes, menus, rules, staff, equipment, …) is per-org (an
`organisation` FK, required — not nullable). But the admin lists were plain
`ModelAdmin` with no org column or filter, so to a superuser (who sees all tenants
merged) everything *looked* global. A shared `OrgVisibleAdminMixin`
(`users/admin_mixins.py`) appends an **Organisation** column and prepends an
**organisation** sidebar filter. Child records (shifts, reservations, allocation rules,
category constraints) filter via their parent's org path.

## Acceptance criteria
- [ ] Every org-scoped changelist shows the **Organisation** of each row — both the catalog apps (Dishes, Dish categories, Menu templates, Labor roles, Staff, Equipment, Rules) **and the bookings apps** (Leads, Accounts, Contacts, Quotes, Invoices, Payments, choice options, add-on products, venues, …) via the shared `OrgScopedAdmin` base.
- [ ] Each has an **organisation** filter in the right sidebar to narrow to one org.
- [ ] The natural first column (e.g. name) stays the clickable link; list_editable still works.
- [ ] Adding a record requires choosing an Organisation (the FK is required), so a row can't be created org-less.
- [ ] Child records (shifts, equipment reservations, allocation rules, category constraints) can be filtered by their parent's org.
- [ ] The **User** admin shows Organisation, Staff status, **Superuser status**, and Active, with filters — so elevated accounts are auditable at a glance.
- [ ] A user with an **organisation cannot have Staff or Superuser** access (validation error) — a user with an org is a tenant user and can never reach the Django panel; admin/system accounts must have no org.

## Manual test cases

### TC1 — Org column on menus
**Steps:** As superuser, open Django admin → **Menu templates**.
**Expected:** Each row shows an **Organisation** column with the owning org's name.

### TC2 — Filter to one org
**Steps:** In the same list, use the **By organisation** filter in the right sidebar; pick an org.
**Expected:** The list narrows to that org's menus only.

### TC3 — Adding requires an org
**Steps:** Click **Add menu template**.
**Expected:** The form has a required **Organisation** dropdown; saving without choosing one is blocked.

### TC4 — Same for dishes / rules / staff / equipment
**Steps:** Repeat TC1–TC2 for Dishes, Dish categories, Labor roles, Staff, Equipment items, and the Rules models.
**Expected:** Org column + filter present on each.

### TC5 — Link column unchanged
**Steps:** On the Dishes list, click a dish's **name**.
**Expected:** It opens that dish's change form (the name is still the link, not the org).

### TC6 — Audit elevated accounts
**Steps:** Open Django admin → **Users**. Use the **Superuser status** filter → "Yes".
**Expected:** You see exactly who has god-mode, with their Organisation and Staff status columns.

### TC7 — Org user can't have admin access
**Steps:** Edit a user that has an **Organisation** set, tick **Staff status** (and/or **Superuser status**), and Save.
**Expected:** Save is blocked with an error on the Organisation field ("a user assigned to an organisation … cannot have admin access"). To save you must either clear the org (making it a system/admin account) or untick both Staff and Superuser. A system account (staff+superuser, **no** org) and a normal org user (no staff/superuser, with org) both save fine.

## Automated coverage
- `users/test_admin_org_visibility.py` — org column/filter (and child org-path filters) present; User admin surfaces superuser/org.
- `users/test_user_validation.py` — superuser+org rejected; superuser-without-org and normal org user accepted.
