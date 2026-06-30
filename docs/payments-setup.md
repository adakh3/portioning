# Stripe payments — setup & testing

SaaS **subscription billing for the app itself** — an organisation pays *us* to use
the product. This is separate from `bookings.finance` (`Invoice`/`Payment`), which is
a caterer invoicing *their own* event clients.

The integration uses **Stripe hosted Checkout** (the owner is redirected to
`checkout.stripe.com`) and **webhooks** to keep a local `Subscription` mirror in sync.
No card data ever touches the app, so there's **no publishable key on the frontend**.

- Code: `backend/payments/` · Frontend: `frontend/app/billing/`
- Access gating: `payments.middleware.SubscriptionGateMiddleware` (402 → `/billing`)
- User story + manual cases: `docs/user-stories/subscription-billing.md`

## Onboarding (how a customer gets an account)

**Admin-provisioned** — there is intentionally **no public self-serve signup yet**.
You create the org + owner account in **Django admin** (or invite via the in-app
**Team** page); the customer logs in, hits the card wall (402 → `/billing`), and
starts the card-required trial there. A locked-out org can always reach `/billing`
and login — the gate exempts `/api/auth/*` and `/api/billing/*` — so no Settings
access is needed to pay.

A public `/signup` page + unauthenticated `POST /api/auth/register` (org + owner →
auto-login → `/billing`) is the future self-serve path; deferred for now.

---

## 1. Environment variables

All Stripe config is read by `settings.py` from `backend/.env` (one real file, symlinked
into every worktree — set it **once** in the main checkout). `.env` is gitignored.

```
STRIPE_SECRET_KEY=sk_test_...      # Dashboard → Developers → API keys (the SECRET one)
STRIPE_PRICE_ID=price_...          # a RECURRING price (see §2)
STRIPE_WEBHOOK_SECRET=whsec_...    # from `stripe listen` (dev) or the dashboard (prod)
FRONTEND_BASE_URL=http://localhost:3000   # where Checkout/Portal redirect back to
DEFAULT_TRIAL_DAYS=7               # free-trial length granted on sign-up
```

`STRIPE_PUBLISHABLE_KEY` exists in settings but is **unused** (hosted Checkout) — leave blank.
Spaces around `=` are fine; python-dotenv strips them. Use **test-mode** keys for all dev.

## 2. One-time Stripe dashboard setup (test mode)

1. **API key** — Developers → API keys → copy the **Secret key** (`sk_test_…`) → `STRIPE_SECRET_KEY`.
2. **Product + Price** — Products → Add product → add a **Recurring** price (e.g. $50/mo) →
   open the price → copy its `price_…` → `STRIPE_PRICE_ID`.
   - A Product is *what* you sell; a Price is *how much / how often*. The app charges a **Price**.
   - Multiple plans later = multiple Prices (the checkout endpoint accepts a `price_id` per call;
     `STRIPE_PRICE_ID` is just the default).
3. **Billing Portal** — Settings → Billing → Customer portal → **activate** (else "Manage billing" errors).

## 3. Stripe CLI (for local webhooks)

```bash
brew install stripe/stripe-cli/stripe
stripe login
```

---

## 4. Run it locally (three processes)

```bash
# 1) backend  (from the worktree/main backend dir, venv active)
python manage.py runserver                       # :8000

# 2) frontend
cd frontend && npm run dev                        # :3000

# 3) webhook forwarder — leave running
stripe listen --forward-to localhost:8000/api/billing/webhook/
```

`stripe listen` prints `whsec_…` on startup — put it in `STRIPE_WEBHOOK_SECRET` and
**restart the backend** so it loads. The CLI reuses the same signing secret across runs,
so you normally set this once. Always start the backend *after* the secret is in `.env`.

> Worktree note: running the app from a worktree needs a one-time setup (own DB, a real
> `npm install`, free ports). See `docs/WORKTREE_SETUP.md`. Demo logins come from
> `python manage.py seed_demo` (`owner@demo.test` / `Owner123!`). **`seed_demo` grants the
> demo org an active subscription** so it isn't paywalled — to exercise the card wall,
> sign up / create a *fresh* org instead.

## 5. Browser walk-through

The trial is **card-required** (Stripe-managed): a new org has no access until the owner
starts the trial through Checkout. To see the wall, use a **fresh org** (the seeded Demo
Co is granted access for convenience).

1. As the owner of a brand-new org, load any page → you're redirected to billing
   (**Settings → Billing**, owner-only tab; admins don't see it). The standalone `/billing`
   route also works — it's the Stripe return + paywall redirect target.
2. Click **Start your free trial** → redirected to Stripe Checkout.
3. Enter test card **`4242 4242 4242 4242`**, any future expiry, any CVC/ZIP. The card is
   collected but **not charged** (it's a trial).
4. You're redirected back to `/billing?status=success`. The webhook
   (`customer.subscription.created`, `status=trialing`) grants access — you see the trial
   countdown + "your card will be charged when the trial ends". At day 7 Stripe charges and
   the webhook flips it to **active**.
5. **Manage billing** → Stripe Billing Portal (cancel before day 7 to avoid the charge,
   update card). Canceling syncs the org to `canceled`; `past_due` keeps access (dunning).

### Test the gate
- A brand-new org (`status=none`) is paywalled: any app API call returns **402** and the
  frontend redirects to `/billing`. `/billing` + login still work. Superusers are never gated.
- Superuser can grant/extend a comp trial: `POST /api/billing/extend-trial/<org_id>/`
  `{"days": 14}` (or the admin "Extend free trial" bulk action). Non-superusers get 403.

### Drive the webhook lifecycle without paying
```bash
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```
(These create throwaway customers Stripe-side; they only sync a *local* org if its
`stripe_customer_id` matches — i.e. an org that has been through checkout.)

### Test cards
| Card | Result |
|---|---|
| `4242 4242 4242 4242` | succeeds, no authentication |
| `4000 0025 0000 3155` | requires 3DS authentication |
| `4000 0000 0000 9995` | declined (insufficient funds) |

---

## 6. Going to production

- **Existing orgs are grandfathered.** Migration `payments/0003_grandfather_existing_orgs`
  marks every org that exists at deploy time `comped=True` (complimentary access), so the
  gate never locks out current beta / friendly users. New orgs created after deploy go
  through the card-required trial. To move a grandfathered org onto a paid plan later,
  uncheck **comped** in admin (Subscriptions) — they'll hit the card wall on their next visit.
- **Comp access** (`Subscription.comped`) is the home for friendly/free users going forward:
  grant or revoke it per-org in Django admin (editable column + bulk actions).
- **Webhook endpoint:** don't use `stripe listen` in prod. Create an endpoint in the
  Dashboard (Developers → Webhooks) pointing at `https://<your-domain>/api/billing/webhook/`,
  subscribe to `customer.subscription.created|updated|deleted`, and copy **its** signing
  secret into the prod `STRIPE_WEBHOOK_SECRET`.
- **Live keys:** swap `sk_test_…`/`price_…` for live-mode values. In the Dashboard you can
  **"Copy to live mode"** a sandbox product to recreate the Price live.
- Env vars are injected by the host (Railway/Render/etc.) as real OS env — there's no `.env`
  in prod.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Webhook returns **400** | Signature mismatch — `STRIPE_WEBHOOK_SECRET` doesn't match the running `stripe listen` (or backend not restarted after setting it). |
| Webhook **200** but no DB change | Handler couldn't match the event to a local org (`stripe_customer_id` not set yet — org hasn't been through checkout), or a handler error was swallowed (check the server log). |
| Checkout 400 / "no such price" | `sk_test_` and `price_` aren't both test-mode, or `STRIPE_PRICE_ID` is a `prod_…` not a `price_…`. |
| "Manage billing" errors | Customer portal not activated in the Dashboard. |
| Stripe objects raise `AttributeError: get` | Live deliveries are `StripeObject`s (not dicts); handlers flatten via `_to_plain_dict` before reading. Regression-tested in `payments/tests.py`. |
