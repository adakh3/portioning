---
name: frontend-form-tests
description: Write a page-level integration test that renders a real create/edit form, drives it through the UI, and asserts the payload sent to the API
user_invocable: true
---

# Frontend Form Integration Test

Write (or extend) an integration test for a create/edit **page** that renders the
real component, fills its fields through the UI, submits, and asserts the object
passed to `api.create*`/`api.update*`. This exists because unit tests of pure
helpers pass while the **page fails to wire a field into state or forgets a prop** —
the exact class of bug that only ever surfaced in manual testing (guest split not
saved, timeline times dropped, blank meal label rejected, empty event date).

**Golden rule:** if a change touches a form's fields or its save payload, it needs
one of these tests. Unit-testing the payload builder is not enough — the wiring is
where bugs live.

## When to use

- A new create/edit page, or a new field on an existing form.
- Any change to what a form sends (`buildQuoteSavePayload`, inline create payloads,
  `buildEventSavePayload`, meal/line-item mapping).
- A bug found by manual testing in a form → reproduce it here first, then fix.

## Reference examples (copy these)

- `frontend/app/quotes/[id]/page.create.test.tsx` — create flow (id `"new"`).
- `frontend/app/quotes/[id]/page.test.tsx` — edit flow (loads a mock record).
- `frontend/app/events/[id]/page.create.test.tsx` — event create (+ `CustomerSelect` stub).

## Recipe

1. **Hoist the spies** so `vi.mock` factories can use them:
   ```ts
   const h = vi.hoisted(() => ({ createQuote: vi.fn(), push: vi.fn() }));
   ```
2. **Mock `next/navigation`** — `useParams` returns `{ id: "new" }` for create or a
   real id for edit; `useRouter` returns `{ push: h.push }`. Add `useSearchParams`
   (`{ get: () => null }`) if the page uses it (the event page does).
3. **Stub heavy children** that pull their own data hooks:
   `vi.mock("@/components/MenuBuilder", () => ({ default: () => null }))`. Also stub
   `DealWonDialog` (events) and `CustomerSelect` (render a `<button>` that calls
   `onChange("<id>")`, since the event save requires a customer).
4. **Mock `@/lib/hooks`** — return `{ data: ... }` for every hook the page imports
   (missing one throws `No "useX" export is defined`). Include `useSiteSettings`
   with `currency_symbol`, `date_format`, `price_rounding_step`, `default_tax_rate`.
5. **Mock `@/lib/api`** — the create/update fn records args and resolves a record
   with an `id` (the page navigates to it): `(...a) => { h.createQuote(...a); return Promise.resolve({ id: 99 }); }`.
6. **Import the page AFTER the mocks**, then in the test: `render`, drive fields with
   `fireEvent.change`/`click`, click the submit button, `await waitFor(() => expect(h.fn).toHaveBeenCalledTimes(1))`, and assert the payload:
   ```ts
   const payload = h.createQuote.mock.calls[0][0] as Record<string, unknown>;
   expect(payload.gents).toBe(20);
   ```

## Targeting inputs

Prefer `screen.getByLabelText("...")`. If an input has a visible `<label>` that
isn't associated (no `htmlFor`), **add an `aria-label`** to the input in the shared
component — it fixes both accessibility and test targeting. The guest/timeline/meal
inputs already have them (`Total Guests`, `Setup Time`, `Additional meal time`).
For date-anchored times, assert the anchor: ``expect(payload.setup_time).toBe(`${todayISO()}T10:00`)``.

## What to assert (cover the known bug classes)

- **Guest split**: Total Guests `40` → payload `gents: 20, ladies: 20, guest_count: 40`.
- **Event date default**: not empty (`todayISO()`), so it never hits "Date has wrong format".
- **Timeline**: a time input → anchored to the event date, in the payload.
- **Additional meal**: added meal is in `additional_meals` with the inherited guest
  count, a blank label allowed, and its time anchored.
- Any field the change touched.

## Run

```bash
cd frontend && npx vitest run "app/<area>/[id]/page.create.test.tsx"   # single
cd frontend && npm run test:run                                        # all
```

Then verify types: `cd frontend && npx tsc --noEmit`.
