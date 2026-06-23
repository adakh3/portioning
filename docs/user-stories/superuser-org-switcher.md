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
- [ ] It shows the current context: an org name, or "All orgs".
- [ ] The menu lists **All orgs**, **My own org**, and every active org.
- [ ] Choosing an option switches context and the app's data refreshes to that org (no manual reload).
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

### TC4 — All orgs
**Steps:** Open the switcher → **All orgs**.
**Expected:** Cross-tenant views show everything (where the app supports it); label reads "All orgs".

### TC5 — Back to own org
**Steps:** Open the switcher → **My own org**.
**Expected:** Context returns to the superuser's own org.

### TC6 — Persistence
**Steps:** Switch to an org, then reload the app.
**Expected:** Still in that org (the override is session-backed).

## Automated coverage
- Frontend: `components/OrgSwitcher.test.tsx` (hidden for non-superuser; shows active org; switches to a chosen org / own org).
- Backend: existing `SwitchOrgView` / `OrganisationListView` tests (superuser-only, override behaviour).
