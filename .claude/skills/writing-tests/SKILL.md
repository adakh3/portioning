---
name: writing-tests
description: Invoke before EVERY commit that adds or changes behavior — build the coverage MATRIX for the diff (every surface × every state) and fill the empty cells, instead of testing the one path you were looking at. Encodes the repo's test rules (mirror quote↔event, test the ON state, assert new fields, render-and-extract PDFs). Use whenever you write or review tests for a change.
---

# Writing tests — cover the matrix, not the diagonal

The failure this skill exists to stop: you test the cell you were **looking at** and
ship the rest untested. A change usually touches a **grid** — several surfaces, each
with several states — and green tests on one diagonal of that grid feel like "done"
while whole cells are unverified. (Real example: a pricing change tested the *quote*
PDF but not the *event* PDF, and asserted the sign page with a *zero* fixture so the
new rows never rendered. Both passed CI; both were holes.)

Run this **before every commit that adds or changes behavior**. It is not a
regression sweep — it is a check that *this diff's* new behavior is actually pinned by
tests.

## Step 1 — Build the matrix for THIS diff

List the two axes, from the diff, explicitly:

- **Surfaces** — every place the change is observable: pure function / engine output,
  API request payload, API response/serializer, DB-stored value, each **form**
  (create AND edit), each **display** (list, card, detail), each **document** (PDF,
  public/sign page, export), and any **mirror** (if it touches a quote, does the same
  code path exist for an event? create *and* edit? backend *and* frontend?).
- **States** — every input that changes the outcome: zero vs non-zero, on vs off,
  taxable vs not, each enum/branch, empty vs populated, loading vs loaded, first-time
  vs existing-row (migration).

Write the grid down (surfaces × states). Each cell is a claim the code makes.

## Step 2 — Map each cell to a failing-if-broken test

For every cell, ask: **is there a test that would FAIL if that cell broke?** Not "is
there a test near it" — one that actually exercises that surface in that state. Empty
cells are the deliverable: fill them, or consciously log the skip and why.

## Step 3 — Run the trap checklist (these are the cells most often left empty)

- **Mirror rule** — touch a quote path → the event needs the same test (and vice-versa);
  create → edit; backend → frontend. Mirrored code hides asymmetric coverage.
- **ON-state rule** — test the feature **turned on** (non-zero, enabled), not just that
  the page still renders with the default/off value. The off state is where your change
  does nothing.
- **New-field rule** — when you add a field to a save, the page-level integration test
  must assert **that new field** in the payload, not only the fields it already covered.
  (Field→state→payload wiring is where bugs hide — unit-testing the payload builder is
  not enough; drive the real page. See the `frontend-integration-tests` skill.)
- **Document rule** — PDF / sign-page / export changes = **render-and-extract** with a
  **non-zero** fixture (pypdf for PDFs), asserting the rendered content/order — never
  eyeball it, never assert only the zero case.
- **Money rule** — any totals/pricing math: cover the combinations (each charge on/off,
  taxable/not, discount) and keep both engines honest via the shared golden cases
  (`docs/calculation-golden-cases.json`); see CALCULATION_PARITY.
- **Existing-row rule** — additive schema / migrations: a test that an existing row
  (all-defaults) is byte-for-byte unchanged, plus the new behavior on a new row.
- **Native-control rule** — date/time/file/select inputs, or "does it survive save +
  reload": the mocked suite can't prove it — add/extend a Playwright e2e
  (`prepush-e2e-playwright`).

## Step 4 — Pick the right test type per cell

- Pure logic → unit test (Vitest / Django `TestCase`).
- Field → state → payload → **page-level integration test** driving the real page.
- PDF / document → **render-and-extract** (pypdf), assert content + order.
- Native controls / persistence / real browser → **Playwright e2e**.
- Cross-engine math → the **shared golden-cases** file (both harnesses run it).

## Anti-patterns (if you catch yourself doing these, you're on the diagonal)

- "I added a test for the quote, that's the pattern" → and left the event mirror empty.
- Asserting `renders` against a fixture where the new field is 0/off/empty.
- Extending an integration test's *setup* for a new field but not its *assertions*.
- Unit-testing the payload builder instead of the page that fills it.
- Trusting a green pre-commit run to mean "enough tests" — it only runs the tests that
  exist, never flags the ones missing.

## Output

Before committing, state the matrix briefly: the surfaces × states you enumerated,
which cells now have a failing-if-broken test, and any cell you deliberately left
uncovered (with the reason). That short note is the proof you covered the grid, not a
diagonal of it.
