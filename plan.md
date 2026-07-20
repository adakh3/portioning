# US Market Readiness (REL-402) — Plan Review & Execution Architecture

**Date:** 2026-07-20 · **Branch:** `competitor-gap` · **Model pass:** Fable 5 re-review of the plan as written in Linear REL-402 (+ sub-issues REL-403…407), verified against the actual code on this branch and the unmerged sibling worktrees.

> **Status update (2026-07-20, later same day):** the review below has been applied to Linear — REL-402/403/404/405/406/407 rewritten, **REL-408** created (Foundation: land payments-stripe), **REL-409** created (Wave 2b). Decisions taken: e-sign **merged to main** (PR #50, incl. wa.me sign-link send + event-canonical signatures); foundation route = **Option A** (land `payments-stripe` whole — grandfathering/comp gate verified in code). "Wave F" below is therefore superseded by REL-408, and Wave 2b gained the e-sign hardening items (auto-send signed copy, SHA-256 of signed PDF, electronic-business consent line). Part 1 is kept as the review record; Parts 2–3 remain the implementation reference alongside the Linear issues.

This document has three parts:

1. **Review of REL-402 as written** — what holds up, what is factually stale, what decisions it leaves open.
2. **Governing architecture** — the concrete mechanisms that guarantee existing organisations are untouched.
3. **Wave-by-wave execution plan** — schema, files, migrations, tests, in implementable order.

---

## Part 1 — Review of REL-402 as written

### What the plan gets right (keep as-is)

- **The wave ordering is correct.** Locale → pricing correctness → operational workflow → depth → compliance matches both the competitive evidence (`docs/COMPETITIVE_ANALYSIS.md`) and the "agents operate on the schema" constraint. Courses/BEO before compliance is the right call.
- **The default-vs-backfill trap is real and well stated.** `guest_mode` (new-org default `single`, existing-org backfill `split`) and `service_charge_default_pct` (existing-org backfill `0`) are exactly the two places a bare column default would silently change live desi orgs. This framing should survive into every migration in this doc.
- **Stored-totals-are-snapshots** is the right invariant, and (see Part 2) the codebase already has the pattern to enforce it: `Quote.tax_rate` is copied per-booking, so historical bookings don't feel org-setting changes. Service charge must copy that pattern, not just read `OrgSettings` at render time.
- **Buy-don't-build for the sales-tax engine and payment collection** — correct, no notes.
- **Compliance demoted with evidence** (no competitor has COI/exemption capture; not a buying criterion) — correct, and the "tax *number* correctness stays up" carve-out is the right exception.
- **The `/b/<token>` claim checks out** — verified: frontend `app/b/[token]/page.tsx`, backend `GET/POST /api/public/bookings/<uuid:token>/…`, `BookingSignature` with XOR quote/event constraint, signing a quote runs `accept_quote` and auto-creates the event. E-sign v1 is genuinely done on this branch (migrations `bookings/0071`, `events/0025`).

### Factual corrections (plan vs. code, verified today)

1. **"Already shipped: country-based currency/tax defaults" is NOT on main or this branch.** `users/country_defaults.py`, the US starter catalog (`seed_starter_catalog.py`), and `Organisation.country` defaulting to `US` all live **only on the unmerged `payments-stripe` worktree** (commits `3c28d69`, `ca4bf3c` — 20 commits, entangled with Stripe billing). On this branch there is *no* code anywhere that derives currency/tax/format from country. This is the single biggest gap in the plan as written: Wave 0 has an unstated dependency on either landing `payments-stripe` or extracting those commits. → resolved in Part 2, "Foundation decision".

2. **Guest segments already exist (stage 1) — and REL-404's `guest_mode` flag competes with them.** `payments-stripe` commit `686a60b` renamed `rules.GuestProfile → GuestSegment` (adds `price_multiplier`, `sort_order`, `is_default`), added `events.BookingGuestCount` (per-segment counts, quote-XOR-event like `BookingMeal`), and backfilled it from the gents/ladies columns — explicitly "the foundation for US-readiness + the agentic-AI data model", with a planned stage 2 that generalises the engine's `GuestMix` to N segments. REL-404's `guest_mode: single|split` boolean is a *narrower second abstraction over the same columns*. Building both independently gives the AI two competing schemas for the same fact. → Part 3, Wave 1 reconciles them (short version: `guest_mode` becomes a UI-level presentation flag; segments stay the data model).

3. **"Correct tax on the total" (REL-404) is already done.** Current `bookings/services/totals.py` taxes the *whole* subtotal net of discounts (the Q-59 fix, landed via the commission-engine merge); `non_taxable_subtotal` is already hard-zero. Drop this bullet from Wave 1 scope — what Wave 1 actually changes is *adding the service-charge/gratuity steps* to that pipeline.

4. **Migration collision is live right now, and it's not the one the plan mentions.** E-sign on this branch occupies `events/0025_event_public_token`. `payments-stripe` *also* occupies `events/0024_bookingguestcount` + `events/0025_backfill_guest_counts`. Whichever lands second must renumber `events/00xx` (and `payments-stripe` will also collide on `bookings/00xx` — this branch is at `bookings/0071`). The plan's "coordinate numbering" note is right but should name the landing order (Part 2).

5. **Small inaccuracies, no scope impact:**
   - PDFs don't have "gents/ladies columns" — it's a single parenthetical on the "No. of Guests" row (`bookings/pdf.py:408-410, 715-717`). Single mode = suppress the parenthetical, not a column change.
   - "8 pages + component props" for Wave 0 undercounts slightly: verified **10+ frontend files** carry inline `£`/`GBP`/`VAT`/`0.2000` fallbacks (list in Part 3, Wave 0), plus `formatCurrency`'s own `= "£"` default parameter, plus `_fmt(value, cs='£')` in `bookings/pdf.py`.
   - `Venue.country` defaults `'UK'`, `Account.billing_country` defaults `'UK'`, and `Account.vat_number` is a literally-named field — Wave 0 should catch these too (labels/defaults only; don't rename the DB column).

### Gaps the plan doesn't address (add to scope or explicitly defer)

- **Frontend locale architecture, not just a sweep.** There is no shared settings context — every page calls `useSiteSettings()` and re-invents its own `£` fallback object. Patching 10 files fixes today's leaks; the 11th page will reintroduce them. Wave 0 should ship a single **`OrgLocaleProvider`/`useOrgLocale()`** (symbol, code, tax label, date/time format, formatters) and a **guard test** that greps the source for forbidden literals (`£`, `"GBP"`, `"VAT"` outside the provider and test fixtures). That makes the fix structural, one-way.
- **REL-403's "backfill stale orgs" is the one genuinely dangerous line in Wave 0.** Existing orgs are live desi orgs whose settings may *intentionally* be UK-flavoured. Never bulk-rewrite existing `OrgSettings` from `country`. Safe rule: country-defaults apply **only in the org-creation signal**; existing orgs are touched only by an explicit, per-org, opt-in management command (`apply_country_defaults --org <name>`), run by hand for orgs known to be mis-provisioned.
- **Units are metric everywhere** (grams in the engine, help page, PDFs). US caterers think in oz/lb and headcounts. Nothing in REL-402 mentions it. Recommendation: **defer deliberately** (engine stays gram-native; a display-layer oz conversion is a bounded later task) — but write the deferral down so it doesn't look forgotten.
- **Email fallback has no infrastructure.** Wave 2 says "email fallback — mainstream-US buyers expect email", but the codebase's only outbound channel is Twilio/WhatsApp; there is no SMTP/provider config, no email service, no templates. That's a real (if small) infra sub-task, not a checkbox — named in Wave 2b.
- **WhatsApp send is lead-scoped.** `WhatsAppMessage` FKs `lead`; all send endpoints are `/leads/<pk>/whatsapp/…`. Sending a quote/BEO to a booking's contact needs the message model widened (nullable lead + quote/event refs) — small but schema-touching, named in Wave 2b.
- **Wave 2 is one issue but two shippable halves.** REL-405 itself says "may split". Do it now: **2a = schema** (courses, service style, dietary tags, buckets, timeline) and **2b = outputs** (BEO PDF, WhatsApp/email delivery, deposit fields on the contract). 2a is the AI-wedge dependency; 2b is the buyer-visible payoff.

---

## Part 2 — Governing architecture: how existing orgs stay untouched

These six mechanisms are the contract for **every** wave. A wave PR that can't tick each one doesn't merge.

### 2.1 Foundation decision — where the country/segment groundwork comes from

The plan leans on `country_defaults.py` and (implicitly, for kids/vendor buckets) guest segments — both stranded on `payments-stripe` behind Stripe billing. Three options:

| Option | What | Verdict |
|---|---|---|
| A | Merge all of `payments-stripe` to main first | Couples US-readiness to billing being prod-ready; 20 commits, biggest blast radius |
| B | **Extract the two foundation commits** (`3c28d69` country defaults + starter catalog, `686a60b` guest segments stage 1) onto a fresh `us-readiness-foundation` branch off main, renumber migrations, land alone | **Recommended.** Small, self-contained, both commits were written as foundations and have their own tests |
| C | Rebuild `country_defaults.py` fresh on the wave branch | Throws away working, tested code and guarantees a later conflict with `payments-stripe` |

**DECIDED (2026-07-20): land the rest of `payments-stripe`, tracked as REL-408.** **Corrected same day:** ancestor checks show the Stripe billing (paywall gate, card-required trial, comp/grandfathering, tiered pricing) is **already merged on main** — only the **two foundation commits** (`3c28d69`, `686a60b`) are unmerged, so Options A and B collapsed into the same small task (27 files, ~990 insertions). **Landing order:** ① e-sign — **done** (PR #50) → ② REL-408: merge origin/main into the branch, resolve mechanical conflicts (`events/models.py`, `staff/models.py`, `users/signals.py`, seed commands), renumber `events/0024–0025 → 0026–0027` and `staff/0006–0008 → 0008–0010` (rules/0006 and dishes/0006 don't collide) → ③ Wave branches, each cut from fresh `main`.

### 2.2 Flags: model default = new-org behaviour, data migration = old-org behaviour

Every behaviour-changing capability is a per-org field with **two independently chosen values**:

- **Column default** → what a *new* org gets, optionally overridden per-country by `country_defaults.py` in the `post_save` org-creation signal (`users/signals.py`) — the only place country-conditional logic lives.
- **Backfill data migration** → pins every *existing* org to today's behaviour, unconditionally (`guest_mode='split'`, `service_charge_default_pct=0`, …). Backfills are idempotent, batched (`.iterator()` + chunked `bulk_update`), and never run at import time.

New orgs in other markets lose nothing: a new desi org's country maps to split-mode, no service charge, gents/ladies segments — via the same table.

### 2.3 Money math: per-booking snapshots (the `tax_rate` pattern)

`Quote.tax_rate` already proves the pattern: the org default is **copied onto the booking at creation**, so later settings changes never touch existing bookings. Service charge and gratuity follow it exactly:

- `OrgSettings.service_charge_default_pct` etc. are *defaults for new bookings only*.
- `Quote`/`Event` get their own `service_charge_pct`, `service_charge_taxable`, `gratuity_pct` — backfilled `0`/`false` for all existing rows.
- `recalculate_totals` only runs on explicit save (already true). **No management command, migration, or signal ever batch-recalculates stored totals.** A historical booking edited later keeps its own `0%` service charge unless a human changes the field on that booking.
- `docs/calculation-golden-cases.json` only ever **appends** cases. Every existing case must pass unmodified after the pipeline change — that's the regression proof that a 0%-service-charge booking computes byte-identically.

### 2.4 Additive schema only; renderers fall back to legacy

New concepts are new nullable columns or new tables (`BookingCourse`, `BookingTimelineEntry`, `BookingGuestCount`, dietary tags, structured address fields). Never migrate `venue_address` free text, never force dish lines into courses, never convert the four legacy time fields. Every renderer (pages, PDFs, sign page, BEO) follows one rule: **if the new table is empty for this booking, render exactly what it renders today.** That sentence is a test, per wave (see 2.6).

### 2.5 Migration hygiene (prod = Postgres, auto-deploys from main)

- Additive columns nullable or with cheap defaults (Postgres ≥11 fast-path).
- Separate schema migration from data backfill; backfills idempotent and re-runnable.
- No long table locks; no `ALTER` that rewrites `bookings_quote`/`events_event`.
- Wave branches cut from **fresh main**, migrations renumbered immediately before merge (the 0057/0023 lesson; and note `events/0025` is *currently* double-claimed by this branch and `payments-stripe`).
- Any seed change regenerates `backend/seed.json` (dumpdata command in CLAUDE.md); doc-sync rules apply (PORTIONING_LOGIC.md ↔ help page; CALCULATION_PARITY trio).

### 2.6 The legacy-org regression gate (new, cheap, per-wave)

Add once, run every wave: a backend test fixture representing a **legacy desi org** (split guests, gents/ladies, VAT/£, no service charge — `seed_demo` shape) that snapshots (a) `compute_booking_totals` output for a reference booking and (b) extracted quote-PDF text (pypdf, like `test_quote_pdf.py`). Waves must leave both snapshots **byte-identical**. This converts "existing orgs keep today's behaviour" from a review checklist into a failing test.

---

## Part 3 — Wave-by-wave execution plan

### Foundation — REL-408 (supersedes the "Wave F" extraction; decided 2026-07-20)

**Task (corrected scope):** land the **two remaining unmerged commits** of `payments-stripe` — the Stripe billing itself is already on main. In its worktree: merge `origin/main` in (mechanical conflicts expected in `events/models.py`, `staff/models.py`, `users/signals.py` — main's signal now also seeds choice defaults — and the seed commands), renumber colliding migrations (`events/0024–0025 → 0026–0027`, `staff/0006–0008 → 0008–0010`; `rules/0006` and `dishes/0006` are clear), regenerate `seed.json` if seeds changed, run both suites + pre-push e2e, then push/PR/merge.

Brings: `users/country_defaults.py` + US starter catalog + per-org uniqueness/org-scoping fixes (`3c28d69`), and `GuestSegment` + `BookingGuestCount` stage 1 (`686a60b`; engine stage 2 stays open).

Two items move out of the old Wave F into the waves: the **Wave-1 `country_defaults` keys** (`service_charge_default_pct`, `guest_mode`, `time_format`) are added on the Wave 0/1 branches, and the **legacy-org snapshot gate (2.6)** is built in Wave 0.

**Existing-org safety:** country defaults fire only on org creation; the segment migration preserves rows and backfills counts from existing columns (already written that way). No billing behaviour changes in this task — billing is already live on main with existing orgs comped.

### Wave 0 — Locale (REL-403)

**Backend**
- `users/signals.py`: apply `country_defaults` on org creation (from REL-408).
- Align stray UK defaults for *new* rows: `Venue.country`, `Account.billing_country` (derive from org country; migration only changes the column default, existing rows untouched).
- `bookings/pdf.py`: `_fmt(value, cs='£')` → make `cs` required (callers already pass the org symbol; the default is the only leak). Sweep `£` out of model `__str__`s.
- "VAT Number" → label change to "Tax ID" in serializers/UI; **keep** the `vat_number` column name (rename is churn with zero user value).

**Frontend**
- New `lib/orgLocale.tsx`: provider + `useOrgLocale()` exposing `{symbol, code, taxLabel, dateFormat, timeFormat, formatMoney, formatDate, formatTime}`, wrapping `useSiteSettings()`, with **neutral** loading behaviour (em-dash/skeleton, never a hardcoded symbol).
- Sweep the verified fallback sites: `lib/utils.ts:14` (`formatCurrency` default `"£"` → make param required), `app/page.tsx:102`, `app/invoices/page.tsx:44`, `app/invoices/[id]/page.tsx:46`, `app/events/page.tsx:64`, `app/quotes/page.tsx:57`, `app/quotes/[id]/page.tsx:55,132`, `app/leads/[id]/page.tsx:188`, `app/events/[id]/page.tsx:90`, `components/DealWonDialog.tsx:18`, `components/MenuBuilder.tsx:50`; `lib/dateFormat.ts:44` unknown-format default; the `taxLabel || "VAT"` sites (`quotes/[id]:554,1085`).
- Rename **"Big Eaters"** → "Guest count buffer" (or similar): `GuestCountField.tsx:121`, `events/[id]:866`, `help/page.tsx:222`, settings labels. Label-only — field names (`big_eaters*`) unchanged. Update PORTIONING_LOGIC.md + help page together (doc-sync rule).
- 12h default for US arrives via `country_defaults` (`time_format` already exists end-to-end).
- **Guard test:** vitest that scans `app/` + `components/` + `lib/` source for `£|"GBP"|"VAT"` literals outside `orgLocale`/tests — makes the sweep permanent.

**Existing-org safety:** no data migration touches existing `OrgSettings`. Mis-provisioned orgs get a manual `apply_country_defaults --org` command, run deliberately per org. **Do not implement REL-403's "backfill stale orgs" as a bulk migration.**

**Verify:** new US org shows $/Sales Tax/MM-DD/12h everywhere incl. PDFs; legacy-org snapshots identical; guard test green.

### Wave 1 — Pricing correctness (REL-404)

**Service charge + gratuity — schema**
- `OrgSettings`: `service_charge_default_pct` (5,2, model default **0.00**; US new-orgs get ~20 via country defaults), `service_charge_taxable_default` (bool, default `true` — mandatory service charges are taxable in most US states), `gratuity_default_pct` (default 0), `gratuity_mode` (`none|suggested|line`, default `none`).
- `Quote` + `Event` (snapshot fields, 2.3): `service_charge_pct` (backfill 0), `service_charge_taxable` (backfill false), `gratuity_pct` (backfill 0). Copied from OrgSettings on creation only.

**Pipeline (`compute_booking_totals`) — new ordered steps**
1. `food_total` (unchanged) 2. `items_total` (unchanged, discounts negative) 3. `subtotal = food + items` (unchanged)
4. `service_charge = round2(subtotal × service_charge_pct/100)` — shown as its own line
5. `tax_base = subtotal + (service_charge if service_charge_taxable else 0)`
6. `tax_amount = round2(tax_base × tax_rate)`
7. `gratuity = round2(subtotal × gratuity_pct/100)` — post-tax, never taxed (a *mandatory* tip is a service charge by definition; keep one concept per line)
8. `total = subtotal + service_charge + tax_amount + gratuity`

With all new fields 0 this reduces exactly to today's 5 steps — that equivalence is the migration-safety proof and a named test. Update the **trio together**: `totals.py` (+ `BookingTotals` fields `service_charge`, `gratuity`, `tax_base`), `frontend/lib/quoteTotals.ts`, `docs/calculation-golden-cases.json` (**append** cases: sc-taxable, sc-non-taxable, gratuity, sc+discount+tax combo, all-zero legacy). Then `BookingTotalsCard` rows (service charge between add-ons and subtotal-adjacent block; gratuity after tax), both PDFs, sign-page totals, `PRICING_LOGIC.md`.

**Single guest-count mode**
- `OrgSettings.guest_mode` (`single|split`): model default `single`; country defaults set `split` where that's the norm; **data migration backfills `split` for every existing org** (the REL-402 trap, implemented).
- It is a **presentation flag over the segment model**, not a second data model: `single` hides the split checkbox in `GuestCountField`, the gents/ladies parenthetical in PDFs, and the `(G/L)` chips in kitchen views; `guest_count` remains canonical. The engine path needs **no change** — `Event.portioning_guests()` already falls back to `OrgSettings.default_guest_profile` when no split exists. When segments stage 2 lands, `single` ≡ "one default segment"; the flag keeps its meaning.
- Explicitly **out of scope here:** engine `GuestMix` generalisation (that's segments stage 2, tracked on `payments-stripe`).

**Structured address**
- Additive nullable fields on `Quote`/`Event`: `venue_city`, `venue_state`, `venue_zip` (street stays in `venue_address` line 1 usage); `venue_address` untouched, nothing parsed. `Venue` model already structured — booking fields are for ad-hoc venues only; UI shows them as optional refinements.

**Verify:** all pre-existing golden cases pass unmodified; new cases match BE and FE to the cent; legacy-org PDF/totals snapshots identical; historical booking edited → total unchanged unless its own fields change; single-mode org completes quote→sign→event with one number (e2e); split-mode org regression e2e.

### Wave 2a — Operational schema (REL-405 first half; the AI-wedge dependency)

- **Courses:** `bookings.BookingCourse` (quote-XOR-event like `BookingMeal`; `name`, `sort_order`, `service_style` → existing `ServiceStyleOption`), plus optional `course` FK on booking dish lines; mirror template `menus.MenuCourse` for menu templates. Course-less bookings render exactly as today (implicit single course) — covered by the 2.6 snapshot.
- **Dietary/allergen tags:** new `dishes.DietaryTag` (fixed slugs: V/VG/GF/DF + halal/kosher + the 9 FDA allergens incl. sesame) + M2M on `Dish` (works on SQLite dev + Postgres prod; queryable by the AI). Additive; default none; regenerate `seed.json`; PORTIONING_LOGIC.md untouched (no math change).
- **Meal buckets (kids/vendor):** these are exactly `GuestSegment.price_multiplier` rows (Adults 1.0, Kids 0.6, Vendors ×) + `BookingGuestCount` — **already built in Wave F**, so this shrinks to: expose segment counts in booking UI + per-head pricing math honouring `price_multiplier` (touches the totals trio again — same append-only golden-case rules).
- **Entrée-choice counts:** integer `choice_count` on the booking dish line (nullable = not tracked).
- **Timeline:** `bookings.BookingTimelineEntry` (booking XOR, `time`, `label`, `sort_order`) + org-configurable presets via the existing choice-option pattern. The 4 legacy fields (`setup_time`, `guest_arrival_time`, `meal_time`, `end_time`) stay; renderers show legacy fields **only when a booking has no entries**; new-org UI writes entries; existing bookings never migrated.

### Wave 2b — Operational outputs (REL-409; buyer-visible)

- **BEO / day-of export:** new `bookings/pdf_beo.py` assembling: event header + guarantee fields (`guaranteed_count`/`final_count`/`final_count_due` — already exist), timeline (union rule above), courses + service styles + dietary flags, staffing (`AllocationRule`/`Shift`), equipment windows (`EquipmentReservation`), contacts, setup notes. Render-and-extract pypdf test (per CLAUDE.md rule) from day one.
- **WhatsApp delivery:** widen `WhatsAppMessage` (nullable `lead`; add nullable `quote`/`event` FKs + a constraint mirroring the signature XOR-ish pattern); `WhatsAppService.send_booking_link(booking, kind)` for quote-PDF / e-sign `/b/<token>` / BEO; endpoints `POST /api/bookings/quotes/<pk>/send-whatsapp/` etc. Existing lead flows untouched. Note: a **wa.me sign-link send already shipped with e-sign v1** (PR #50) — this adds the Twilio-API path and the quote/BEO kinds.
- **Email fallback (new infra, small):** provider config (SMTP/API key, platform-level like Twilio), `bookings/services/email.py`, minimal templates for the same three sends. Named as its own sub-task — it's currently zero-infrastructure.
- **Deposit / cancellation on the contract:** snapshot fields on booking: `deposit_pct`/`deposit_amount`, `deposit_due_date`, `cancellation_policy_text` (copied from a new `OrgSettings.cancellation_policy_text` at creation); rendered on the sign page + signed PDF so what the client signs includes them. Backfill: null/empty for existing bookings, sign page hides empty sections.
- **E-sign hardening (from the 2026-07-20 ESIGN/UETA evidence review):** ① auto-send the signed copy to the signer (WhatsApp + email) — retention-of-copy is the current weakest link; ② store a SHA-256 of `signed_pdf` at signing time (tamper-evidence); ③ add an electronic-business consent line to the default consent text; ④ deposit/cancellation terms into what's signed (the item above).

### Wave 3 — Ops depth (REL-406)

All additive nullable fields/uploads on `Event` (+ BEO rendering): kitchen-facilities (on `Venue`: it already has `kitchen_access`/`power_water_notes` — extend, don't duplicate), rain plan text, load-out/trash/hard-end fields, china/serviceware selection (equipment-catalog-backed line items → upsell shows in totals as normal line items, no new math). Floor/seating: a single attachment/URL field — deliberately light (AllSeated/Prismm own this).

### Wave 4 — Compliance capture (REL-407)

Cheap capture fields + uploads, no workflow: alcohol section (supplier enum, bartender count, host-liquor flag), COI upload, exemption-cert upload (+ `tax_rate=0` stays a per-booking manual choice — no engine), PO/billing-contact/NET-30 fields, all nullable, all hidden when empty. No blocking dependencies; can be folded opportunistically into any later wave.

---

## Sequencing summary

```
e-sign ✅ merged (PR #50) ──► REL-408 Foundation (land payments-stripe) ──► Wave 0 ──► Wave 1 ──► Wave 2a ──► Wave 2b ──► Wave 3/4 (opportunistic)
```

Each wave: branch from fresh main → build → renumber migrations → legacy-org snapshot gate green → append-only golden cases green → both suites + pre-push e2e → merge. One owner per money-math file trio at any time (avoid the divergent-totals risk REL-402 flags).

## Open decisions for the owner

~~Foundation route~~ — DECIDED: Option A, land `payments-stripe` (REL-408). ~~Landing e-sign~~ — DONE (PR #50).

1. **Gratuity semantics:** plan assumes gratuity is always voluntary/untaxed and "mandatory tip" must be modelled as service charge — confirm that's acceptable US-side simplification.
2. **"Big Eaters" replacement label** — "Guest count buffer" proposed; pick the final string once.
3. **Units deferral:** engine stays gram-native; oz/lb display conversion parked (not in any wave). Confirm.
