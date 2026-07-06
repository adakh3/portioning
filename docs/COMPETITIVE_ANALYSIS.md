# Competitive Analysis — US & UK Catering / Event Management Software

**Date:** 2026-07-06
**Method:** Deep web research (111 agents: 6 search angles → 28 sources fetched → 128 claims extracted → 25 adversarially verified with 3 independent fact-checking votes each → 23 confirmed, 2 refuted). Every competitor claim below was verified against live vendor pages or corroborated snapshots fetched 2026-07-06 unless noted.
**Our feature baseline:** current codebase across all branches (main + `payments-stripe`, `commission-engine`, `merge-account-contact-to-customer`, AI follow-ups worktree).

---

## Executive summary

The **four-pool, guest-mix-aware portioning engine is a genuine differentiator** — the closest verified competitor capability (CaterZen's kitchen production reports) is simple per-menu-item linear formula scaling with no guest-mix multipliers, pools, or ceilings anywhere in its documentation.

But we lag the market on a cluster of features that are demonstrably **table-stakes in both the US and UK**:

1. **Online client payments** — the single most commercially material gap. Total Party Planner structures its entire pricing around payments adoption (a **$200/month penalty for NOT using TPP Pay**).
2. **E-signature on proposals/contracts** — included free by TPP; shipped by Flex Catering, CaterSOFT (UK), and Event Temple.
3. **Formal BEO documents** — standard at TPP, Flex, and Event Temple; our cooking sheets cover kitchen production but not the client/venue-facing BEO buyers expect.
4. **Accounting integrations** — QuickBooks/Xero/Sage export is baseline in both markets; our only integration is Twilio/WhatsApp.
5. **Customer portal / online ordering** — segment-defining in UK drop-off catering (Spoonfed); a softer but real gap for full-service.

**Pricing context:** TPP anchors the US market at **$119–$429/month + $299 setup fee**. There is clear room to price as an entry-level alternative — *if* the e-sign/payments gaps are closed.

---

## Where we are strong

### 1. Portioning engine (verified differentiator — vs CaterZen; likely broader)

- **Confidence:** high (3-0 votes across five separate claims, all unanimous)
- CaterZen — the competitor that markets kitchen production hardest — derives quantities purely by aggregating ordered items through pre-configured per-menu-item linear formulas ("I would like [Qty] [Units] of [Prep Item] For Every [N] ordered"). Its own docs: *"You must have formulas set up for Menu Items for this report to work appropriately"* — items without formulas don't appear at all.
- Zero mention of guest demographics, appetite profiles, portion pools, or ceilings anywhere in CaterZen's marketing or support docs. Their portioning is item-formula scaling; ours is demand modeling (guest mix, popularity weights, pool ceilings, combination rules, big-eaters uplift).
- **Scope limit (important):** a claim that TPP lacks any portioning engine was REFUTED (0-3) — TPP's own blog says it "forecasts food needs based on headcount and recipes." So differentiation is *verified only against CaterZen*; TPP has at least recipe-scaling-by-headcount. Nobody verified has guest-mix/pool/ceiling logic like ours.
- Sources: caterzen.com/catering-kitchen-production-reports; support.caterzen.com articles 6000192886, 6000171141, 6000282538

### 2. Commission engine (possible second differentiator — unverified)

No surviving claim examined sales-commission features in *any* competitor. Banded/accelerated commission plans, sales targets, and per-rep dashboards may be a real differentiator for multi-salesperson caterers — worth verifying before marketing on it.

### 3. Segment positioning in the UK favors us

- Spoonfed — the strongest UK player — targets **B2B delivered/drop-off and institutional catering** (universities, schools, healthcare, stadiums) and per third-party reviews "works best for companies that do mostly drop-off catering as opposed to full service events." It is *not* a direct full-service competitor.
- Our nearest UK full-service comparators are the much smaller **CaterSOFT** (buffet caterers, event planners, venues) and **Flex Catering**.
- The South Asian-catering awareness (gents/ladies splits, curry+rice combination rules) has no verified equivalent anywhere in the market.

### 4. At parity

- **Lead/CRM pipeline & quotes:** customizable kanban, round-robin assignment, versioned quotes with lifecycle states — comparable in structure to what Spoonfed/TPP describe (Spoonfed is ahead on CRM-attached customer *marketing*, which we lack).
- **Back-of-house categories:** Spoonfed's buckets (order management/quoting, fulfillment/production, menu management, billing/invoicing) map one-to-one onto our quotes, cooking sheets, and invoicing.
- **Staff & equipment:** we have scheduling with computed labor cost + guests-per-staff auto-allocation and equipment reservations; competitors mostly *integrate* staffing (Nowsta/Deputy/StaffMate) rather than build it in.
- **WhatsApp follow-ups:** no verified competitor does WhatsApp-native lead nurture (competitors are email-centric). Differentiating for markets where WhatsApp is the business channel.

---

## Where we lag (ranked by commercial materiality)

### 1. Online client payment collection — most material gap (high confidence, 3-0 across five vendors)

| Vendor | What they ship |
|---|---|
| Total Party Planner (US) | Invoice payment links, credit/debit/ACH, deposits, partial payments — and a **$200/month fee if you don't adopt TPP Pay** ("TPP Pay is a required function") |
| Flex Catering | "Collect deposits, partial payments, or full balances, and send digital invoices for secure online payments" |
| CaterSOFT (UK) | Deposit tracker, automated payment-due reminders, scheduled daily/weekly invoicing |
| Event Temple | Digital invoicing with payment tracking |
| Spoonfed (UK) | Stripe / Square / FreedomPay options |

A vendor structuring its entire pricing around payments adoption is strong evidence that **payments is where US catering software monetizes**. We record payments manually. Note: our `payments-stripe` branch is *tenant subscription billing*, not client checkout — the Stripe integration work there could be extended toward client payments.

### 2. E-signature on proposals/contracts (high confidence, 3-0 across four vendors)

- TPP: "Electronic Signature: for catering proposals and contracts **Included!**" — all tiers, no extra cost.
- Flex: "send proposals for e-signature... approve and pay in one step."
- CaterSOFT (UK): "Email the web link to your customer, which they can electronically sign and return."
- Event Temple: E-Proposals as a core module.

Four independent vendors across both markets ship this. Our quotes are PDF-only with staff-marked acceptance.

### 3. Formal BEO / ops documents (high confidence, 3-0 across three vendors)

- TPP: "Generate proposals, BEOs, invoices, and express order forms in no time"; "Faster BEOs: Minutes, not hours."
- Flex: "clean, professional BEOs in seconds" plus production reports, prep sheets, costing.
- Event Temple: "Create banquet event orders and kitchen sheets with the click of a button... BEO routing makes it easy to create complex BEOs."

Our kitchen cooking sheets cover production, but there is no client/venue-facing BEO artifact. Likely the *cheapest* gap to close — most of the data (service timeline, kitchen/banquet/setup instructions, dishes, staffing) already exists on the event model; it needs a document.

### 4. Accounting & staffing integrations (high confidence, 3-0 across four vendors)

- TPP: invoices "go straight into QuickBooks!" (Online & Desktop, US/Canada); Mailchimp, Google/Outlook/iCal, ChefTec, Nowsta, StaffMate.
- Flex: Xero, QuickBooks, MYOB, Deputy, Nowsta, Google, Zapier.
- CaterSOFT (UK): QuickBooks, Xero, Sage, FreeAgent exports.
- Spoonfed: Stripe, Square, FreedomPay, Google Maps, DoorDash Drive, Kafoodle.

Caveat from verification: many of these are **one-way exports, not bidirectional syncs** — in the UK the realistic bar is "some Xero/QuickBooks invoice export is commonly expected," not deep integration. A CSV/API invoice export to Xero + QuickBooks would meet the bar.

### 5. Customer portal / online ordering (high confidence, 3-0)

- Spoonfed: customers place, edit, and cancel orders online ("Single, multi and group" ordering styles, caterer-set edit/cancel cutoffs) — this is the **segment-defining capability in UK drop-off catering**.
- TPP: client portal with chat and notifications (gated to the mid Feast tier and up).

Matters critically **only if we enter drop-off/B2B delivered catering**; for full-service banquet work it's a softer gap (but portal + e-sign + pay online naturally combine into one "client hub" feature).

### 6. Email automation / customer marketing

Spoonfed ships CRM-attached customer marketing; TPP exports to Mailchimp. We have WhatsApp only (plus AI follow-up drafts on a branch). Email remains the default channel for US/UK corporate clients.

---

## Pricing benchmark (US, verified 2026-07-06)

Total Party Planner (vendor page, authoritative — third-party listings are stale):

| Tier | Price | Users | Target |
|---|---|---|---|
| Nibble | $119/mo | 1 | start-up / solo caterers |
| Feast | $299/mo | 2 | growing caterers (adds client portal) |
| Delicacy | $429/mo | 3 | universities / stadiums / arenas |

Plus: extra users $25/mo, one-time $299 setup fee, ~10% annual-billing discount, and the $200/mo non-TPP-Pay surcharge. A refuted claim (0-3) warns against assuming every feature is in every tier — only e-sign was confirmed all-tier.

**No UK competitor pricing could be verified** (open question).

---

## Caveats on this research

- Evidence is mostly **vendor marketing copy** (feature existence, not quality/depth), though corroborated via Capterra, GetApp, G2, Software Advice, and third-party docs.
- **Coverage is partial:** only TPP, CaterZen, Spoonfed, CaterSOFT, Flex Catering, and Event Temple survived verification. Caterease, Curate, FoodStorm, Tripleseat, Planning Pod, HoneyBook, Releventful, Priava/Momentus, and Caterbook are **not covered by any confirmed claim** — "table-stakes" generalizations rest on 3–5 vendors per dimension.
- Flex Catering verified via Wayback snapshot (2026-04) + review sites (live site returns 403).
- Dimensions with **no surviving competitive evidence either way**: costing/profitability tooling, commission management, reporting/BI.
- Two claims were refuted and both *temper* the report (TPP per-tier features; TPP allegedly lacking portioning).

## Open questions (follow-up research candidates)

1. Does any major full-service US player (Caterease, Curate, Tripleseat, Planning Pod, TPP) offer demographic/guest-mix-driven quantity calculation comparable to the four-pool engine — or is CaterZen's formula scaling representative?
2. Is the commission engine a second genuine differentiator? (No competitor evidence found either way.)
3. What do UK competitors actually charge in GBP, and where would we need to price to win?
4. How do the uncovered mid-market players compare on costing/profitability and reporting/BI?

## Suggested priority order (opinion, given the evidence)

1. **Client-facing quote page: view online → e-sign/accept → pay deposit** — one feature closes the top-2 gaps and feeds the existing invoice/payment models.
2. **BEO document** — cheap; data already exists on events; PDF pipeline already exists.
3. **Xero + QuickBooks invoice export** — one-way export meets the verified market bar (UK especially).
4. **Email sending for quotes/follow-ups** — completes the loop; Mailchimp-style marketing can wait.
5. Portal/online ordering — only when/if targeting drop-off B2B catering.

---

## Verified sources (primary)

- totalpartyplanner.com — /features/, /catering-software-pricing/, /catering-software-faq/
- caterzen.com/catering-kitchen-production-reports; support.caterzen.com articles 6000192886, 6000171141, 6000282538
- getspoonfed.com — homepage, /solutions/online-ordering
- catersoft.co.uk/venue/venue-features.aspx
- flexcateringhq.com — /event-management-software/, /integration/ (via Wayback 2026-04); apps.xero.com/uk/app/flex-catering
- eventtemple.com/events-and-catering
- curate.co/catering-software/; foodstorm.com/product; ezcater.com

Corroboration: Capterra, GetApp, G2, Software Advice, Nowsta community docs, Instacart/FoodStorm press (Grocery Dive, Supermarket News).
