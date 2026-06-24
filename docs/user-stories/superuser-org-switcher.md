# Superuser org-switcher (impersonate an org)

## User story
As a **superuser**, I want to **switch which org's data the app shows me** — pick any
org, "all orgs", or back to my own — so that I can support/operate any tenant through
the normal app UI instead of the Django admin, with each org's data cleanly isolated.

## Background
The backend already implements this via a session **org override** (`OrgMiddleware`):
- `POST /auth/switch-org/` with `{org_id: <pk> | "all" | null}`
- `GET /auth/organisations/` lists orgs (superuser only)
- the user payload exposes `is_superuser`, the effective `organisation`, and `all_orgs`.

This adds the **frontend switcher** in the top nav (superusers only). Selecting an org
updates the active context and **revalidates all data** so the whole app reflects it.

## Acceptance criteria
- [ ] The switcher appears in the top nav **only for superusers**; normal users never see it.
- [ ] It shows the current context: an org name (or "Pick an org" if none selected).
- [ ] The menu lists **every active org** — exactly **one org at a time**. There is **no "all orgs"** option (it's disabled, and the API rejects `org_id="all"` with 400).
- [ ] Choosing an org switches context and the app's data refreshes to that org (no manual reload).
- [ ] A non-superuser hitting the switch endpoint is rejected (403) — enforced server-side.

## Manual test cases

### TC1 — Hidden for normal users
**Steps:** Log in as an org owner/manager/salesperson.
**Expected:** No "Viewing: …" switcher in the top nav.

### TC2 — Visible for superuser
**Steps:** Log in as a superuser.
**Expected:** A "Viewing: ⟨your org⟩ ▾" control appears in the top nav.

### TC3 — Switch to another org
**Steps:** Open the switcher → pick a different org.
**Expected:** The label updates to that org; navigate to Leads/Quotes/Dishes — you now
see **that org's** data only.

### TC4 — No all-orgs
**Steps:** Open the switcher.
**Expected:** Only individual orgs are listed — no "All orgs" (and no "My own org") option. You always view exactly one org.

### TC6 — Persistence
**Steps:** Switch to an org, then reload the app.
**Expected:** Still in that org (the override is session-backed).

## Automated coverage
- Frontend: `components/OrgSwitcher.test.tsx` (hidden for non-superuser; shows active org; switches to a chosen org / own org).
- Backend: existing `SwitchOrgView` / `OrganisationListView` tests (superuser-only, override behaviour).
