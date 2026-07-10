# Tiered + regional subscription pricing

> Extends the SaaS **subscription billing** (`payments` app): the org owner picks a
> **tier** (Starter/Pro/…), and the **amount differs by region** (purchasing-power
> pricing, e.g. cheaper in Pakistan than the US) — chosen from the org's country.
> This is org-pays-platform billing, separate from event/client payments.

## User story
As the **platform operator**, I want named subscription tiers whose price varies by
region, so I can charge appropriately in different markets; and as an **org owner**, I
want to pick a tier and pay the price for my region.

## Model (`payments`)
- **`PricingRegion`** — a group of countries billed in one currency: `code`, `name`,
  `currency_code`/`currency_symbol`, `countries` (ISO alpha-2 list), `is_default` (the
  rest-of-world fallback), `is_active`, `sort_order`.
- **`Plan`** — a tier (region-agnostic): `code`, `name`, `description`, `is_active`,
  `sort_order`.
- **`PlanPrice`** — one tier in one region → a Stripe Price: `plan`, `region`,
  `stripe_price_id`, `display_amount` (shown in UI; keep in sync with Stripe), unique
  `(plan, region)`.
- **Region resolution:** `PricingRegion.for_country(code)` → the active region listing
  that country, else the active default region, else None.

## Acceptance criteria
- [ ] All pricing is **admin-configured** (Regions, Plans, and per-region Prices — the
      latter as an inline on the Plan page).
- [ ] **`GET /api/billing/plans/`** returns the active tiers **priced for the caller's
      org region** (amount + currency), hiding any tier with no price in that region.
      Gate-exempt (a locked-out org can still see plans). Returns `[]` when nothing is
      configured.
- [ ] **Checkout takes a plan code, not a raw price id** — the server resolves the
      region-specific Stripe price from `org.country` (no client price injection). An
      unknown plan, or a plan with no price in the org's region, → 400.
- [ ] **Region is auto-derived from `org.country`** (not user-selectable), so a customer
      can't pick a cheaper region. Admin controls it by setting the org's country.
- [ ] **Graceful fallback:** with no plans configured, checkout uses the single
      `STRIPE_PRICE_ID` and the billing page shows the single Subscribe/trial button —
      today's behaviour, so nothing breaks before tiers are set up.
- [ ] The trial + comp logic is unchanged (trial still applies to the first
      subscription regardless of tier).

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/billing/plans/` | Active tiers priced for the caller's org region |
| POST | `/api/billing/checkout/` | Body `{plan: "<code>"}` → region price; empty → default price |

## Manual test cases

### TC1 — Configure tiers + regions (admin)
**Steps:** Django admin → create region **PK** (currency PKR, countries `["PK"]`) and a
**default** region (USD). Create tiers Starter + Pro; on each Plan, add a `PlanPrice` per
region (test-mode Stripe price ids + display amounts).
**Expected:** rows saved; each tier has a PK price and a default price.

### TC2 — Prices localize by org country
**Steps:** As the owner of a **PK** org (e.g. `newco`, country `PK`), open `/billing`.
Then repeat with an org whose country is `US`.
**Expected:** PK org sees the **PKR** tier prices; US org sees the **USD** prices.

### TC3 — Checkout charges the region price
**Steps:** As a PK owner, pick **Pro** → Start trial/Subscribe → Stripe Checkout.
**Expected:** the session uses Pro's **PK** Stripe price (not the US one).

### TC4 — Fallback with no tiers
**Steps:** Delete all Plans. Reload `/billing`.
**Expected:** single **Subscribe / Start your free trial** button (no picker); checkout
uses `STRIPE_PRICE_ID`.

### TC5 — Guards
**Steps:** `POST /api/billing/checkout/` with `{plan:"nope"}`; and with a plan that has no
price in the org's region.
**Expected:** 400 both times, no checkout. A non-owner is 403.

## Not in scope
- FX/currency auto-conversion (that's Stripe Adaptive Pricing — a different feature).
- Per-org region override (region is derived from country; admin sets the country).
- Storing the chosen `Plan` FK on the Subscription (the webhook syncs `plan_name` from
  the Stripe price nickname, which suffices for display).

## Where it lives
- Backend: `payments/models.py` (PricingRegion/Plan/PlanPrice + `for_country`),
  `payments/serializers.py` (PlanSerializer), `payments/views.py` (`PlansView`,
  `_resolve_checkout_price`, checkout-by-plan), `payments/urls.py`, `payments/admin.py`.
  Tests: `payments/test_pricing.py`.
- Frontend: `lib/api.ts` (`Plan` type + `getPlans` + `startCheckout(plan?)`),
  `lib/hooks.ts` (`usePlans`), `components/BillingPanel.tsx` (plan-picker). Tests in
  `app/billing/page.test.tsx`.
