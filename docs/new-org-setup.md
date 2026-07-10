# Setting up a new organisation (runbook)

How to onboard a new customer org. Onboarding is **admin-provisioned** — there is
no public self-serve signup yet, so you create the org and its owner in **Django
admin** (`/api/admin/`). Related: `docs/payments-setup.md` (Stripe/billing),
`docs/user-stories/subscription-billing.md`.

## 1. Create the Organisation
Django admin → **Users → Organisations → Add**.
- **Name**, **slug** (unique), **country** (ISO alpha-2, defaults to `US`).

A `post_save` signal then auto-creates, for free:
- the org's **`OrgSettings`** (currency, tax, etc. — sensible defaults),
- a **`Subscription`** row with **`status = none`** (no access yet — the card wall),
- workflow **choice options** (lead statuses, lost reasons).

So you don't set up settings or a subscription by hand — just the org.

## 2. Create the owner user
Django admin → **Users → Users → Add**.
- **Email** (this is the login — there's no username), **password**.
- **Role = `owner`** — the owner is the only role that can manage billing.
- **Organisation** = the org from step 1.

(An `admin`-role user is optional. At minimum create the **owner**, because only the
owner can subscribe / manage the plan.)

Hand the owner their email + password. They can add their own team members later via
the in-app **Team** page.

## 3. Give the org access — pick one

A brand-new org starts with **no access** (`status = none`). Three ways in:

| Goal | How | Result |
|---|---|---|
| **Paying customer** | Owner logs in → hits the card wall → **Start your free trial** → Stripe Checkout | Stripe-managed **7-day trial**, then auto-bills the subscription price. Stripe runs the trial; the app mirrors it. |
| **Free forever** (friendly / beta / partner) | Admin → **Payments → Subscriptions** → tick **`comped`** (or the *Grant complimentary access* action) | Full access, **no card, no expiry**. Independent of Stripe. Untick to revoke. |
| **No-card trial period** (temporary comp) | Admin → Subscriptions → **Extend free trial** action (superuser), or set `trial_ends_at` | Local trial window; access until it lapses, then the card wall. No Stripe involved. |

For a normal paying customer you do **nothing** for the trial — the owner starts it
themselves through checkout. You only touch billing to **comp** or **extend**.

## Existing orgs (already live before billing)
The migration `payments/0003_grandfather_existing_orgs` runs once on deploy and marks
**every org that already exists** as `comped = True` — so current customers keep full
access with no card and are never locked out. Only orgs created **after** the billing
deploy go through the card wall.

## Quick reference — what each role sees with no active subscription
Everyone can log in; the app gates them to `/billing` until access is granted.
- **Owner / superuser**: can subscribe / manage billing.
- **admin / manager / chef / salesperson**: read-only "only the account owner can
  manage billing".
- **Superusers** (platform staff): never gated.

## Notes
- Access is **per-organisation**, not per-user — comping/subscribing an org frees every
  member at once.
- The subscription price and any tiers/regions are configured in admin (see
  `docs/payments-setup.md`); today it's a single flat price.
- Future: a public `/signup` page + `POST /api/auth/register` would replace step 1–2
  with self-serve — deferred for now.
