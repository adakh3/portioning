# Booking Form (Quote / Event) — Design Brief

> **Purpose.** A self-contained briefing for a designer (human or agent) redesigning the
> whole quote/event booking front end. It captures the domain, the current model, hard
> constraints, and the committed roadmap so the design accounts for **current and future**
> considerations and can, in turn, inform the data model.
>
> **Status.** Living brief backing the **REL-422** design spike (parent epic **REL-402**,
> US market readiness). Keep in sync when those tickets change.

---

## What this form is

The central work surface of a **catering booking app**. A booking is **one thing in two
stages**: it starts as a **quote** (priced proposal sent to the customer) and, when won,
becomes an **event** (the confirmed job kitchen + ops execute). **Design quote and event as
one booking in two states, not two forms** — the same core data (who's eating, what's
served, when, the price) carries through; the difference is which fields matter when.

## Who uses it and the domain

- **Users:** catering sales/owners building a quote fast during/after a customer call;
  ops/kitchen reading the confirmed event.
- **Markets:** **US (mainstream)** and **UAE** first — explicitly **not** UK, **not** a
  desi/diaspora niche. The UAE variation is data-driven, not a separate design.
- **The product bet:** the GTM wedge is **agentic AI** — an assistant will increasingly fill
  in and reason over bookings. Hard implication: **the data model must be expressive and
  unambiguous first.** Every quantity has one meaning and one home. Anywhere a human does
  mental arithmetic or resolves a contradiction "by knowing what's meant," an AI gets it
  wrong. Model clarity > UI polish.

## The core objects (what the form edits)

1. **The roster — "who's eating," entered once.** A booking has org-configurable **guest
   segments** (US: Adults, Kids, Vendors; some orgs: Gents/Ladies) — the count varies per
   org, it is **data not a fixed list**. Each segment carries a **headcount**, a **portion
   multiplier** (kids eat less → smaller kitchen quantities), a **price multiplier / per-head
   rate** (kids billed less), whether it **counts toward the guest total** (Adults/Kids do;
   **Vendors are extra covers who eat but aren't "guests"**), and one segment is the
   **default remainder** (its count derives so the numbers always reconcile). Show the derived
   line: **`158 covers = 150 guests + 8 vendors`**. Guest count is asked **once, here** —
   never re-entered per meal.
2. **Services (meals) — each serves an audience.** Retire today's broken "Main Meal vs
   Additional Meals" split. **One uniform "service"**: a time, a name, a menu, a price, and an
   **audience** (Everyone / Guests / Adults / Kids / Vendors / any subset) whose covers derive
   from the roster. A vendor meal is just a service serving Vendors. Multiple services, sorted
   by time; any one can be flagged the primary.
3. **Menu / dishes per service** — typed in or loaded from a **template** (templates carry
   *structure*, i.e. which dishes, **not** headcounts). Dishes have prices; unpriced ones are
   flagged, never silently zero.
4. **Add-ons** — beverages, rentals/equipment, labor, fees (some with variants/quantities),
   priced separately from food.
5. **Money** — food subtotal (per segment) + add-ons → **discount (pre-tax)** → **service
   charge (taxable, ~20% US default)** → **tax on the whole subtotal** → total. Plus an
   optional **gratuity** line (voluntary/untaxed). Appetite (**Standard/Hearty + %**) affects
   quantities and/or price.

## Hard constraints (non-negotiable, often missed)

- **Per-segment pricing coexists with per-service pricing.** Within *one* service on *one*
  menu, segments can bill at different rates (kids cheaper on the same buffet). Keep this —
  do **not** "solve" it by forcing a separate service per segment.
- **Every number reconciles to the penny.** The itemized per-segment food lines must **sum
  exactly** to the subtotal (this drives a per-cover rounding rule). Present food as
  **per-segment line items that visibly add up**, not one blended "$X/head × N" line that
  mysteriously doesn't match.
- **Two pricing modes, visually unambiguous:** a **computed** price (from dish prices) vs a
  **manual override** — obvious at a glance which is in effect, with a
  `$/head × covers = total` math line.
- **The same booking renders on multiple surfaces that must stay consistent:** the on-screen
  **totals card**, the **quote PDF**, the **event PDF**, the customer **e-signature page**
  (`/b/<token>`), and — soon — the **BEO ops sheet**. Any breakdown must make sense in a
  static PDF and on the sign page, not just the live form.
- **Existing orgs must not change behaviour.** Every new capability is a **per-org,
  region-defaulted setting**; existing (GB/PK) orgs keep today's look (no service-charge line,
  gents/ladies segments, £/VAT). New fields are additive & optional; a booking with none of
  the new data renders exactly as today.
- **Some fields stay hidden until wired to money** (Guaranteed / Final / Final-due counts) —
  don't design them in as live yet.
- **Running feedback is wanted:** total covers, plates served, food cost, per-guest average,
  unpriced count, time conflicts — via a top summary + a sticky bottom bar.

## 🔭 Roadmap — design so these slot in without a rebuild

These are **committed upcoming features** (US-readiness epic REL-402) that land **inside this
form**. The redesign must leave structural room for them now:

- **Courses + per-course service style** *(Wave 2a, active — REL-405)* — a service isn't a
  flat dish list; it's an ordered set of **courses** (appetizer / entrée / dessert…), and
  **each course can have its own service style** (e.g. plated entrée, buffet dessert). The
  service/menu UI must accommodate grouping dishes into courses, each with a style — not just
  one flat chip list.
- **Entrée-choice counts (plated service)** *(Wave 2a)* — for plated meals the caterer tracks
  *how many guests chose entrée A vs B vs C*. That is a **per-course, per-dish count** that
  must reconcile against the service's covers. The menu UI needs a place for "of 150 covers:
  90 chicken / 45 salmon / 15 veg."
- **Dietary / allergen counts** *(Wave 2a + REL-414)* — two distinct things: **per-dish
  allergen tags** (this dish contains nuts) and **booking-level dietary counts** (12
  vegetarian, 3 nut-free). Leave room for both; they surface on the kitchen sheet.
- **Client count-submission** *(REL-414)* — the **final guest count + entrée tallies +
  dietary notes arrive late from the client** via their own tokenized page, ~2–4 weeks out. So
  counts/tallies must be enterable by *both* the caterer and an external client flow — design
  the count fields as something that gets *refined over time by more than one party*, not
  typed once and frozen.
- **Count lifecycle** *(Wave 1, shipped — REL-404)* — one canonical guest number **evolves**:
  estimate → guaranteed minimum → final guarantee. The roster should read as a single evolving
  number with a status, not three separate inputs.
- **Day-of timeline** *(Wave 2a → BEO in 2b)* — an **orderable schedule** of the event
  (load-in, service times, breakdown). Belongs on the event stage; feeds the kitchen sheet.
- **BEO / kitchen ops sheet** *(Wave 2b — REL-409)* — the event's data (roster, services,
  courses, service styles, dietary, timeline, staffing, equipment) is **exported as a Banquet
  Event Order** — another rendered surface. Whatever the form captures should map cleanly onto
  an ops document, not just a customer quote.
- **Contract terms: deposit & cancellation** *(Wave 2b)* — a deposit schedule and cancellation
  policy appear on the **signed contract** — leave room near the money/terms area.
- **Guest-segment config in Settings** *(REL-421)* — segment rates/order/in-count become
  owner-editable in Settings (moving out of Django admin). The form should treat the segment
  list as fully dynamic per org.
- **Doc delivery** *(Wave 2b)* — quotes/contracts/BEOs get sent via **WhatsApp (primary) +
  email (fallback)** — the "send" affordance is a first-class action, not a print button.
- **Lower-priority capture** *(Waves 3–4, opportunistic — REL-406/407)* — kitchen facilities /
  power / rain plan / china / load-out *(event-level, some belong on Venue)*; and compliance
  capture (alcohol/bar, COI, tax-exemption cert, corporate AP) as **optional capture fields**,
  not blocking sections. The design should tolerate optional add-on sections without
  cluttering the core flow.

## Open decisions the design should *inform*

- **Pricing direction:** bottom-up (price = Σ dish prices, computed default + override) vs
  top-down (manual $/head, today's default). Leaning bottom-up.
- **Appetite "Hearty":** does it scale **price**, **portions (kitchen quantities)**, or both?
  They are different things.
- **Courses vs entrée-choices interaction:** how per-course structure and per-entrée counts
  co-present without overwhelming a simple buffet booking (which has neither).

## What we need back from the designer

A holistic redesign of the booking form (serving quote **and** event stages) that:

1. Establishes the **roster once**; derives covers everywhere from it; treats the segment list
   as dynamic per org; reads the guest number as a single evolving, multi-party-refined value.
2. Models **every meal as a uniform service with a selectable audience**, and each service as
   **ordered courses, each with its own service style**, with room for **per-entrée choice
   counts**.
3. Makes **computed-vs-override pricing** unmistakable, **keeps per-segment pricing within a
   service**, shows food as **reconciling per-segment line items**, and has room for **service
   charge + gratuity + deposit/cancellation terms**.
4. Adds **dietary/allergen** capture (per-dish tags + booking-level counts) and a **day-of
   timeline** on the event stage.
5. Adds the **feedback bars** (top + sticky bottom) and a first-class **send** action.
6. Works as a **live form, quote PDF, event PDF, e-sign page, and BEO ops sheet**.
7. Is **expressive and unambiguous enough for an AI agent to fill in and reason over** — one
   home, one meaning per quantity.
8. **Degrades gracefully** — a simple single-buffet, no-courses, no-vendors booking (and an
   existing GB org) must still look clean; everything above is additive.

---

*References: REL-422 (this spike), REL-402 (epic), REL-405 (courses/service style/dietary/
entrée counts/timeline), REL-414 (client count-submission), REL-409 (BEO + delivery + contract
terms), REL-421 (segment config in Settings). Money-math parity: `docs/CALCULATION_PARITY.md`.
Competitor context: `docs/COMPETITIVE_ANALYSIS.md`.*
