# Event guest count — primary number, optional gents/ladies split

## User story
As a catering salesperson, I want to record an event's guest count as one number
(with the gents/ladies split as optional detail), so that pricing never depends
on a breakdown I don't have yet, and the kitchen still gets per-category
portions when I do have it.

## Background
Events had no guest count of their own — every total was derived from
gents + ladies. That forced fake 50/50 splits into the data (lead → quote →
event conversions invented them) and made an event with no split show £0 food.
Quotes already work the right way round (guest_count primary); this brings
events in line.

## Rules
- Guest count is required on every event and drives all money math (food
  total, per-guest add-on items) and every display.
- The gents/ladies split is optional. When entered, gents + ladies must equal
  the guest count exactly (validated on the form and the API).
- Changing the guest count clears an existing split — the form asks for it
  again rather than silently scaling it.
- Kitchen portions: with a split, each category follows its own portion rule
  (unchanged). With no split, all guests follow ONE category's rule — which
  category is an org setting (Settings → General, admin/owner only), default
  "standard (gents)".
- Quote → event conversion copies the quote's guest_count directly, and copies
  the split only when the quote has one that adds up. No more fabricated
  ceil/floor splits.
- Existing events are backfilled with guest_count = gents + ladies; their
  splits are kept.
- A split-less event just shows "150 guests" (event page, lists, PDFs) — no
  warnings.

## Out of scope
- Leads and quotes keep their current shape.
- Custom guest categories (kids, seniors, …) with their own multipliers —
  possible future step.

## Acceptance criteria
- [ ] Event create/edit has a "Guest count" field; gents/ladies is a collapsed
      optional section showing "Not specified" until opened.
- [ ] A split that doesn't add up to the guest count cannot be saved (clear
      inline message).
- [ ] Editing the guest count resets the split to "Not specified".
- [ ] Event food total = price per head × guest count, split or no split.
- [ ] Per-guest add-on line items multiply by guest count.
- [ ] Portion calculation with a split matches today's behaviour exactly.
- [ ] Portion calculation with no split uses the org's default category rule.
- [ ] Settings → General shows the default-portion-rule picker to admin/owner
      only.
- [ ] Accepting a quote with no real split produces an event with the quote's
      guest count and no split (not a fabricated 50/50).
- [ ] Existing events show the same numbers as before the migration.

## Manual test cases

### TC1 — Create an event with just a number
**Steps:**
1. Events → New event. Fill the basics, set Guest count = 150, price per head = 40. Leave the split untouched.
2. Save, then reopen the event.
**Expected:** Food total shows 6,000 (150 × 40). Guest section reads "150 guests", split "Not specified".

### TC2 — Add a split that adds up
**Steps:**
1. Edit the TC1 event. Open the guest split, enter Gents 80 / Ladies 70.
2. Save and reload.
**Expected:** Saves cleanly; page shows 150 guests with the 80/70 split. Food total unchanged (6,000).

### TC3 — Split that doesn't add up is rejected
**Steps:**
1. Edit the event, set Gents 80 / Ladies 60 (= 140 ≠ 150).
2. Try to save.
**Expected:** Inline error that the split must add up to 150; save blocked.

### TC4 — Changing the count clears the split
**Steps:**
1. On the TC2 event (80/70), change Guest count to 200.
**Expected:** Split resets to "Not specified"; saving keeps count 200 with no split. Food total 8,000.

### TC5 — Kitchen portions without a split (default rule)
**Steps:**
1. In Settings → General (as owner/admin), confirm the default portion rule is "Standard (gents)".
2. On a split-less event with dishes, run the portion calculation.
3. Compare with a same-size event that has an all-gents split.
**Expected:** Identical portions. Switching the org setting to "Ladies" and recalculating gives the ladies-multiplier portions instead.

### TC6 — Per-guest add-on items use the count
**Steps:**
1. On a 150-guest split-less event, add a per-guest line item at 2.00.
**Expected:** Line total 300.00; event total updates accordingly.

### TC7 — Quote → event conversion, no fabricated split
**Steps:**
1. Create a lead with guest estimate 101, convert to quote, set a price per head, accept the quote.
2. Open the created event.
**Expected:** Event shows 101 guests, split "Not specified" (not 51/50). Event total equals the quote total.

### TC8 — Quote with a real split carries it
**Steps:**
1. Create a quote with 100 guests split 60/40 in the editor, accept it.
**Expected:** Event shows 100 guests with the 60/40 split.

### TC9 — Existing events unchanged after migration
**Steps:**
1. Before upgrading, note an existing event's guest numbers and total.
2. Upgrade (migration runs), reopen the event.
**Expected:** Same total; guest count shows the old gents + ladies sum; the old split still displayed.

### TC10 — Settings gating
**Steps:**
1. Log in as a manager (not admin/owner), open Settings.
**Expected:** The default-portion-rule setting is not editable/visible per existing settings gating.
