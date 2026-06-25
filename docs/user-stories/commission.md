# Commission & target tracking (from the CRM)

## User story
As a **salesperson**, I want my commission and progress to target calculated automatically
from the **confirmed events** I own, so that recording bookings in the CRM is how I see
what I've earned and whether I'm on track.

As an **owner/admin**, I want to configure our commission structure per org — a flat rate
or accelerated bands keyed to target attainment, on event or booking date — so commission
is computed consistently, and crossing target is worth more (the motivator).

## Why events, not leads
A won lead is provisional; the real, closed sale is a **confirmed event** with real revenue
(`Event.total`). So commission is based on events whose status is `confirmed`, `in_progress`,
or `completed` (excludes `tentative` and `cancelled`).

## Attribution
Credit follows the event's **`assigned_to`** (a real, editable field):
- Created from a lead → set to the lead's `assigned_to`.
- Created directly → set to `created_by`.
- An admin can reassign `assigned_to` to correct the credit. Existing events were backfilled
  the same way (migration `bookings/0046`).

## Config (admin-editable, Settings → Commission)
- **Commission plans** (`CommissionPlan`, per org) — a named rate structure (e.g. by seniority):
  `commission_model` (`flat` | `accelerated`), `commission_flat_rate`, and (accelerated) its
  `CommissionBand` rows (threshold% → rate, marginal). Each org has a default plan (`is_default`).
- **Each salesperson is assigned a plan** (`SalesTarget.plan`); unassigned reps use the org's
  default plan. The rep's effective model/rate/bands come from their plan.
- **Org-wide** on `OrgSettings`: `target_period` (`monthly`/`quarterly`/`yearly`) and
  `commission_basis` (`event_date` default | `booking_date`).
- Per-rep `SalesTarget.amount` (the target).

## Scope (v1)
Derived live; no per-deal commission ledger. Endpoint: `GET /api/bookings/commission/me/`.
Not yet: in-app Settings UI (Django admin only so far), retroactive accelerator mode,
lock-rate-at-win, lifetime *commission* (lifetime revenue is shown).

## Acceptance criteria
- [ ] Flat: commission = confirmed-event revenue in period × flat rate.
- [ ] Accelerated: marginal bands; crossing target earns the higher rate only on the over-target portion.
- [ ] Only `confirmed`/`in_progress`/`completed` events count; `tentative`/`cancelled` excluded.
- [ ] Revenue is attributed to `Event.assigned_to`; reassigning moves the credit.
- [ ] `commission_basis` switches whether period membership is by event date or booking date.
- [ ] `GET /api/bookings/commission/me/` returns the logged-in rep's period summary incl. `basis`.

## Manual test cases

### TC1 — Flat commission
1. Org settings: model = Flat, flat rate = 5, period = Monthly, basis = Event date.
2. Sales target for the rep = 5,000,000.
3. A **confirmed** event with total 6,000,000, **assigned to** that rep, event date this month.
4. As the rep, GET `/api/bookings/commission/me/`.
**Expected:** revenue 6,000,000; target 5,000,000; attainment 120%; commission 300,000; deals 1.

### TC2 — Accelerated bands
1. Model = Accelerated; bands `0% → 4%`, `100% → 7%`; target 5,000,000; confirmed-event revenue 6,000,000.
**Expected:** commission 270,000 (5M @ 4% + 1M @ 7%); two-band breakdown.

### TC3 — Status filtering
1. Flat 5%. Three events this month for the rep: confirmed 1,000,000; tentative 9,000,000; cancelled 9,000,000.
**Expected:** revenue 1,000,000 (only the confirmed event); deals 1.

### TC4 — Attribution / reassignment
1. A confirmed event assigned to rep A. Check rep A's commission includes it.
2. Reassign the event's `assigned_to` to rep B.
**Expected:** the revenue/commission moves from A to B.

### TC5 — Event date vs booking date
1. One confirmed event, event date this month, booking date last month, total 1,000,000.
2. basis = Event date → counts this period (revenue 1,000,000).
3. basis = Booking date → does not count this period (revenue 0).
