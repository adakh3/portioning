# Settings page — tabs + full General config

## User story
As an **org owner/manager**, I want the Settings page organised into **tabs** (not one
long scroll) and to be able to edit **all my org-level config in-app** — currency,
regional (date format + timezone), tax, pricing defaults, and terms — so I never need
Django admin for everyday configuration.

## Background
The Settings page was a single long page. It's now tabbed (URL-persisted via `?tab=`):
**General · Lead Pipeline · Options · Product Lines · Integrations**. The General tab is
one "General" card whose Save button is its footer. Tax rate is stored as a fraction
(0.20 = 20%) — consistent with quote/invoice tax — but presented as a percentage.

## Acceptance criteria
- [ ] Settings shows 5 tabs; switching tabs updates the URL (`?tab=…`) and persists on reload.
- [ ] General tab edits: currency symbol/code, date format, **timezone**, **tax label**, **tax rate %**, default price/head, target food cost %, price rounding, quotation terms.
- [ ] One Save button (the General card footer); disabled when there are no unsaved changes.
- [ ] Tax rate entered as a percentage (e.g. 17) is saved as the fraction (0.1700) and shown back as 17.
- [ ] Lead Pipeline tab = lead statuses; Options tab = the five choice lists; Product Lines tab = colours; Integrations = WhatsApp.

## Manual test cases

### TC1 — Tabs
**Steps:** Open Settings; click each tab.
**Expected:** Only that tab's content shows; URL gains `?tab=…`; reloading keeps the tab.

### TC2 — Save General incl. new fields
**Steps:** On General, set Timezone "Asia/Karachi", Tax Label "GST", Tax Rate "17", change a pricing field; Save.
**Expected:** "Settings saved" by the button; reload shows the saved values; Tax Rate shows **17** (stored as 0.17).

### TC3 — Dirty tracking
**Steps:** Open General without editing.
**Expected:** Save is disabled / "No unsaved changes". Editing any field enables Save.

### TC4 — Tax rate round-trip
**Steps:** Enter 7.5 as Tax Rate, Save, reload.
**Expected:** Shows 7.5 (stored 0.0750); no floating-point noise.

## Automated coverage
- Backend: `bookings/tests.py::TestSiteSettingsAPI::test_patch_tax_and_timezone` (tax label/rate fraction + timezone persist).
