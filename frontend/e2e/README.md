# End-to-end smoke tests (pre-push)

Real-browser tests that drive the **actual running dev app** — headless Chromium →
Next.js on `:3000` → Django on `:8000` → sqlite — with **nothing mocked**. This is the
"did it actually work in a browser" check that the mocked vitest suite structurally
cannot give (see below).

They are **not** in the pre-commit hook or CI. They're a **manual pre-push gate**: run
them before pushing so features are verified without clicking through by hand.

## Run

```bash
# 1) dev servers must be up, with seed_demo data:
#    (backend) python manage.py runserver
#    (frontend) npm run dev
# 2) then:
cd frontend
npm run e2e                 # all specs, headless
npx playwright test booking-timeline   # one spec
npx playwright show-report  # open the last HTML report (on failure)
```

Overrides via env: `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD` (defaults target
`http://localhost:3000` and the seed_demo owner login).

## Why this exists (and when to add a test here)

The mocked vitest tests stub the API and run in jsdom, so they only prove *our* wiring:
"given a click, what would we send to `api.createQuote`". They are blind to a whole class
of bug — the timeline regression that prompted this harness was **Safari not firing
`onChange` for `<input type="time">`**: the mocked test was green while real saves wrote
`null`. Only a real browser + real backend round-trip catches that.

**Add an e2e spec here when a mock could lie:**
- native form controls (date/time/file/select behaviour, browser `onChange` quirks),
- anything browser- or persistence-specific (does it survive a save + reload?),
- a critical happy-path you'd otherwise re-test by hand every release.

Keep them few and high-value — one solid flow per feature, asserting the **user-visible
outcome** (e.g. set a value → save → reopen → it's still there), not internals.

## Adding a spec

1. New file `e2e/<feature>.spec.ts`.
2. `await login(page)` from `./helpers` in `beforeEach`.
3. Drive the real UI; target inputs by `aria-label` (add one to the component if missing —
   same convention the vitest integration tests use).
4. Assert the outcome a user would check (reload and read the value back).
