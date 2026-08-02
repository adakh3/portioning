# End-to-end smoke tests (pre-push)

Real-browser tests that drive the **actual running dev app** — headless Chromium →
Next.js on `:3000` → Django on `:8000` → sqlite — with **nothing mocked**. This is the
"did it actually work in a browser" check that the mocked vitest suite structurally
cannot give (see below).

They run in **two places**:

1. **Manual pre-push gate** (primary) — run them before pushing so features are verified
   without clicking through by hand. They're **not** in the pre-commit hook.
2. **CI, on PRs only** — the `e2e` job in `.github/workflows/ci.yml` boots the full stack
   in the cloud (`migrate` → `loaddata seed.json` → `seed_demo` → Django `:8000` + a built
   Next on `:3000`) and runs these specs. It's the slow job, so it runs on **pull requests
   only** (the backend/frontend/migration jobs are the fast gate on every push). It is now
   a **required check** — *End-to-end (Playwright)* must be green to merge. A failing run
   uploads the Playwright HTML report as a downloadable artifact.

Running them locally still needs the dev servers up (below); CI boots its own.

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

## Don't race async data (REL-442)

There are **no retries** here on purpose: a spec that only passes on a re-run is a bug to
fix, not to paper over — a suite that fails 1-in-N trains people to hit re-run instead of
reading the failure.

Playwright's own actions auto-retry, which covers most of it: `selectOption({ label: … })`
keeps retrying until that option exists, so a dropdown still loading is not a race.

What it does **not** cover is **clicking a button whose handler reads async data, then
asserting the result**. The click fires once, against whatever data had arrived by then,
and a wrong result never recovers. That's what flaked here: `+ Build a run-of-show` seeds
the day from the org's Timeline Steps at click time, so clicking before SWR resolved built
one blank row that nothing re-populated.

Gate the **click** on the data, not the assertion — and register the waiter *before* the
navigation that triggers the request, or you've just moved the race:

```ts
const loaded = page.waitForResponse((r) => r.url().includes("/bookings/x/") && r.ok());
await page.goto("/quotes/new");
await loaded;
await page.getByRole("button", { name: "…" }).click();
```
