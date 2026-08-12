# Relogue — MVP Plan

## The product in one line
**Win more catering revenue.** Relogue is an AI-first CRM for caterers: capture every
inquiry, quote in minutes, close more events, and get paid — with AI drafting the
follow-ups and triaging incoming leads.

The story is deliberately sharp and revenue-only. Kitchen operations (portioning,
staffing, kitchen prep) exist in the codebase but are **hidden behind a launch flag**
and reintroduced in a later phase — see *Deferred* below.

## Tech Stack
- **Backend**: Django + Django REST Framework + SQLite (dev) / PostgreSQL (prod)
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS
- **AI**: pluggable per task via `portioning/llm.py` (`provider:model`), Anthropic/OpenAI
- **Payments**: Stripe (subscription billing + client deposits/invoices)

---

## The revenue journey (what the MVP sells)

### 1. The inquiry lands
Inquiries from the website, WhatsApp and email arrive on one **Leads** board with the
guest count, date and budget already extracted. **AI lead triage** turns a free-text
message into a structured lead a rep can accept in one click, and flags which to chase
first.

### 2. The quote goes out
Reps build a quote from menu **pricing** in minutes, send it from their **own mailbox
or WhatsApp**, and the client signs on their phone. **AI drafting** writes the covering
message and the follow-ups, so nothing goes cold. Follow-up cadence is configurable and
can auto-generate.

### 3. You get paid
Signing turns the quote into a booked **event**. Deposits and **invoices** run through
Stripe. The **dashboard** shows the numbers that matter: performance vs target, pipeline
value, conversion rate, average days to convert, salesperson performance and lost reasons.

---

## Core surfaces (all shipped, revenue-focused)

| Area | Route | What it does |
|------|-------|--------------|
| Dashboard | `/` | Revenue KPIs, targets, pipeline, follow-up workload, per-rep performance |
| Leads | `/leads` | Kanban pipeline across statuses; AI-triaged intake |
| Follow-ups | `/follow-ups` | Review/send queue for AI-drafted follow-ups |
| Quotes | `/quotes` | Build, version, send and e-sign quotes |
| Events | `/events` | Booked events (signed quotes) |
| Calendar | `/calendar` | Booking calendar |
| Menu Pricing | `/pricing` | Price-per-head / menu pricing config (revenue lever) |
| Customers | `/customers` | Contacts |
| Businesses | `/accounts` | Business accounts |
| Venues | `/venues` | Venues |
| Invoices | `/invoices` | Customer invoices (Stripe) |
| Billing | `/billing` | App subscription (Stripe, trial gating) |

**Navigation**: a single top bar of the revenue pages above. Admin/owner tooling
(Settings, Team, Menu Templates, Equipment) lives in the top-right user menu, not the
main bar. There is no left sidebar — the top bar *is* the product story.

**Client-facing**: quotes are signed at a bare public link (`/b/<token>`), no login.

---

## AI (the edge)
- **Lead triage** — free-text inquiry → structured lead (customer, date, guests, service
  style, dietary, budget).
- **Message drafting** — client emails/WhatsApp a rep edits before sending; deterministic
  templates are always the fallback, so sending never depends on the model.
- Provider/model is a one-variable swap per task (`LLM_*` env vars).

---

## Feature flags
- **`OPERATIONS_ENABLED`** (default **off**) — gates the whole kitchen/operations suite
  (portioning calculator, kitchen events, staffing, the operations Help page). Echoed to
  the frontend as `operations_enabled` on `/api/bookings/settings/`; the frontend hides
  the nav items and redirects the routes when off. Equipment and Menu Templates are **not**
  gated — admins manage them today via the user menu.

---

## Deferred (behind `OPERATIONS_ENABLED`, a later phase)
The kitchen operations layer is built and tested but hidden while the product story stays
revenue-sharp. It returns as a distinct phase. It includes the portioning engine
(`backend/calculator/`), kitchen event views, prep/BEO surfaces and staffing. The engine
still runs internally when a signed quote becomes an event; only the **user-facing
surfaces** are hidden. Its rules live in `PORTIONING_LOGIC.md`.

---

## Verification
1. Frontend unit tests (vitest) — nav gating, route access, landing has no operations
   copy, dashboard/menu CTAs gated.
2. Backend tests (Django) — `operations_enabled` reflects the launch flag and is read-only.
3. E2E (Playwright) — landing + revenue journeys run with the flag off; the operations
   specs (`calculate`, `kitchen`, `menu-choices`, `booking-*`) run with
   `OPERATIONS_ENABLED=True` in CI so the still-present engine stays covered.
