# Portioning Calculator

Catering food portioning calculator — Django + DRF backend, Next.js + Tailwind frontend.

**AI agents are the wedge — the app needs to be an AI-first rethink of traditional SaaS.**

## Project Structure

- `backend/` — Django project with apps: `dishes`, `menus`, `rules`, `events`, `calculator`, `bookings`, `staff`, `equipment`, `users`
- `frontend/` — Next.js app with Tailwind CSS
- `venv/` — Python virtual environment (not committed)

## Development Setup

### Backend
```bash
source venv/bin/activate
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py loaddata seed.json           # Reference data (dev only — not deployed to prod)
python manage.py seed_demo                    # Demo org, logins & commission data (dev only — never deployed)
python manage.py runserver
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Running from a git worktree
Worktrees under `.claude/worktrees/<name>/` don't share the dev environment with the main
checkout. Tests run out of the box, but **running the app** needs a one-time setup per worktree
(own empty DB → `migrate` + seed + a user; a **real** `npm install` because Turbopack rejects the
hook's `node_modules` symlink; free ports 8000/3000). See **`docs/WORKTREE_SETUP.md`**.

## Key Conventions

- **Python**: Django 5.x, DRF, SQLite for dev, PostgreSQL for prod
- **Frontend**: Next.js App Router, TypeScript, Tailwind CSS
- **API prefix**: All endpoints under `/api/`
- **Calculation engine**: Pure logic in `calculator/engine/`, no Django ORM dependencies in core math
- **Rules in DB**: All portioning rules/constraints are DB-managed via Django admin, not hardcoded
- **Virtual env**: Always use `source venv/bin/activate` before running Python commands

## Important Rules

- **Any change to calculation logic** (engine, pools, categories, baselines, ceilings) **must also update PORTIONING_LOGIC.md** to keep documentation in sync with the code.
- **Booking totals are computed on the backend (source of truth) AND mirrored on the frontend for live preview.** Any change to the totals math must update **all three together** — `backend/bookings/services/totals.py`, `frontend/lib/quoteTotals.ts`, and the shared spec `docs/calculation-golden-cases.json` (both engines' tests assert against it). See **`docs/CALCULATION_PARITY.md`**.
- **Any change to PORTIONING_LOGIC.md** must also update **`frontend/app/help/page.tsx`** — the help page is static content distilled from the logic doc.
- **Any change to seed data** (new dishes, menus, categories, rules, cost data, surcharges, etc.) **must regenerate `backend/seed.json`** by running: `cd backend && python manage.py dumpdata users.Organisation dishes menus rules bookings.OrgSettings bookings.ProductLine staff.LaborRole staff.AllocationRule equipment.EquipmentItem --indent 2 -o seed.json`
  - **Rebuild the DB with the starter-catalog auto-seed OFF first**, or the dump swells with catalog rows every cycle: `rm -f backend/db.sqlite3 && SEED_STARTER_CATALOG_ON_ORG_CREATE=False python manage.py migrate && SEED_STARTER_CATALOG_ON_ORG_CREATE=False python manage.py loaddata seed.json`, then dump. `loaddata` creates the orgs, which fires the `post_save` signal, which seeds the starter catalog — and the next dump captures all of it.
- **Seeding strategy**: All choice options are seeded **only when a new org is created**, via the `post_save` signal in `users/signals.py`. No data migrations should bulk-seed choice options. Workflow options (lead statuses + lost reasons) are seeded inline in the signal; non-workflow options (event types, sources, service styles, meal types) get US-mainstream starter defaults from `backend/bookings/defaults.py` (`seed_choice_defaults`) — all fully editable/removable in Settings. **Existing orgs** that predate this seeding are backfilled on demand with `python manage.py seed_org_choices` (idempotent; only fills a choice type that is entirely empty, so it never re-adds an option an org deleted).
  - **Orgs created while both seeders ran** (before REL-435) carry duplicate rows — the same label under two slugs (`family`/`family_style`, `dropoff`/`drop_off`, `holiday_party`/`holiday`). Repair them with `python manage.py merge_duplicate_choice_options` — **dry run by default**, `--apply` to commit, `--org` to scope. It repoints quotes, events, leads and staffing rules onto the `defaults.py` slug, then deletes the duplicate. Idempotent, and deliberately conservative: it only merges where **both** rows exist and still **share a label**, so an org's own option (or a deliberate rename) is never rewritten.
- **`seed.json`** contains dev reference/config data (dishes, menus, rules, settings, labor roles, equipment) and is **not deployed to prod**. Demo transactional data (org, logins, commission targets, events, leads) is generated for local dev by the idempotent **`seed_demo`** management command (`backend/users/management/commands/seed_demo.py`) — never deployed to prod.
- **New org setup**: A `post_save` signal on `Organisation` (`users/signals.py`) auto-creates `OrgSettings` with defaults, a default commission plan, workflow options (lead statuses + lost reasons), and the non-workflow choice-dropdown starters (event types, sources, service styles, meal types). No manual setup needed for new orgs.
- **Any new npm package** must be committed with both `frontend/package.json` and `frontend/package-lock.json` so deployments can install it.
- **Any new feature or bug fix** must include backend and/or frontend tests. Tests are run automatically by the pre-commit hook — never skip them.
- **Any new feature** must get a **user story + manual test cases** — written as a **"User story & manual test cases" section in its Linear ticket** (who/what/why + numbered manual cases with expected results), so it can be verified by hand. **`docs/user-stories/` is a frozen archive** (older stories, kept for history) — do not add files there.
- **Code maintenance** — follow **`docs/CODE_MAINTENANCE.md`**: the **Boy Scout rule** (clean up any file/function you touch, only what you touched, before committing), one **single source of truth** for calculations (booking totals → `bookings/services/totals.py`, used by quotes *and* events; portioning → `calculator/engine/`), and **tests for any money/total math** covering the combinations.

## Testing

- **Any new feature or bug fix must include tests** — backend (Django `TestCase`) and frontend (Vitest + React Testing Library) as appropriate.
- **A git pre-commit hook** (version-controlled at `.githooks/pre-commit`) runs both test suites automatically before every commit. If tests fail, the commit is blocked. **One-time activation per clone:** `git config core.hooksPath .githooks`. The hook is worktree-aware — it self-heals `venv`/`node_modules`/`backend/.env` from the main checkout, so it runs from worktrees too.

### Backend
```bash
source venv/bin/activate
cd backend
python manage.py test                    # all tests
python manage.py test bookings.tests     # specific app
```

### Frontend
```bash
cd frontend
npm run test:run                         # single run
npm test                                 # watch mode
```

- Frontend tests are co-located next to source files (e.g. `lib/utils.test.ts` beside `lib/utils.ts`)
- Use Vitest globals (`describe`, `it`, `expect`) — no imports needed
- Mock `fetch` for API tests, mock modules with `vi.mock()` for hook tests
- Wrap hook tests in `SWRConfig` with `{ provider: () => new Map() }` to isolate cache
- **Any change to a create/edit form or its save payload needs a page-level integration test** that renders the real page, drives the fields through the UI, and asserts the object sent to `api.create*`/`update*` — unit-testing the payload builder is not enough (the field→state→payload wiring is where bugs hide). See the **`frontend-integration-tests`** skill for the general recipe; examples in `frontend/app/quotes/[id]/page*.test.tsx` and `frontend/app/events/[id]/page.create.test.tsx`.
- **Any change to the quote or event PDF** needs a render-and-extract test (pypdf) asserting the rendered content/order, like `backend/bookings/test_quote_pdf.py` and `backend/events/test_event_pdf.py` — don't rely on eyeballing the PDF.

### End-to-end smoke tests (pre-push, real browser — `frontend/e2e/`)
- The vitest integration tests **mock the API and run in jsdom**, so they prove *our wiring* but are blind to real-browser/persistence behaviour. A green mocked test is **not** proof for **native form controls (date/time/file/select), browser-specific `onChange` quirks, or "does it survive a save + reload"** — that's exactly the class that let the timeline-not-saving bug (Safari didn't fire `onChange` for `<input type="time">`) pass with green tests.
- For that class, verify against the **real running app** with Playwright: `cd frontend && npm run e2e` (needs the dev servers up + `seed_demo` data). Nothing is mocked — headless Chromium → `:3000` → `:8000` → sqlite. **Run before pushing** such changes for fast local feedback; it **also runs in CI on every PR** (the required *End-to-end (Playwright)* check, which boots its own stack) but is **not** in the pre-commit hook. Recipe + when-to-add in `frontend/e2e/README.md`; example `frontend/e2e/booking-timeline.spec.ts`.

## Git
- Remote: https://github.com/adakh3/portioning.git
- Branch: main
- Don't commit `venv/`, `node_modules/`, `__pycache__/`, `.env`, `db.sqlite3`
- **`main` is branch-protected / PR-only.** Direct pushes are blocked; land changes via PR. Required status checks (must be green to merge): **Backend tests (Django)**, **Frontend tests (Vitest)**, **Migration safety (Django)**, **End-to-end (Playwright)**. `strict` (branch must be up-to-date before merge) is on; admins can override in an emergency.

## Deployment
- Hosted on **DigitalOcean App Platform**. **Deploys are tag-triggered, NOT on merge** — DO "Autodeploy code changes" is OFF (changed 2026-07-30; REL-360/REL-420 follow-up). Merging PRs to `main` runs CI but does **not** deploy; `main` just batches CI-passed changes.
- **To release** (this is the only thing that ships to prod): push a version tag —
  ```bash
  git tag v1.4.0 && git push origin v1.4.0
  ```
  — which runs `.github/workflows/deploy.yml` (`doctl apps create-deployment --wait`). Or trigger it manually: **Actions → deploy → Run workflow** (deploys current `main`). **Never cut a release without the owner's explicit OK.**
- Every deploy auto-runs `.github/workflows/post-deploy-smoke.yml` (via `workflow_run`), probing prod `/api/health/` + `/login`; a failed probe emails the owner.
- Requires (GitHub → repo Settings): secret `DIGITALOCEAN_ACCESS_TOKEN` (DO API token, write) + variable `DO_APP_ID` (`doctl apps list`).
