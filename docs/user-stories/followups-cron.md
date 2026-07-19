# Scheduled follow-up generation (daily cron)

**As a** salesperson,
**I want** follow-up drafts for my due leads to be waiting in the review queue
every morning without anyone pressing a button,
**so that** chasing doesn't depend on someone remembering to generate.

## How it works
- **Trigger**: a GitHub Actions workflow (`.github/workflows/followups-cron.yml`)
  POSTs hourly to `/api/bookings/cron/run-followups/` with an `X-Cron-Secret`
  header. The endpoint is disabled unless the `CRON_SECRET` env var is set on
  the backend, and 403s on a wrong secret.
- **The backend decides everything**: `run_scheduled()` runs an org when (a) AI
  follow-ups are enabled AND configured, (b) the org's **"Auto-generate every
  morning"** toggle is on (new `followup_auto_generate`, default OFF while the
  drafter is being tuned — opt in per org via
  Settings → Integrations → AI Follow-ups), (c) it's past **7am org-local
  time**, and (d) it hasn't already run that org-local day
  (`followup_last_auto_run_at` guard). Hourly calls are therefore cheap no-ops
  except the first one after 7am; a late first call (cron down all morning)
  still runs that day's batch.
- **Nothing is sent** — the cron only creates *pending* drafts for review,
  exactly like the Generate button. Manual generation stays available.
- `manage.py run_followups --scheduled` runs the same logic from a shell.

## Cadence rules the cron leans on (changed with this feature)
- **Dismissal = "skip this stage"**: a dismissed draft counts like a sent one
  for the cadence — that follow-up is never recreated, the next gap starts
  from the dismissal, and it burns `followup_max_drafts_per_lead`. A cron can
  therefore never loop on recreating a thrown-away draft.
- A lead is only ever due **one** follow-up at a time: stage = how many drafts
  were reviewed (sent or dismissed), so an ignored due lead stays due for that
  same single follow-up — nothing stacks up.
- **Terminal statuses**: leads in the built-in `won`/`lost` statuses AND any
  org-customized status flagged `is_won`/`is_lost` are never drafted for.

## Deployment (one-time, manual)
1. Set `CRON_SECRET` (any long random string) on the DigitalOcean app.
2. Add the same value as the `CRON_SECRET` GitHub repo secret.

## Acceptance criteria
- [ ] With the toggle on, drafts for due leads appear once per day after 7am
      org-local; repeated endpoint calls the same day create nothing new.
- [ ] With the toggle off, the cron never drafts for that org; the Generate
      button still works.
- [ ] A dismissed draft's lead reappears only after the *next* stage's gap,
      and never once the cap is reached.
- [ ] Wrong/missing secret → 403; `CRON_SECRET` unset → 503, endpoint inert.
- [ ] Leads in won/lost (built-in or custom-flagged) statuses are never drafted.

## Manual test cases

### TC1 — Toggle + morning run
Settings → Integrations → AI Follow-ups: "Auto-generate every morning" ON.
Run `python manage.py run_followups --scheduled` (after 7am local). Expected:
drafts appear for due leads; running it again reports 0 orgs.

### TC2 — Toggle off
Turn the toggle OFF, clear `followup_last_auto_run_at` (or next day), run
`--scheduled`. Expected: nothing generated.

### TC3 — Dismiss then wait
Dismiss a pending draft; run `--scheduled` next morning. Expected: no new
draft for that lead until the second-stage gap has passed since the dismissal.

### TC4 — Endpoint security
`curl -X POST .../api/bookings/cron/run-followups/` → 403; with the right
`X-Cron-Secret` → 200 JSON `{orgs_run, created}`.

## Automated coverage
- `bookings.test_followups.ScheduledRunTests` — morning window, once-per-day
  guard, self-healing late run, toggle respected, next-day re-run.
- `bookings.test_followups.CronEndpointTests` — secret auth, disabled state,
  happy path.
- `bookings.test_followups` dismissal tests — cap burn + stage skip.
- `bookings.test_followups.CustomTerminalStatusTests` — custom won status.
- Frontend: auto-generate toggle in the AI settings save payload
  (`app/settings/page.whatsapp.test.tsx`).
