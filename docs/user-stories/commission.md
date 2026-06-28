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

> **Where the rep sees their targets:** the gamified target/commission view (hero,
> commission breakdown, "This year" card) renders at the **top of the dashboard**
> for salespeople — there is no separate *My Targets* page (`/commission` redirects
> to `/`). Managers/admins/owners do **not** see this personal panel; they get the
> team-wide **Performance vs target** card (TC7) instead.

### TC6 — "This year" card (calendar vs fiscal year)
1. Settings → Commission → **Financial year starts** = January (calendar). Three confirmed events for the rep: this month, earlier this calendar year, and last calendar year.
   **Expected:** as a salesperson, the **This year** card at the top of the dashboard shows the sum of the two events in the current calendar year, label `2026`.
2. Change **Financial year starts** = April. Reload the dashboard.
   **Expected:** the card now sums only events on/after 1 April of the current financial year; label `FY 2026/27`. Yearly targets follow the same window.

### TC7 — Dashboard: performance vs target (manager)
1. Sign in as a manager/owner. Ensure one or more reps have a non-zero `SalesTarget`.
2. Open the **Dashboard**.
   **Expected:** a **Performance vs target** card lists each rep with a target, sorted by attainment, each with a progress bar, `%`, `revenue of target`, and the period label. Reps without a target are omitted. A 🎉 + green bar shows at/above 100%.
3. Sign in as a salesperson and hit `/api/bookings/dashboard/stats/`.
   **Expected:** 403 (manager-only).

### TC8 — Period-wise targets grid (seasonality)
Targets are set per **period**, not as one flat number. The grid's shape follows
the org's `target_period` + `fiscal_year_start_month`: yearly → 1 column, quarterly
→ 4, monthly → 12; columns are labelled/ordered by the financial year (e.g. a July
fiscal year shows Jul → Jun). A rep's row total is their annual target; a column
total is the team's target for that period.
1. Settings → Commission → period = Monthly, financial year = July. The **Targets**
   grid shows rows = salespeople, 12 columns Jul…Jun, row totals + a Team totals row.
2. Enter a rep's monthly figures (e.g. 7.5M Jul, 20M Dec). The row total updates.
   **Expected:** `PUT /api/bookings/settings/sales-targets/ {user, fiscal_year, period_index, amount}`
   upserts the cell; the rep's commission/attainment for the **current** month compares
   revenue to **that month's** target (not a flat number).
3. Change period to Quarterly → grid shows 4 columns; to Yearly → 1 column.
4. Use the ◀ ▶ year nav to edit a different financial year (`?fiscal_year=YYYY`).
5. Assign a rep's plan via the row's plan dropdown
   (`PUT /api/bookings/settings/rep-plans/ {user, plan}`).
