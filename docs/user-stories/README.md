# User Stories & Manual Test Cases

One markdown file per feature. Each captures the **user story** (who/what/why), the
**acceptance criteria**, and **manual test cases** the user can walk through to verify
the feature end-to-end (beyond the automated suite).

**Convention:** whenever a new feature or significant change ships, add or update a file
here. Keep it test-focused — numbered cases with concrete steps and expected results.

## Index

| Feature | File | Status |
|---|---|---|
| Org-customizable lead statuses | [lead-statuses.md](lead-statuses.md) | Built — awaiting manual sign-off |
| Multi-tenant admin org visibility | [admin-org-visibility.md](admin-org-visibility.md) | Built — awaiting manual sign-off |
| Superuser org-switcher | [superuser-org-switcher.md](superuser-org-switcher.md) | Built — awaiting manual sign-off |
| Org choice-lists in Settings | [org-choice-lists.md](org-choice-lists.md) | Built — awaiting manual sign-off |
| Settings page — tabs + General config | [settings-page.md](settings-page.md) | Built — awaiting manual sign-off |
| Roles — admin tier (admin ≠ manager) | [roles-admin-tier.md](roles-admin-tier.md) | Built — awaiting manual sign-off |
| Quotes list — table view | [quotes-table.md](quotes-table.md) | Built — awaiting manual sign-off |
| Booking totals — shared engine (quotes + events) | [booking-totals.md](booking-totals.md) | Built — awaiting manual sign-off |
| Commission & target tracking (from the CRM) | [commission.md](commission.md) | Built (backend + My Commission page) — awaiting manual sign-off |
| AI follow-up drafts (agent + review queue) | [ai-followup-drafts.md](ai-followup-drafts.md) | Built — awaiting manual sign-off |
| Subscription billing (Stripe) | [subscription-billing.md](subscription-billing.md) | Built (backend + frontend + access gating) — awaiting manual sign-off |
| Event client payments (advances / part / full) | [event-payments.md](event-payments.md) | Built (backend + frontend) — awaiting manual sign-off |
| Tiered + regional subscription pricing | [tiered-regional-pricing.md](tiered-regional-pricing.md) | Built (backend + frontend) — awaiting manual sign-off |
| Follow-ups — team visibility & lead-owner assignment | [follow-ups-team-visibility.md](follow-ups-team-visibility.md) | Built — awaiting manual sign-off |

## Template

```markdown
# <Feature name>

## User story
As a <role>, I want <capability>, so that <benefit>.

## Acceptance criteria
- [ ] ...

## Manual test cases

### TC1 — <short title>
**Steps:**
1. ...
**Expected:** ...
```
