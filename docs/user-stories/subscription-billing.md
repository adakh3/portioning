# Subscription billing (Stripe)

> Scaffold: backend `payments` app. SaaS billing for the app itself — an
> organisation pays **us** to use the product. This is separate from
> `bookings.finance` (`Invoice`/`Payment`), which is a catering business
> invoicing *its own* event clients.

## User story
As an **organisation owner**, I want to subscribe and pay for the app via Stripe,
so that my team can keep using the product, and I can manage or cancel my plan
without contacting support.

## Acceptance criteria
- [ ] Each organisation has exactly one `Subscription` row, **auto-created on
      sign-up with a 7-day no-card free trial** (`status = trialing`). Stripe is
      the source of truth for *paid* state; the row is a local mirror kept in
      sync by webhooks.
- [ ] Any authenticated member can read billing status (`GET /api/billing/subscription/`)
      so the app can gate features; only the **owner** can start checkout or open
      the billing portal.
- [ ] `has_access` is true while on a **live trial** (`trialing` and
      `trial_ends_at` in the future) and for `active` / `past_due` (dunning);
      false for an **expired trial**, `none`, `unpaid`, `canceled`.
- [ ] A **superuser** (platform staff) can extend any org's trial — via the API
      (`POST /api/billing/extend-trial/<org_id>/`) or Django admin (editable
      `trial_ends_at` + an "Extend free trial" bulk action). Extending an expired
      trial grants a full fresh window.
- [ ] Trial length is configurable via `DEFAULT_TRIAL_DAYS` (default 7).
- [ ] Webhook endpoint verifies Stripe's signature, ignores unknown event types,
      and never 500s back to Stripe.

## Endpoints
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/billing/subscription/` | any member | Current org's billing state |
| POST | `/api/billing/checkout/` | owner | Start a Stripe Checkout session → `{url}` |
| POST | `/api/billing/portal/` | owner | Open Stripe Billing Portal → `{url}` |
| POST | `/api/billing/extend-trial/<org_id>/` | superuser | Extend an org's free trial (`{days}`) |
| POST | `/api/billing/webhook/` | Stripe (unauth, signed) | Subscription lifecycle sync |

## Required environment variables
Set these in `backend/.env` (see `settings.py`):
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...        # the default plan
FRONTEND_BASE_URL=http://localhost:3000
DEFAULT_TRIAL_DAYS=7             # free-trial length on sign-up
```

## Manual test cases

### TC1 — New org starts on a free trial
**Steps:**
1. Create a brand-new org (sign-up), then `GET /api/billing/subscription/`.
**Expected:** 200; `status: "trialing"`, `has_access: true`, `trial_days_remaining`
≈ 7. A `Subscription` row was auto-created by the sign-up signal.

### TC1b — Expired trial loses access
**Steps:**
1. In Django admin, set an org's `trial_ends_at` to a past date.
2. `GET /api/billing/subscription/`.
**Expected:** `has_access: false`, `trial_days_remaining: 0` (status still
`trialing`, but expired).

### TC1c — Superuser extends a trial
**Steps:**
1. As a superuser, `POST /api/billing/extend-trial/<org_id>/` with `{"days": 14}`
   (or use the admin "Extend free trial" action).
2. `GET /api/billing/subscription/` for that org.
**Expected:** `has_access: true` again; `trial_days_remaining` reflects the new
window. A non-superuser calling the endpoint gets 403.

### TC2 — Owner starts checkout
**Steps:**
1. Configure `STRIPE_PRICE_ID` (or pass `price_id`).
2. As the owner, `POST /api/billing/checkout/`.
**Expected:** 200 with a `url` to Stripe Checkout. Completing payment in Stripe
test mode fires `customer.subscription.created`.

### TC3 — Non-owner is blocked
**Steps:**
1. As a manager/admin/chef, `POST /api/billing/checkout/` and `POST /api/billing/portal/`.
**Expected:** 403 on both.

### TC4 — Webhook syncs status
**Steps:**
1. Use the Stripe CLI: `stripe listen --forward-to localhost:8000/api/billing/webhook/`.
2. Trigger `stripe trigger customer.subscription.created`.
**Expected:** The org's `Subscription` updates (`status`, `plan_name`,
`current_period_end`). A forged/unsigned POST returns 400.

### TC5 — Past-due keeps access; canceled loses it
**Steps:**
1. Move the subscription to `past_due`, then `canceled` (via portal or CLI).
**Expected:** `has_access` true while `past_due`, false once `canceled`.

## Frontend
`/billing` page (owner-gated nav link under Admin) — shows the current plan with
a status pill, a trial countdown ("5 days left in your free trial"), and:
- **Subscribe** → `POST /api/billing/checkout/` → redirects to Stripe Checkout.
- **Manage billing** → `POST /api/billing/portal/` → redirects to Stripe Portal.
- Reads `?status=success|cancelled` on return to show a banner.
- Non-owners see a read-only "only the owner can manage billing" message.

Uses hosted Checkout, so the frontend never handles card data and needs no
Stripe publishable key — it just follows the URL the backend returns.

## Still to build
- Access gating/middleware that enforces `has_access` on protected endpoints
  (incl. a friendly "trial expired — subscribe" redirect to `/billing`).
- A superuser-facing UI for extending trials (Django admin works today).
- `stripe listen` / webhook secret wiring in deployment.
