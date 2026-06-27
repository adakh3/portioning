# Running the app from a git worktree

Worktrees live under `.claude/worktrees/<name>/`. They share git history but **not**
the dev environment — each is its own checkout with its own gitignored files. Running
the **test suites** from a worktree works out of the box (the pre-commit hook self-heals).
Running the **app** needs a one-time setup, because these are per-worktree or shared-from-main:

## Shared vs per-worktree

| Thing | Where it lives | What to do in a worktree |
|---|---|---|
| `venv` | **main checkout only** | activate the main one: `source <main>/venv/bin/activate` |
| `backend/.env` | gitignored | hook symlinks it from main; standalone: `cp <main>/backend/.env backend/.env` |
| `frontend/node_modules` | gitignored | hook symlinks it from main (fine for tests), but **`next dev` / Turbopack rejects the out-of-root symlink** → for the dev server do a real install: `rm -f node_modules && npm install` |
| `backend/db.sqlite3` | gitignored | **starts empty** — run `migrate` |
| users & data | in the DB | **none by default** — load seed + create a login (below) |
| ports 8000 / 3000 | — | collide with any other running instance; stop the other app, or use alternate ports (+ add the new frontend origin to `CORS_ALLOWED_ORIGINS`) |

## One-time setup

```bash
# from repo root
source venv/bin/activate
cd .claude/worktrees/<name>/backend
python manage.py migrate
python manage.py loaddata seed.json     # reference data (dishes, menus, rules, settings, …)
python manage.py seed_demo              # demo org + logins + commission data (see below)

cd ../frontend
rm -f node_modules && npm install        # real install — Turbopack needs it
```

## Demo accounts & data — `seed_demo`

`seed.json` deliberately has **no users or transactional data**, and `test_fixtures.json` is
often stale (schema drift makes `loaddata` fail). So instead of hand-creating users in every
worktree — which made each one diverge — run the **idempotent** `seed_demo` command:

```bash
python manage.py seed_demo            # into "Demo Co"
python manage.py seed_demo --org "X"  # into a named org
```

It produces the **same** state everywhere (re-running just resets it — safe to repeat):

| Login | Password | Role |
|---|---|---|
| `owner@demo.test` | `Owner123!` | owner |
| `admin@demo.test` | `Admin123!` | admin |
| `manager@demo.test` | `Manager123!` | manager |
| `rep@demo.test` | `Sales123!` | salesperson |
| `rep2@demo.test` | `Sales123!` | salesperson |

…plus monthly commission targets for the financial year, a confirmed event per rep (so the
dashboard shows real attainment), and sample pipeline leads. **Test against these**, not
hand-made accounts, so "works on mine" actually means something.

## Run

```bash
python manage.py runserver        # backend (free :8000 first)
npm run dev                       # frontend (free :3000 first) → http://localhost:3000
```

## Tear down

```bash
git worktree remove .claude/worktrees/<name>
```

The gitignored `db.sqlite3` / `node_modules` go with it.

---

**Tip:** running from your **main checkout** is lower-friction for quick "just run it" testing —
it's permanently set up (venv, real node_modules, a populated DB, a user). Use worktrees when you
want *isolation* (parallel features) and accept this one-time setup cost.
