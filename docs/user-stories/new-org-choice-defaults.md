# Starter dropdown defaults for a new organisation

**As a** new customer setting up their catering account,
**I want** the Event Type / Source / Service Style / Meal Type dropdowns to
already contain sensible options,
**so that** I can create my first lead/booking without first going to Settings
to build every list from scratch (and so a blank Event Type dropdown isn't a
dead, unusable control).

## What was wrong
- New orgs had **empty** non-workflow dropdowns — only workflow options (lead
  statuses, lost reasons) were seeded on org creation.
- The New Lead form's **Event Type** `<select>` had no placeholder option, so
  with zero options it rendered blank and could not be opened — looked broken.

## What it does now
- On org creation, the `post_save` signal seeds US-mainstream starter options
  (in `backend/bookings/defaults.py`): Event Types (Wedding, Corporate Event,
  Birthday Party, Anniversary, Baby/Bridal Shower, Graduation, Holiday Party,
  Fundraiser/Gala, Cocktail Party, Memorial, Other), Sources (Website,
  Referral, Google Search, Instagram, Facebook, Yelp, Repeat Customer, Other),
  Service Styles (Buffet, Plated, Family Style, Food Stations, Passed Hors
  d’oeuvres, Drop-off/Delivery), Meal Types (Breakfast, Brunch, Lunch, Dinner,
  Cocktail/Appetizers). Every option is editable/removable in Settings.
- The Event Type select gets a `-- Select --` placeholder in both the create
  and edit lead forms, so it's never a dead control even with zero options.
- **Existing orgs** (predating this) are backfilled with
  `python manage.py seed_org_choices` — idempotent, and only fills a choice
  type that is *entirely empty* for an org, so an org that curated its list
  (including deleting a default) is never re-seeded.

## Acceptance criteria
- [ ] A newly created org has non-empty Event Type / Source / Service Style /
      Meal Type dropdowns, plus its workflow options.
- [ ] The Event Type dropdown always opens and shows "-- Select --" even when
      an org has removed every event type.
- [ ] `seed_org_choices` fills an empty existing org; re-running it changes
      nothing and never re-adds an option the org deleted or renamed.
- [ ] Options remain per-org and editable in Settings; one org never sees
      another's.
- [ ] `loaddata seed.json` still succeeds (signal seeding coexists with it).

## Manual test cases

### TC1 — New org
Create a fresh org (admin) and sign in. Open New Lead. Expected: Event Type,
Source, Service Style (booking form), Meal Type all populated; Event Type
opens and shows "-- Select --" first.

### TC2 — Backfill prod
On an existing empty org run `python manage.py seed_org_choices --org "<name>"`.
Expected: dropdowns now populated. Run it again → "Done", no duplicates.

### TC3 — Curation preserved
Delete a couple of event types and rename one, then run
`seed_org_choices` again. Expected: your deletions/renames are untouched (the
type already has options, so it's skipped).

## Automated coverage
- Backend: `users.tests.NewOrgChoiceDefaultsTests` — signal seeds non-workflow
  options for a new org; backfill command is idempotent and preserves edits
  and deletions.
- Frontend: the Event Type placeholder is exercised by the existing lead
  create/edit page tests (`app/leads/[id]/page.create.test.tsx`).
