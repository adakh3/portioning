# Linear archive — Event Management System (Done)

> Snapshot of **completed** Linear issues, captured before deleting them from Linear (free-plan issue limit). This is the audit trail: what was built and when. The code + git history remain the source of truth for implementation detail.

> Captured: 2026-06-26 · Team: Relogue · Project: Event Management System · 40 issues.

> Descriptions over 500 chars are truncated here (Linear's API limit on list); the original full spec is in each issue's Linear URL until deletion, and the feature itself lives in the repo.


## Summary

| ID | Title | Completed | Labels |
|----|-------|-----------|--------|
| REL-342 | Deal Won celebration moment (screen 04) | 2026-06-26 | — |
| REL-245 | Security Hardening: Pre-Production Audit Fixes | 2026-06-16 | Bug |
| REL-282 | Twilio WhatsApp integration — backend + frontend | 2026-06-16 | — |
| REL-259 | WhatsApp to CRM integration | 2026-06-16 | — |
| REL-228 | Delta from our current booking system | 2026-03-14 | — |
| REL-247 | budget numeric field for leads | 2026-03-08 | — |
| REL-240 | assign leads to a user | 2026-03-08 | — |
| REL-251 | Replace lead detail read-only/edit toggle with always-editable auto-save | 2026-03-08 | — |
| REL-257 | CRM management dashboard: lead activity, team performance & period filters | 2026-03-06 | — |
| REL-253 | audit trail | 2026-03-06 | — |
| REL-218 | Dashboard page | 2026-03-02 | Epic: Integration & Polish, Feature |
| REL-223 | Currency settings | 2026-03-02 | — |
| REL-229 | A simpler pricing model option | 2026-03-02 | — |
| REL-225 | Renamig | 2026-03-02 | — |
| REL-200 | Quote accept → Event creation service | 2026-02-27 | Epic: Event Operations, Feature |
| REL-217 | Navigation and layout updates | 2026-02-12 | Epic: Integration & Polish, Feature |
| REL-197 | Quote builder frontend | 2026-02-12 | Epic: Sales Pipeline, Feature |
| REL-196 | Lead pipeline frontend | 2026-02-12 | Epic: Sales Pipeline, Feature |
| REL-190 | Account management frontend | 2026-02-12 | Epic: Foundation & CRM, Feature |
| REL-215 | Invoice API endpoints | 2026-02-12 | Epic: Invoicing, Feature |
| REL-214 | Invoice generation service | 2026-02-12 | Epic: Invoicing, Feature |
| REL-210 | Equipment API endpoints | 2026-02-12 | Epic: Equipment, Feature |
| REL-206 | Staff API endpoints | 2026-02-12 | Epic: Staffing, Feature |
| REL-195 | Quote API endpoints | 2026-02-12 | Epic: Sales Pipeline, Feature |
| REL-194 | Lead API endpoints | 2026-02-12 | Epic: Sales Pipeline, Feature |
| REL-189 | Account/Contact/Venue API endpoints | 2026-02-12 | Epic: Foundation & CRM, Feature |
| REL-213 | Payment model | 2026-02-12 | Epic: Invoicing, Feature |
| REL-212 | Invoice model | 2026-02-12 | Epic: Invoicing, Feature |
| REL-209 | EquipmentReservation model | 2026-02-12 | Epic: Equipment, Feature |
| REL-208 | EquipmentItem model | 2026-02-12 | Epic: Equipment, Feature |
| REL-205 | Shift model | 2026-02-12 | Epic: Staffing, Feature |
| REL-204 | StaffMember model | 2026-02-12 | Epic: Staffing, Feature |
| REL-203 | LaborRole model | 2026-02-12 | Epic: Staffing, Feature |
| REL-193 | QuoteLineItem model | 2026-02-12 | Epic: Sales Pipeline, Feature |
| REL-192 | Quote model | 2026-02-12 | Epic: Sales Pipeline, Feature |
| REL-191 | Lead model | 2026-02-12 | Epic: Sales Pipeline, Feature |
| REL-188 | Venue model | 2026-02-12 | Epic: Foundation & CRM, Feature |
| REL-187 | Contact model | 2026-02-12 | Epic: Foundation & CRM, Feature |
| REL-186 | Account model | 2026-02-12 | Epic: Foundation & CRM, Feature |
| REL-185 | Create bookings Django app | 2026-02-12 | Epic: Foundation & CRM, Feature |

## Details

### REL-342 — Deal Won celebration moment (screen 04)

- **Completed:** 2026-06-26  ·  **Created:** 2026-06-18  ·  **Priority:** Medium  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-342/deal-won-celebration-moment-screen-04
- **Parent:** REL-335

Celebration modal on lead→won (concept screen 04): confetti, commission banked + season total, points breakdown (base / streak bonus / big-deal), level progress, quest progress nudge, Claim & continue + Share. Triggered when a lead transitions to won.

Depends on REL-339 (ledger for the points breakdown) + REL-337 (engine).

---

### REL-245 — Security Hardening: Pre-Production Audit Fixes

- **Completed:** 2026-06-16  ·  **Created:** 2026-03-04  ·  **Priority:** Urgent  ·  **Labels:** Bug
- **Linear:** https://linear.app/relogue/issue/REL-245/security-hardening-pre-production-audit-fixes

## Security Audit Summary

Full-stack security audit before user rollout. **2 Critical, 7 High, 7 Medium, 5 Low** findings across backend and frontend.

### Critical
1. **Hardcoded SECRET_KEY fallback** — `backend/portioning/settings.py:30`. Remove the `django-insecure-*` default; raise `ImproperlyConfigured` if `SECRET_KEY` is missing.
2. **Verify backend cookie security flags** — `backend/users/views.py`. JWT cookies must be `HttpOnly=True`, `Secure=True` (prod), `SameSite=Lax`.

### High
3. **DEBUG defaults to True** — `settings.py:33`. Default to `False`.
4. **Missing CSRF protection for cookie-based JWT** — set `CSRF_COOKIE_SECURE`, `CSRF_TRUSTED_ORIGINS`; frontend sends `X-CSRFToken` on mutating requests.
5. **No rate limiting or pagination** — add DRF `PageNumberPagination` (PAGE_SIZE 50) + Anon/User throttles.
6. **No security headers in Next.js** — add CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy via `next.config.ts` `headers()`.
7. **No server-side route protection** — add `frontend/middleware.ts` to redirect unauthenticated users before render.
8. **Unvalidated integer conversions** — `calculator/views.py:190-191`, `menus/views.py:120-121`. Use serializer validation.
9. **Raw API error messages exposed** — `lib/api.ts:44,52`. Return generic messages for 500s.

### Medium
10. Explicit `permission_classes` on all calculator views.
11. Missing prod security settings (`SECURE_HSTS_SECONDS`, `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, HSTS subdomains, `X_FRAME_OPTIONS='DENY'`), gated on `not DEBUG`.
12. File-upload validation in lead import (`bookings/admin.py:96-113`) — size limit + MIME check.
13. Validate `ALLOWED_HOSTS` in production (raise if unset when `DEBUG=False`).
14. Overly broad `except Exception` — `bookings/admin.py:124-126`, `users/views.py:102-106`.
15. Client-side auth race condition — addressed by `middleware.ts` (item 7).
16. Form inputs lack `maxLength` constraints (frontend + backend length validation).

### Low
17. No security event logging (failed logins, permission denials).
18. Confirm `.env` is in `.gitignore`.
19. Query-parameter validation on filters (`bookings/views/leads.py:43-68`).
20. URL parameter parsing in `frontend/app/calculate/page.tsx:31-32` (NaN check).
21. Run dependency audits (`pip-audit`/`safety`, `npm audit`).

**Verification:** `python manage.py check --deploy`, `npm audit`, `pip-audit`, end-to-end CSRF test, securityheaders.com after deploy.

---

### REL-282 — Twilio WhatsApp integration — backend + frontend

- **Completed:** 2026-06-16  ·  **Created:** 2026-03-13  ·  **Priority:** High  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-282/twilio-whatsapp-integration-backend-frontend

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Overview

Integrate Twilio WhatsApp API for sending messages to lead contacts from the CRM.

## Backend

* **WhatsAppMessage model** — track sent messages (status, Twilio SID, delivery timestamps, errors), linked to Lead and optionally Reminder
* **OrgSettings extension** — add `twilio_account_sid`, encrypted `twilio_auth_token`, `twilio_whatsapp_number`, `whatsapp_enabled` fields
* **Encryption service** — Fernet-based encryption for storing… (truncated, use `get_issue` for full description)

---

### REL-259 — WhatsApp to CRM integration

- **Completed:** 2026-06-16  ·  **Created:** 2026-03-07  ·  **Priority:** Medium  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-259/whatsapp-to-crm-integration

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Overview

Integrate WhatsApp so that conversations with leads/contacts are visible inside the CRM, and outbound messages (notifications, follow-ups) can be sent via WhatsApp.

## Requirements

* Connect to WhatsApp Business API (Meta Cloud API or third-party provider like Twilio, 360dialog)
* Inbound messages from a contact are logged against their lead/account
* Outbound messages can be sent from the lead detail page
* Conversation history v… (truncated, use `get_issue` for full description)

---

### REL-228 — Delta from our current booking system

- **Completed:** 2026-03-14  ·  **Created:** 2026-02-28  ·  **Priority:** Urgent  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-228/delta-from-our-current-booking-system

_(no description)_

---

### REL-247 — budget numeric field for leads

- **Completed:** 2026-03-08  ·  **Created:** 2026-03-05  ·  **Priority:** Medium  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-247/budget-numeric-field-for-leads

_(no description)_

---

### REL-240 — assign leads to a user

- **Completed:** 2026-03-08  ·  **Created:** 2026-03-03  ·  **Priority:** Urgent  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-240/assign-leads-to-a-user

_(no description)_

---

### REL-251 — Replace lead detail read-only/edit toggle with always-editable auto-save

- **Completed:** 2026-03-08  ·  **Created:** 2026-03-05  ·  **Priority:** High  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-251/replace-lead-detail-read-onlyedit-toggle-with-always-editable-auto

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Problem

The lead detail page (`/leads/[id]`) shows a read-only view first, then requires clicking "Edit Details" to enter edit mode with a Save/Cancel form. This extra step is unnecessary — modern CRM tools (Linear, Notion, Attio) open records in an always-editable state with field-level auto-save.

## Scope (Leads only for now)

* Remove the read-only / edit toggle — page always renders editable fields
* Each field auto-saves independently:… (truncated, use `get_issue` for full description)

---

### REL-257 — CRM management dashboard: lead activity, team performance & period filters

- **Completed:** 2026-03-06  ·  **Created:** 2026-03-06  ·  **Priority:** High  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-257/crm-management-dashboard-lead-activity-team-performance-and-period

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Overview

Build a management dashboard on the CRM home page that gives a real-time overview of lead activity, pipeline movement, and team member performance.

## Requirements

### 1\. Lead Activity Summary

* New leads created in the selected period
* Leads moved between statuses (e.g. New → Contacted, Qualified → Proposal Sent)
* Leads won (converted)
* Leads lost / cancelled
* Total active leads in pipeline

### 2\. Period Filters

* Toggle… (truncated, use `get_issue` for full description)

---

### REL-253 — audit trail

- **Completed:** 2026-03-06  ·  **Created:** 2026-03-05  ·  **Priority:** No priority  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-253/audit-trail

Tracking on the trail of changes so that we can know what a user made, what change, especially with critical changes to our forms

---

### REL-218 — Dashboard page

- **Completed:** 2026-03-02  ·  **Created:** 2026-02-12  ·  **Priority:** Low  ·  **Labels:** Epic: Integration & Polish, Feature
- **Linear:** https://linear.app/relogue/issue/REL-218/dashboard-page

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 7.2

Build a dashboard home page with key metrics and upcoming items.

### Widgets

1. **Upcoming Events** — Next 7 days, with event name, date, guest count, status
2. **Open Leads** — Count by status (new, contacted, qualified)
3. **Pending Quotes** — Quotes in draft/sent status with expiry warnings
4. **Outstanding Invoices** — Total balance due, overdue count, overdue amount
5. **Equipment Alerts** — Items with low availability for u… (truncated, use `get_issue` for full description)

---

### REL-223 — Currency settings

- **Completed:** 2026-03-02  ·  **Created:** 2026-02-27  ·  **Priority:** No priority  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-223/currency-settings

Currency should be a per-organisation thing that can be set up for the whole organisation by a system admin through Django settings.

---

### REL-229 — A simpler pricing model option

- **Completed:** 2026-03-02  ·  **Created:** 2026-02-28  ·  **Priority:** High  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-229/a-simpler-pricing-model-option

At the moment pricing is done based off of the actual portioning calculation. There could be an argument made for simple pricing, where for each set of menus there could be kind of three tiers:

1. Simple
2. Medium
3. Extensive

 Maybe a fourth year, super extensive. Pricing is done based off of set prices for those menus and then there could be prices for add-ons or simple replacements instead of pricing based on portioning.

---

### REL-225 — Renamig

- **Completed:** 2026-03-02  ·  **Created:** 2026-02-27  ·  **Priority:** Urgent  ·  **Labels:** —
- **Linear:** https://linear.app/relogue/issue/REL-225/renamig

Now that this application is not just a portioning calculator but a full kind of event management system, we should rename this. Also the primary link on the homepage probably shouldn't be portioning. It should have options for users, different kinds of users, to either start the portioning journey or the CRM journey, etc.

---

### REL-200 — Quote accept → Event creation service

- **Completed:** 2026-02-27  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Event Operations, Feature
- **Linear:** https://linear.app/relogue/issue/REL-200/quote-accept-event-creation-service

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 3.3

Implement quote accept → Event creation.

### Status: Done (superseded by REL-222)

This functionality was implemented inline in `QuoteTransitionView` (`backend/bookings/views/quotes.py`) rather than as a separate service file. When a quote transitions to "accepted", an Event is auto-created with all data copied from the quote (name, date, guests, account, contact, venue, event type, service style, price per head, menu/dishes, stat… (truncated, use `get_issue` for full description)

---

### REL-217 — Navigation and layout updates

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Integration & Polish, Feature
- **Linear:** https://linear.app/relogue/issue/REL-217/navigation-and-layout-updates

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 7.1

Update the application navigation and layout to accommodate all new sections.

### Navigation Structure

```
CRM
  ├── Accounts
  ├── Leads
  └── Quotes

Operations
  ├── Events
  ├── Staff
  └── Equipment

Finance
  └── Invoices
```

### Changes

* Update `frontend/app/layout.tsx` with grouped navigation sections
* Add section headers / dividers in sidebar/nav
* Active state highlighting for current section
* Mobile-responsive nav… (truncated, use `get_issue` for full description)

---

### REL-197 — Quote builder frontend

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Sales Pipeline, Feature
- **Linear:** https://linear.app/relogue/issue/REL-197/quote-builder-frontend

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 2.7

Build frontend pages for quote management and the line item editor.

### Pages

* `/quotes` — Quote list with status tabs (Draft | Sent | Accepted | Expired | Declined)
* `/quotes/new` — Create quote wizard:
  1. Select account (or create new)
  2. Event details (date, type, venue, guest count, service style)
  3. Add line items (food, beverage, rental, labor, fees, discounts)
  4. Review pricing summary → Save as draft
* `/quotes/… (truncated, use `get_issue` for full description)

---

### REL-196 — Lead pipeline frontend

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Sales Pipeline, Feature
- **Linear:** https://linear.app/relogue/issue/REL-196/lead-pipeline-frontend

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 2.6

Build frontend pages for lead management.

### Pages

* `/leads` — Lead list with status filter tabs (New | Contacted | Qualified | Converted | Lost)
* `/leads/new` — Quick create form for new inquiry
* `/leads/[id]` — Lead detail with:
  * Contact info
  * Event details (date, type, style, guest estimate)
  * Status timeline
  * "Convert to Quote" button (when qualified)
  * Notes

### Components

* `LeadCard.tsx` — List item show… (truncated, use `get_issue` for full description)

---

### REL-190 — Account management frontend

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Foundation & CRM, Feature
- **Linear:** https://linear.app/relogue/issue/REL-190/account-management-frontend

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 1.6

Build frontend pages for account, contact, and venue management.

### Pages

* `/accounts` — Account list with search and type filter
* `/accounts/[id]` — Account detail with contacts list, booking history
* `/venues` — Venue list with search

### Components

* `AccountCard.tsx` — List item card showing name, type, contact count
* `ContactForm.tsx` — Inline form for adding/editing contacts
* `VenueSelector.tsx` — Dropdown/search fo… (truncated, use `get_issue` for full description)

---

### REL-215 — Invoice API endpoints

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Invoicing, Feature
- **Linear:** https://linear.app/relogue/issue/REL-215/invoice-api-endpoints

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 6.4

Create DRF serializers and views for invoice and payment management.

### Endpoints

* `GET /api/invoices/` — List all invoices (filterable by status)
* `GET/POST /api/events/<id>/invoices/` — List/generate invoices for event
* `GET/PATCH /api/invoices/<id>/` — Invoice detail/update (limited if sent)
* `POST /api/invoices/<id>/send/` — Mark as sent
* `POST /api/invoices/<id>/void/` — Void invoice
* `GET/POST /api/invoices/<id>/paym… (truncated, use `get_issue` for full description)

---

### REL-214 — Invoice generation service

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Invoicing, Feature
- **Linear:** https://linear.app/relogue/issue/REL-214/invoice-generation-service

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 6.3

Implement `services/invoice_service.py` — business logic for generating invoices from events.

### `generate_invoice(event, invoice_type, amount=None, due_date=None)` function

1. **For deposit invoices**:
   * Default amount = 50% of quote total (configurable)
   * due_date = 14 days from issue (configurable)
   * Pull totals from event's linked quote
2. **For final invoices**:
   * amount = quote total - sum of previous invoice t… (truncated, use `get_issue` for full description)

---

### REL-210 — Equipment API endpoints

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Equipment, Feature
- **Linear:** https://linear.app/relogue/issue/REL-210/equipment-api-endpoints

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 5.3

Create DRF serializers and views for equipment management.

### Endpoints

* `GET/POST /api/equipment/` — List/create equipment items
* `GET/PATCH /api/equipment/<id>/` — Equipment detail/update
* `GET /api/equipment/<id>/availability/?date=YYYY-MM-DD` — Available quantity on date
* `GET/POST /api/events/<id>/equipment/` — List/create reservations for event
* `PATCH/DELETE /api/events/<id>/equipment/<reservation_id>/` — Update/remo… (truncated, use `get_issue` for full description)

---

### REL-206 — Staff API endpoints

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Staffing, Feature
- **Linear:** https://linear.app/relogue/issue/REL-206/staff-api-endpoints

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 4.4

Create DRF serializers and views for staff management.

### Endpoints

* `GET/POST /api/staff/` — List/create staff members
* `GET/PATCH /api/staff/<id>/` — Staff detail/update
* `GET /api/labor-roles/` — List labor roles
* `GET/POST /api/events/<id>/shifts/` — List/create shifts for event
* `PATCH/DELETE /api/events/<id>/shifts/<shift_id>/` — Update/remove shift
* `GET /api/staff/<id>/availability/?date=YYYY-MM-DD` — Check availab… (truncated, use `get_issue` for full description)

---

### REL-195 — Quote API endpoints

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Sales Pipeline, Feature
- **Linear:** https://linear.app/relogue/issue/REL-195/quote-api-endpoints

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 2.5

Create DRF serializers and views for Quote management.

### Endpoints

* `GET/POST /api/quotes/` — List/create quotes
* `GET/PATCH /api/quotes/<id>/` — Quote detail/update (blocked if sent/accepted)
* `GET/POST /api/quotes/<id>/line-items/` — List/add line items
* `PATCH/DELETE /api/quotes/<id>/line-items/<item_id>/` — Update/remove line item
* `POST /api/quotes/<id>/send/` — Mark as sent, record timestamp
* `POST /api/quotes/<id>/… (truncated, use `get_issue` for full description)

---

### REL-194 — Lead API endpoints

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Sales Pipeline, Feature
- **Linear:** https://linear.app/relogue/issue/REL-194/lead-api-endpoints

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 2.4

Create DRF serializers and views for Lead management.

### Endpoints

* `GET/POST /api/leads/` — List/create leads
* `GET/PATCH /api/leads/<id>/` — Lead detail/update
* `POST /api/leads/<id>/transition/` — Change lead status (with validation)
* `POST /api/leads/<id>/convert/` — Convert qualified lead to Quote

### Convert Action

When a lead is converted:

1. Validate lead is in `qualified` status
2. Create an Account if lead has n… (truncated, use `get_issue` for full description)

---

### REL-189 — Account/Contact/Venue API endpoints

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Foundation & CRM, Feature
- **Linear:** https://linear.app/relogue/issue/REL-189/accountcontactvenue-api-endpoints

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 1.5

Create DRF serializers and views for Account, Contact, and Venue.

### Endpoints

* `GET/POST /api/accounts/` — List/create accounts
* `GET/PATCH /api/accounts/<id>/` — Account detail/update
* `GET/POST /api/accounts/<id>/contacts/` — List/create contacts for account
* `GET/PATCH /api/contacts/<id>/` — Contact detail/update
* `GET/POST /api/venues/` — List/create venues
* `GET/PATCH /api/venues/<id>/` — Venue detail/update

### Ser… (truncated, use `get_issue` for full description)

---

### REL-213 — Payment model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Invoicing, Feature
- **Linear:** https://linear.app/relogue/issue/REL-213/payment-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 6.2

Implement the **Payment** model (money received against invoices).

### Fields

* `invoice` — FK(Invoice), related_name='payments'
* `amount` — DecimalField(10,2)
* `payment_date` — DateField
* `method` — CharField choices: `card`, `bank_transfer`, `cash`, `check`, `other`
* `reference` — CharField(200), blank (transaction ID, check number, etc.)
* `notes` — TextField, blank
* `created_at` — DateTimeField(auto_now_add)

### Post-Sa… (truncated, use `get_issue` for full description)

---

### REL-212 — Invoice model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Invoicing, Feature
- **Linear:** https://linear.app/relogue/issue/REL-212/invoice-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 6.1

Implement the **Invoice** model (bill to customer).

### Fields

* `event` — FK(Event), related_name='invoices'
* `invoice_number` — CharField(50), unique, auto-generated (e.g., INV-2026-001)
* `invoice_type` — CharField choices: `deposit`, `milestone`, `final`, `adjustment`
* `issue_date` — DateField
* `due_date` — DateField
* `subtotal` — DecimalField(10,2)
* `tax_rate` — DecimalField(5,4), default 0.20
* `tax_amount` — DecimalFi… (truncated, use `get_issue` for full description)

---

### REL-209 — EquipmentReservation model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Equipment, Feature
- **Linear:** https://linear.app/relogue/issue/REL-209/equipmentreservation-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 5.2

Implement the **EquipmentReservation** model (allocation to events).

### Fields

* `event` — FK(Event), related_name='equipment_reservations'
* `equipment` — FK(EquipmentItem), related_name='reservations'
* `quantity_out` — IntegerField
* `quantity_returned` — IntegerField, null (filled after event)
* `return_condition` — CharField choices: `pending`, `good`, `damaged`, `lost`, null
* `notes` — TextField, blank
* `created_at` — Da… (truncated, use `get_issue` for full description)

---

### REL-208 — EquipmentItem model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Equipment, Feature
- **Linear:** https://linear.app/relogue/issue/REL-208/equipmentitem-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 5.1

Implement the **EquipmentItem** model (inventory catalog).

### Fields

* `name` — CharField(200)
* `category` — CharField choices: `chafer`, `table`, `linen`, `glassware`, `cooking`, `serving`, `decor`, `transport`, `other`
* `description` — TextField, blank
* `stock_quantity` — IntegerField — total owned
* `rental_price` — DecimalField(10,2) — per unit per event
* `replacement_cost` — DecimalField(10,2), null — for damage trackin… (truncated, use `get_issue` for full description)

---

### REL-205 — Shift model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Staffing, Feature
- **Linear:** https://linear.app/relogue/issue/REL-205/shift-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 4.3

Implement the **Shift** model (staff assignment to events).

### Fields

* `event` — FK(Event), related_name='shifts'
* `staff_member` — FK(StaffMember, null, blank) — null = unassigned slot
* `role` — FK(LaborRole)
* `start_time` — DateTimeField
* `end_time` — DateTimeField
* `break_minutes` — IntegerField, default 0
* `hourly_rate` — DecimalField(8,2) — locked at assignment time
* `status` — CharField choices: `scheduled`, `confi… (truncated, use `get_issue` for full description)

---

### REL-204 — StaffMember model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Staffing, Feature
- **Linear:** https://linear.app/relogue/issue/REL-204/staffmember-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 4.2

Implement the **StaffMember** model (employees and contractors).

### Fields

* `name` — CharField(200)
* `email` — EmailField, blank
* `phone` — CharField(50), blank
* `roles` — M2M(LaborRole) — qualified roles
* `hourly_rate` — DecimalField(8,2), null — override default role rate
* `certifications` — TextField, blank (food handler, alcohol service, first aid, etc.)
* `emergency_contact` — CharField(200), blank
* `emergency_phone`… (truncated, use `get_issue` for full description)

---

### REL-203 — LaborRole model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** Medium  ·  **Labels:** Epic: Staffing, Feature
- **Linear:** https://linear.app/relogue/issue/REL-203/laborrole-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 4.1

Implement the **LaborRole** model (job categories).

### Fields

* `name` — CharField(100), unique
* `default_hourly_rate` — DecimalField(8,2)
* `description` — TextField, blank
* `is_active` — BooleanField, default True
* `created_at` — DateTimeField(auto_now_add)

### Seed Data

Create management command or fixture to seed:

* Chef
* Sous Chef
* Server / Waiter
* Bartender
* Captain / Head Waiter
* Dishwasher
* Kitchen Porter
* E… (truncated, use `get_issue` for full description)

---

### REL-193 — QuoteLineItem model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Sales Pipeline, Feature
- **Linear:** https://linear.app/relogue/issue/REL-193/quotelineitem-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 2.3

Implement the **QuoteLineItem** model (generic pricing line).

### Fields

* `quote` — FK(Quote), related_name='line_items'
* `category` — CharField choices: `food`, `beverage`, `rental`, `labor`, `fee`, `discount`
* `description` — CharField(500)
* `quantity` — DecimalField(10,2)
* `unit` — CharField choices: `per_guest`, `per_hour`, `flat`, `each`
* `unit_price` — DecimalField(10,2)
* `is_taxable` — BooleanField, default True
* `… (truncated, use `get_issue` for full description)

---

### REL-192 — Quote model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Sales Pipeline, Feature
- **Linear:** https://linear.app/relogue/issue/REL-192/quote-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 2.2

Implement the **Quote** model (versioned pricing snapshot).

### Fields

* `lead` — FK(Lead, null, blank) — origin lead
* `account` — FK(Account)
* `version` — IntegerField — auto-increment per lead/account
* `status` — CharField choices: `draft`, `sent`, `accepted`, `expired`, `declined`
* `event_date` — DateField
* `venue` — FK(Venue, null, blank)
* `guest_count` — IntegerField — guaranteed count
* `event_type` — CharField (same … (truncated, use `get_issue` for full description)

---

### REL-191 — Lead model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Sales Pipeline, Feature
- **Linear:** https://linear.app/relogue/issue/REL-191/lead-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 2.1

Implement the **Lead** model (initial inquiry / sales pipeline entry point).

### Fields

* `account` — FK(Account, null, blank) — may not have account yet
* `contact_name` — CharField(200) — if no account yet
* `contact_email` — EmailField, blank
* `contact_phone` — CharField(50), blank
* `source` — CharField choices: `website`, `referral`, `phone`, `email`, `social`, `walk_in`, `repeat`
* `event_date` — DateField, null (tentative… (truncated, use `get_issue` for full description)

---

### REL-188 — Venue model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Foundation & CRM, Feature
- **Linear:** https://linear.app/relogue/issue/REL-188/venue-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 1.4

Implement the **Venue** model (event location).

### Fields

* `name` — CharField(200)
* `address_line1` — CharField(200)
* `address_line2` — CharField(200), blank
* `city` — CharField(100)
* `postcode` — CharField(20)
* `country` — CharField(100), default 'UK'
* `contact_name` — CharField(200), blank
* `contact_phone` — CharField(50), blank
* `contact_email` — EmailField, blank
* `loading_notes` — TextField, blank (dock, access, p… (truncated, use `get_issue` for full description)

---

### REL-187 — Contact model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Foundation & CRM, Feature
- **Linear:** https://linear.app/relogue/issue/REL-187/contact-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 1.3

Implement the **Contact** model (person at an account).

### Fields

* `account` — FK(Account), related_name='contacts'
* `name` — CharField(200)
* `email` — EmailField, blank
* `phone` — CharField(50), blank
* `role` — CharField choices: `decision_maker`, `coordinator`, `billing`, `onsite`
* `is_primary` — BooleanField, default False
* `notes` — TextField, blank
* `created_at` — DateTimeField(auto_now_add)
* `updated_at` — DateTim… (truncated, use `get_issue` for full description)

---

### REL-186 — Account model

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Foundation & CRM, Feature
- **Linear:** https://linear.app/relogue/issue/REL-186/account-model

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 1.2

Implement the **Account** model (customer organization or household).

### Fields

* `name` — CharField(200), display name
* `account_type` — CharField choices: `individual`, `company`, `agency`, `venue`
* `billing_address_line1` — CharField(200)
* `billing_address_line2` — CharField(200), blank
* `billing_city` — CharField(100)
* `billing_postcode` — CharField(20)
* `billing_country` — CharField(100), default 'UK'
* `tax_id` / `va… (truncated, use `get_issue` for full description)

---

### REL-185 — Create bookings Django app

- **Completed:** 2026-02-12  ·  **Created:** 2026-02-12  ·  **Priority:** High  ·  **Labels:** Epic: Foundation & CRM, Feature
- **Linear:** https://linear.app/relogue/issue/REL-185/create-bookings-django-app

> _Description truncated to 500 chars by Linear's list API — see the Linear URL above for the full original spec._

## Story 1.1

Create the `backend/bookings/` Django app structure:

* `python manage.py startapp bookings`
* Add `'bookings'` to `INSTALLED_APPS` in [settings.py](<http://settings.py>)
* Set up URL routing at `/api/bookings/` in main [urls.py](<http://urls.py>)
* Create models directory structure:

  ```
  bookings/
  ├── __init__.py
  ├── apps.py
  ├── models/
  │   ├── __init__.py
  │   ├── accounts.py
  │   ├── venues.py
  │   ├── leads.py
  … (truncated, use `get_issue` for full description)

---
