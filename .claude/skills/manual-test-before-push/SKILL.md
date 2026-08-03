---
name: manual-test-before-push
description: Before pushing a NEW user-facing feature, manually test THAT feature in a REAL Chrome via the Claude-in-Chrome extension — walk every acceptance criterion, actively TRY TO BREAK it with hostile input, prove it persists, and capture a GIF as evidence. Use before pushing a new/changed feature with a visible surface (UI, a form/save, on-screen behaviour); also when the owner asks for a manual/browser test. It is a one-off pass on what's new — NOT a regression suite. Complements (does not replace) the Playwright e2e.
---

# Manual-test a NEW feature in Chrome before pushing

Green automated tests prove the wiring; they don't prove the owner would be happy
looking at the running app. Before pushing a **new or changed user-facing feature**,
drive the real app in a real browser, **walk every acceptance criterion**, **actively
try to break it**, confirm it **survives a save + reload**, and hand the owner a
**GIF** they can eyeball. This is the human-in-the-loop pass that the mocked vitest
suite and even headless Playwright can't give.

**Three things this pass must do — not one:**

1. **Walk every AC.** The ticket's numbered acceptance criteria are the checklist.
   Demonstrate each one on screen, and say per-AC what you saw. An AC you didn't
   look at is an AC you didn't verify — say so rather than implying you did.
2. **Try to break it.** The happy path is the *start*, not the test. Feed it the
   values a real person actually types when they're rushed, mid-edit, or careless.
   Bugs live in the states nobody demoed.
3. **Prove it persisted.** Save, hard-reload, and confirm the *stored* value — the
   live preview can be right while the save is wrong.

**Scope it to what's new — this is NOT a regression suite.** Exercise only the
feature (or the surface) this push introduces or changes — but exercise it
*thoroughly*, ACs and edges included. The accumulating regression coverage is the
automated suites' job (`npm run test:run` + `npm run e2e`); this skill is a single
deliberate, adversarial look at the new thing, once.

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

5. **Walk the acceptance criteria, one by one.** Open the ticket's numbered AC list
   and demonstrate each on screen. Some ACs are *negative* ("no validation fires at
   quote time", "totals are unchanged") — those need showing too: the absence has to
   be observed, not assumed. Keep a per-AC note as you go; it becomes the report.

6. **Now try to break it.** Go looking for the states nobody demos. At minimum, for
   every input the feature adds or touches:
   - **empty**, **zero**, and **negative** — and check zero and empty are treated the
     way the spec says. They are usually *not* the same thing, and conflating them is
     a recurring bug (a rate of `0.00` asserting "priced at nothing" vs blank meaning
     "not priced yet").
   - **huge** (`999999999`), **fractional** (`3.9`), **leading-zero** (`07`).
   - **junk text**, **whitespace**, and **markup** (`<img src=x onerror=alert(1)>`) —
     in free-text fields *and* in org-config values that feed the screen (segment
     names, labels). Confirm it renders as text and executes nothing.
   - **out-of-range combinations** — a breakdown that exceeds its total, a child
     count larger than the guest count. Confirm the warning appears **and** that the
     derived figures stay sane rather than going negative.
   - **the ON state** of anything optional: a booking that actually has the thing,
     not just the default empty one.

   Then scan what's on screen for **`NaN`, `Infinity`, `undefined`, `null`,
   `[object Object]`, `$0.00` where a real number was meant**, and a control that
   shifts position as a neighbour grows. Any of those is a finding.

   **Order matters.** Drive the form in the order a real user fills it, not the order
   that happens to work. A field that reads correctly when you set things
   bottom-up can be empty or wrong top-down — that is exactly how a value gets
   displayed before it can be known.

7. **Prove persistence, not just live preview.** Save, then **navigate to the view
   page fresh / hard-reload**, and confirm the value the *backend stored and rendered*
   (not the in-memory preview) is correct. Totals especially: the live editor mirror
   can be right while the saved value is wrong. Persist an **edge** value too, not
   only a tidy one.

8. **Finish the evidence:** `gif_creator stop_recording` → `export {download:true}`
   with a descriptive filename → find it in `~/Downloads` → `SendUserFile` it with a
   one-line caption of what it shows.

9. **Report** as an **AC-by-AC trace** (each AC → what you saw → pass/fail), plus what
   you threw at it in step 6 and what survived. State plainly anything you could
   **not** exercise and why — an unverified AC reported as verified is worse than an
   admitted gap. Then **ask before pushing** (main is PR-only; deploys are
   tag-triggered, not on merge — this skill never pushes on its own).

**A finding is not automatically this ticket's to fix.** If breaking it turns up a
defect in shared code — the money engine, a validator, a component you only moved —
check whether it predates your change (`git stash` your diff and reproduce). If it
does, **report and raise a ticket**; don't quietly widen a presentation branch into
the totals math, which has its own rules (CALCULATION_PARITY, golden cases). Pinning
the current broken behaviour with a `it.fails(...)` characterization test is a good
way to hand it over: green while the defect stands, and it starts failing the moment
someone fixes it.

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
