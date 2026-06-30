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
- [ ] The trial is **card-required**. Each organisation has exactly one
      `Subscription` row, **created on sign-up with `status = none` (no access)**.
      The owner starts a **Stripe-managed 7-day trial** via Checkout (card on
      file); Stripe runs the trial and auto-converts it to `active` at day 7.
      Stripe is the source of truth; the row is a local mirror kept in sync by
      webhooks (including `trial_end` → `trial_ends_at`).
- [ ] The free trial is granted **only on an org's first subscription** — a
      returning org (resubscribing after cancel) is charged immediately, no
      second trial.
- [ ] Any authenticated member can read billing status (`GET /api/billing/subscription/`)
      so the app can gate features; only the **owner** can start checkout or open
      the billing portal.
- [ ] `has_access` is true while on a **live trial** (`trialing` and
      `trial_ends_at` in the future) and for `active` / `past_due` (dunning);
      false for an **expired trial**, `none`, `unpaid`, `canceled`.
- [ ] `has_billing_account` (a Stripe customer exists) gates the **Manage
      billing** button — there's nothing to manage before the first checkout.
- [ ] A **superuser** (platform staff) can grant/extend an org's trial as a
      local comp — via the API (`POST /api/billing/extend-trial/<org_id>/`) or
      Django admin (editable `trial_ends_at` + an "Extend free trial" bulk
      action). This is a local access grant independent of Stripe.
- [ ] **Complimentary (comp) access**: `Subscription.comped` grants full access
      with no payment, indefinitely (friendly/beta users). `has_access` is true
      whenever `comped`, regardless of status. Toggle in admin (editable column +
      "Grant/Revoke complimentary access" actions).
- [ ] **Grandfathering**: a data migration (`0003_grandfather_existing_orgs`)
      marks every org that exists at billing launch `comped=True`, so deploying
      the gate never locks out existing users. New orgs (created after) go
      through the card-required trial.
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

### TC1 — New org has no access until it subscribes (card wall)
**Steps:**
1. Create a brand-new org (sign-up), then `GET /api/billing/subscription/`.
**Expected:** 200; `status: "none"`, `has_access: false`, `has_billing_account:
false`. A `Subscription` row was created by the sign-up signal, but no trial is
granted — loading any app page returns 402 and redirects to billing (Settings →
Billing), which offers **Start your free trial**.

### TC1b — Card-required trial grants access and auto-converts
**Steps:**
1. As the owner, **Start your free trial** → complete Stripe Checkout with test
   card `4242…` (card collected; not charged yet).
2. `GET /api/billing/subscription/`.
**Expected:** `status: "trialing"`, `has_access: true`, `trial_days_remaining`
≈ 7, `has_billing_account: true`. At day 7 Stripe charges the card and the
webhook flips it to `active` (test by advancing the clock in a Stripe sandbox,
or `stripe trigger`).

### TC1c — Superuser grants a comp trial
**Steps:**
1. As a superuser, `POST /api/billing/extend-trial/<org_id>/` with `{"days": 14}`
   (or use the admin "Extend free trial" action).
2. `GET /api/billing/subscription/` for that org.
**Expected:** `has_access: true` (a local grant, independent of Stripe);
`trial_days_remaining` reflects the new window. A non-superuser gets 403.

### TC2 — First checkout requests a trial; resubscribe does not
**Steps:**
1. Configure `STRIPE_PRICE_ID` (or pass `price_id`). As the owner of a *new* org,
   `POST /api/billing/checkout/`.
2. As the owner of an org that previously subscribed (has a `stripe_subscription_id`),
   `POST /api/billing/checkout/`.
**Expected:** Both return 200 with a Checkout `url`. The first session is created
with `trial_period_days = DEFAULT_TRIAL_DAYS`; the second has no trial (charged
immediately).

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

### TC6 — Gate blocks an expired org and redirects to billing
**Steps:**
1. Expire an org's trial (admin: set `trial_ends_at` to the past).
2. As a member of that org, load any normal page (e.g. Leads).
**Expected:** API calls return `402`; the app redirects to `/billing`. The
`/billing` page itself still loads, and Subscribe / login still work. A superuser
is never blocked.

## Frontend
The billing UI lives in `components/BillingPanel.tsx` and is shown in two places:
the **Settings → Billing** tab (the in-app entry point — an **owner-only** tab;
admins reach Settings but not this tab) and the standalone **`/billing`** route
(kept because it's the Stripe Checkout return target and the paywall redirect
target — it only calls billing endpoints, which the gate exempts). It shows the
current plan with a status pill, a trial countdown ("5 days left in your free
trial"), and:
- **Subscribe** → `POST /api/billing/checkout/` → redirects to Stripe Checkout.
- **Manage billing** → `POST /api/billing/portal/` → redirects to Stripe Portal.
- Reads `?status=success|cancelled` on return to show a banner.
- Non-owners see a read-only "only the owner can manage billing" message.

Uses hosted Checkout, so the frontend never handles card data and needs no
Stripe publishable key — it just follows the URL the backend returns.

## Access gating
`payments.middleware.SubscriptionGateMiddleware` enforces `has_access` on every
`/api/` request (it runs for all views regardless of their `permission_classes`,
so the paywall can't be skipped). It resolves the user from the JWT cookie
itself (auth is cookie-JWT, so `request.user` is anonymous at middleware time).

- **Blocked** (HTTP `402`, body `{detail: "subscription_required"}`): any org
  whose subscription is inactive (expired trial / `none` / `canceled` / `unpaid`).
- **Exempt:** `/api/auth/*` (so you can log in), `/api/billing/*` (so a
  locked-out org can still reach checkout/portal/status + the webhook),
  `/api/admin/*`, and `OPTIONS` preflights.
- **Never gated:** superusers (platform staff).
- **Frontend:** `fetchApi` intercepts `402` and redirects to `/billing` (the
  billing page's own calls are exempt, so it never loops).

## Still to build
- A superuser-facing UI for extending trials (Django admin works today).
- `stripe listen` / webhook secret wiring in deployment.
