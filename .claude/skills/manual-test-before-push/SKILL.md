---
name: manual-test-before-push
description: Before pushing a NEW user-facing feature, manually test THAT feature in a REAL Chrome via the Claude-in-Chrome extension — drive the running app like a person would, prove it persists, and capture a GIF as evidence. Use before pushing a new/changed feature with a visible surface (UI, a form/save, on-screen behaviour); also when the owner asks for a manual/browser test. It is a one-off pass on what's new — NOT a regression suite. Complements (does not replace) the Playwright e2e.
---

# Manual-test a NEW feature in Chrome before pushing

Green automated tests prove the wiring; they don't prove the owner would be happy
looking at the running app. Before pushing a **new or changed user-facing feature**,
drive the real app in a real browser, watch it behave, confirm it **survives a save +
reload**, and hand the owner a **GIF** they can eyeball. This is the human-in-the-loop
pass that the mocked vitest suite and even headless Playwright can't give.

**Scope it to what's new — this is NOT a regression suite.** Exercise only the
feature (or the surface) this push introduces or changes, on its main happy path. The
accumulating regression coverage is the automated suites' job (`npm run test:run` +
`npm run e2e`); this skill is a single deliberate look at the new thing, once.

**When to run:** before pushing a change that adds or alters a visible surface — new
UI, a new/changed create/edit form or its save payload, new money/totals on screen,
new user-visible behaviour. Skip it for pure-backend/refactor/doc changes, and for
tweaks with no new visible surface. It is **in addition to** the Playwright e2e
(`npm run e2e`), not instead of it.

## Steps

1. **Bring up the real stack** (see `docs/WORKTREE_SETUP.md` for worktrees — a
   worktree needs a **real** `npm install`, not the hook's symlink):
   - backend `python manage.py runserver 8000`, frontend `npm run dev` (:3000),
     both from this worktree, in the background.
   - Demo data present: `migrate` + `loaddata seed.json` + `seed_demo`. "Demo Co" is
     the **US** demo org; if the feature depends on a country default that postdates
     the seed (e.g. the 20% service charge), run
     `python manage.py apply_country_defaults --org "Demo Co"` first.
   - Free ports 8000/3000; poll both until they answer before driving.

2. **Connect Chrome** (the extension pairs on the owner's side — you can't force it):
   - `list_connected_browsers`. If empty, ask the owner to open Chrome, click the
     Claude extension's **Connect** (same claude.ai account), and — first time — fully
     quit + reopen Chrome. Re-check.
   - When one appears, you **must** confirm via `AskUserQuestion` (list every browser
     by name + deviceId, plus the "open a confirmation screen in every extension"
     option), then `select_browser` the chosen deviceId. Never pick silently.
   - Load the browser tools in ONE `ToolSearch` call (see the Chrome MCP core set),
     adding `read_network_requests` for submit debugging.

3. **Record from the start:** `tabs_context_mcp {createIfEmpty:true}` → navigate to
   `http://localhost:3000/login` → `gif_creator start_recording` → screenshot (first
   frame). Then log in (seed_demo owner: `owner@demo.test` / `Owner123!`).

4. **Drive the feature exactly as a user would** — the same happy path a real person
   takes. Assert the **visible** outcome (the number/label/row on screen), not just
   that the page loaded.

5. **Prove persistence, not just live preview.** Save, then **navigate to the view
   page fresh / hard-reload**, and confirm the value the *backend stored and rendered*
   (not the in-memory preview) is correct. Totals especially: the live editor mirror
   can be right while the saved value is wrong.

6. **Finish the evidence:** `gif_creator stop_recording` → `export {download:true}`
   with a descriptive filename → find it in `~/Downloads` → `SendUserFile` it with a
   one-line caption of what it shows.

7. **Report** what you exercised and what you visually confirmed, then **ask before
   pushing** (main is PR-only; deploys are tag-triggered, not on merge — this skill never pushes on its own).

## Gotchas (learned the hard way)

- **Native `<select>` typeahead is unreliable** through the extension, and clicks on
  React-controlled inputs sometimes don't register. Set the value with the native
  setter and dispatch events so React's `onChange` fires:
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v)`
  (use `HTMLSelectElement` for a select) then dispatch `input` + `change`. This still
  exercises the real handler.
- **A checkbox that won't toggle by coordinate:** verify its state with `zoom`, and
  if a coordinate/ref click doesn't flip it, click the actual input via JS
  (`label.querySelector('input[type=checkbox]').click()`).
- **A submit button that does nothing** is usually a sticky footer intercepting the
  click. Confirm no request fired (`read_network_requests` for `/api/…`, or the URL
  didn't change), then submit via a direct DOM `btn.click()` and re-check the URL.
- **Never trigger a native `alert/confirm/prompt`** — it freezes the extension. Avoid
  destructive controls (Delete with a confirm); warn the owner if a step needs one.
- **Don't rabbit-hole:** if the extension errors 2–3 times or elements won't respond,
  stop and tell the owner what you tried — don't keep hammering the same action.

### Before you believe a failure, check it's your app and not the environment

These three cost a whole session's worth of false alarms. All of them look exactly
like broken code. **When something "breaks" that your unit tests say works, check
these first.**

- **HTTP 429 — the API throttle.** DRF is set to `1000/hour` per user, and one full
  Playwright run makes ~600 calls. **Two runs trip it**, after which every page
  bounces to `/login` and assertions fail on missing elements. Check with
  `grep -c 429 <backend log>`; **restarting the backend clears it** (the throttle
  counter is in local memory). CI is unaffected — it starts fresh. If you're
  re-running e2e repeatedly, expect this.
- **Port 3000 may belong to another worktree.** Several worktrees run the same app,
  and `next dev` silently falls back to another port when 3000 is taken — so your
  server is on 3001 while Playwright and Chrome drive *someone else's branch*.
  Symptom: features you just built are "missing", or you see features you didn't
  write. Always confirm the owner of the port before trusting a result:
  `lsof -a -p $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t) -d cwd`
- **Run on your own port, and never `pkill` broadly.** `pkill -f "next dev"` kills
  other sessions' servers too. Start yours explicitly (`npx next dev -p 3100`), point
  the tests at it (`E2E_BASE_URL=http://localhost:3100`), and add that origin to the
  backend: `CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3100"`.
  Without the CORS entry, login returns 200 in the server log but the browser blocks
  the response and the app never leaves `/login` — a failure that looks nothing like
  its cause.
- **The e2e suite isn't idempotent against a long-lived dev DB.** `settings-lead-statuses`
  adds a row per run and eventually fails its own strict-mode locator on the
  duplicates. Delete the leftovers (`LeadStatusOption.objects.filter(label__startswith='E2E ')`)
  or rebuild the DB before trusting a red result.
