# Commission & target tracking (from the CRM)

## User story
As a **salesperson**, I want my commission and progress to target calculated automatically
from the deals I've won in the CRM, so that recording deals in the CRM is how I see what
I've earned and whether I'm on track.

As an **owner/admin**, I want to configure our commission structure per org — a flat rate
or accelerated bands keyed to target attainment — so commission is computed consistently
from won deals, and crossing target is worth more (the motivator).

## Scope (v1)
- Commission is **derived live** from CRM data (won deals); no per-deal commission ledger yet.
- Config lives on `OrgSettings` (`commission_model`, `commission_flat_rate`, `target_period`)
  plus `CommissionBand` rows (accelerated) and per-rep `SalesTarget`. Admin-editable in Django admin.
- Period is org-defined: monthly / quarterly / yearly.
- Endpoint: `GET /api/bookings/commission/me/`.
- Not yet: frontend rep view, retroactive ("cross target → bump everything") mode,
  lock-rate-at-win, per-period historical targets, lifetime commission (lifetime revenue is shown).

## Acceptance criteria
- [ ] Admin can set `commission_model` = flat or accelerated, the flat rate, and the target period.
- [ ] Admin can add accelerated bands (threshold % of target → rate) and per-rep targets.
- [ ] Flat: commission = won revenue in period × flat rate.
- [ ] Accelerated: marginal bands — revenue in each attainment band earns that band's rate;
      crossing target earns the higher rate only on the over-target portion.
- [ ] Only won deals **in the CRM** for the period count; lifetime revenue is all-time.
- [ ] `GET /api/bookings/commission/me/` returns the logged-in rep's period summary.

## Manual test cases

### TC1 — Flat commission
**Steps:**
1. Django admin → Org settings: set commission model = Flat, flat rate = 5, period = Monthly.
2. Add a Sales target for a salesperson = 5,000,000.
3. Mark a lead won this month with a won quote total of 6,000,000, assigned to that rep.
4. As that rep, GET `/api/bookings/commission/me/`.
**Expected:** revenue 6,000,000; target 5,000,000; attainment 120%; commission 300,000; deals 1.

### TC2 — Accelerated bands
**Steps:**
1. Org settings: commission model = Accelerated, period = Monthly.
2. Commission bands: `0% → 4%`, `100% → 7%`. Target = 5,000,000. Won revenue = 6,000,000.
3. GET `/api/bookings/commission/me/`.
**Expected:** commission 270,000 (5M @ 4% + 1M @ 7%); breakdown shows two bands.

### TC3 — Only the current period counts
**Steps:**
1. Flat 5%, monthly. One won deal this month (1,000,000) and one 60 days ago (2,000,000).
2. GET `/api/bookings/commission/me/`.
**Expected:** period revenue 1,000,000 (deals 1); lifetime revenue 3,000,000 (lifetime deals 2).

### TC4 — Under target (accelerated)
**Steps:**
1. Bands `0% → 4%`, `100% → 7%`, target 5,000,000, won revenue 4,000,000.
**Expected:** commission 160,000 (only the first band); attainment 80%.
